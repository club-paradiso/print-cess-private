export type PdfOcrWord = {
  text: string;
  confidence?: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type PdfImagePage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  ocrWords?: readonly PdfOcrWord[];
};

const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const encoder = new TextEncoder();

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function stream(dictionary: string, body: Uint8Array): Uint8Array {
  return join([
    text(`<< ${dictionary} /Length ${body.byteLength} >>\nstream\n`),
    body,
    text("\nendstream"),
  ]);
}

type GlyphMap = Map<string, number>;

function collectGlyphs(pages: readonly PdfImagePage[]): GlyphMap {
  const glyphs: GlyphMap = new Map();
  for (const page of pages) {
    for (const word of page.ocrWords ?? []) {
      for (const character of Array.from(word.text)) {
        if (!glyphs.has(character)) glyphs.set(character, glyphs.size + 1);
      }
    }
  }
  return glyphs;
}

function utf16BeHex(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    output += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return output;
}

function cidHex(cid: number): string {
  return cid.toString(16).padStart(4, "0").toUpperCase();
}

function encodedWord(value: string, glyphs: GlyphMap): string {
  return Array.from(value)
    .map((character) => {
      const cid = glyphs.get(character);
      if (!cid) throw new Error("scanMissingOcrGlyph");
      return cidHex(cid);
    })
    .join("");
}

function buildToUnicodeCMap(glyphs: GlyphMap): Uint8Array {
  const entries = Array.from(glyphs.entries()).map(
    ([character, cid]) => `<${cidHex(cid)}> <${utf16BeHex(character)}>`,
  );
  const chunks: string[] = [];
  for (let index = 0; index < entries.length; index += 100) {
    const group = entries.slice(index, index + 100);
    chunks.push(`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar`);
  }
  return text(
    [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /PrintCessOCR def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0001> <FFFF>",
      "endcodespacerange",
      ...chunks,
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
    ].join("\n"),
  );
}

function pageGeometry(page: PdfImagePage) {
  const landscape = page.width > page.height;
  const pageWidth = landscape ? A4_PORTRAIT.height : A4_PORTRAIT.width;
  const pageHeight = landscape ? A4_PORTRAIT.width : A4_PORTRAIT.height;
  const scale = Math.min(pageWidth / page.width, pageHeight / page.height);
  const drawnWidth = page.width * scale;
  const drawnHeight = page.height * scale;
  const x = (pageWidth - drawnWidth) / 2;
  const y = (pageHeight - drawnHeight) / 2;
  return { pageWidth, pageHeight, scale, drawnWidth, drawnHeight, x, y };
}

function buildPageContent(page: PdfImagePage, glyphs: GlyphMap): Uint8Array {
  const geometry = pageGeometry(page);
  const commands = [
    "q",
    `${geometry.drawnWidth.toFixed(2)} 0 0 ${geometry.drawnHeight.toFixed(2)} ${geometry.x.toFixed(2)} ${geometry.y.toFixed(2)} cm`,
    "/Scan Do",
    "Q",
  ];

  const words = (page.ocrWords ?? []).filter((word) => word.text.trim().length > 0);
  if (words.length > 0 && glyphs.size > 0) {
    commands.push("BT", "3 Tr");
    for (const word of words) {
      const width = Math.max(1, (word.bbox.x1 - word.bbox.x0) * geometry.scale);
      const height = Math.max(1, (word.bbox.y1 - word.bbox.y0) * geometry.scale);
      const x = geometry.x + word.bbox.x0 * geometry.scale;
      const y = geometry.y + geometry.drawnHeight - word.bbox.y1 * geometry.scale;
      const characters = Math.max(1, Array.from(word.text).length);
      const fontSize = Math.max(1, height * 0.92);
      const naturalWidth = characters * fontSize;
      const horizontalScale = Math.min(400, Math.max(12, (width / naturalWidth) * 100));
      commands.push(
        `/OCR ${fontSize.toFixed(2)} Tf`,
        `${horizontalScale.toFixed(2)} Tz`,
        `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
        `<${encodedWord(word.text, glyphs)}> Tj`,
      );
    }
    commands.push("ET");
  }

  return text(commands.join("\n"));
}

export function buildScannedPdf(pages: readonly PdfImagePage[]): Uint8Array {
  if (pages.length === 0) throw new Error("scanNeedsPage");

  for (const page of pages) {
    if (page.width <= 0 || page.height <= 0 || page.bytes.byteLength === 0) {
      throw new Error("scanInvalidPage");
    }
  }

  const glyphs = collectGlyphs(pages);
  const hasOcr = glyphs.size > 0;
  const objects: Uint8Array[] = [];
  objects[0] = text("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects[1] = text(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );

  const fontId = 3 + pages.length * 3;
  const descendantFontId = fontId + 1;
  const fontDescriptorId = fontId + 2;
  const toUnicodeId = fontId + 3;

  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const geometry = pageGeometry(page);
    const resources = hasOcr
      ? `/XObject << /Scan ${imageId} 0 R >> /Font << /OCR ${fontId} 0 R >>`
      : `/XObject << /Scan ${imageId} 0 R >>`;

    objects[pageId - 1] = text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${geometry.pageWidth.toFixed(2)} ${geometry.pageHeight.toFixed(2)}] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`,
    );
    objects[imageId - 1] = stream(
      `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      page.bytes,
    );
    objects[contentId - 1] = stream("", buildPageContent(page, glyphs));
  });

  if (hasOcr) {
    objects[fontId - 1] = text(
      `<< /Type /Font /Subtype /Type0 /BaseFont /PrintCessOCR /Encoding /Identity-H /DescendantFonts [${descendantFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
    );
    objects[descendantFontId - 1] = text(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /PrintCessOCR /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescriptorId} 0 R /DW 1000 /CIDToGIDMap /Identity >>`,
    );
    objects[fontDescriptorId - 1] = text(
      "<< /Type /FontDescriptor /FontName /PrintCessOCR /Flags 32 /FontBBox [0 -250 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 >>",
    );
    objects[toUnicodeId - 1] = stream("", buildToUnicodeCMap(glyphs));
  }

  const header = text("%PDF-1.4\n% Print-cess scan\n");
  const output: Uint8Array[] = [header];
  const offsets = [0];
  let byteOffset = header.byteLength;
  objects.forEach((body, index) => {
    if (!body) throw new Error("scanPdfObjectGap");
    offsets[index + 1] = byteOffset;
    const object = join([text(`${index + 1} 0 obj\n`), body, text("\nendobj\n")]);
    output.push(object);
    byteOffset += object.byteLength;
  });

  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  output.push(text(xref));
  return join(output);
}
