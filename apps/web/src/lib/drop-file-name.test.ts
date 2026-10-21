import { describe, expect, it } from "vitest";

import { MAX_DROP_FILE_NAME_BYTES, MAX_DROP_FILE_NAME_LENGTH } from "@print-cess/protocol";

import {
  disambiguateFileName,
  safeFileName,
  safeMediaType,
  splitExtension,
  utf8Length,
} from "./drop-file-name";

describe("safeFileName", () => {
  it("keeps an ordinary name unchanged", () => {
    expect(safeFileName("holiday photo.jpg")).toBe("holiday photo.jpg");
  });

  it("strips the separators that would let a name escape its folder", () => {
    expect(safeFileName("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(safeFileName("C:\\Windows\\system32")).toBe("C__Windows_system32");
    expect(safeFileName("/etc/shadow")).not.toContain("/");
    expect(safeFileName("..\\..\\boot.ini")).not.toContain("\\");
  });

  it("removes control characters a sending device could smuggle in", () => {
    expect(safeFileName("in\u0000voice\u001b.pdf")).toBe("in_voice_.pdf");
    expect(safeFileName("report\u0085.pdf")).toBe("report_.pdf");
  });

  it("removes the direction overrides that disguise one extension as another", () => {
    const spoofed = `invoice\u202egnp.exe`;
    expect(safeFileName(spoofed)).toBe("invoice_gnp.exe");
  });

  it("keeps a dotfile a dotfile but never lets a name be only dots", () => {
    expect(safeFileName(".gitignore")).toBe(".gitignore");
    expect(safeFileName("...")).toBe("_");
    expect(safeFileName("..")).toBe("_");
  });

  it("never returns an empty name", () => {
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("")).toBe("file");
    expect(safeFileName("\u0000\u0000")).toBe("__");
  });

  it("drops the trailing dots and spaces Windows would drop silently", () => {
    expect(safeFileName("report.pdf.")).toBe("report.pdf");
    expect(safeFileName("report.pdf   ")).toBe("report.pdf");
    expect(safeFileName("report...")).toBe("report");
  });

  it("keeps a reserved device name from becoming one", () => {
    expect(safeFileName("CON.txt")).toBe("_CON.txt");
    expect(safeFileName("nul")).toBe("_nul");
    expect(safeFileName("com4.hwp")).toBe("_com4.hwp");
    expect(safeFileName("console.log")).toBe("console.log");
    expect(safeFileName("communication.pdf")).toBe("communication.pdf");
  });

  it("keeps the extension when a long name has to be shortened", () => {
    const shortened = safeFileName(`${"a".repeat(500)}.pdf`);
    expect(shortened.endsWith(".pdf")).toBe(true);
    expect(utf8Length(shortened)).toBeLessThanOrEqual(MAX_DROP_FILE_NAME_BYTES);
  });

  it("bounds names by the bytes they cost, in every script", () => {
    for (const sample of [
      "a".repeat(500),
      "가".repeat(500),
      "文".repeat(500),
      "م".repeat(500),
      "क".repeat(500),
      "🙂".repeat(500),
      "👨‍👩‍👧‍👦".repeat(200),
    ]) {
      const bounded = safeFileName(`${sample}.dat`);
      expect(utf8Length(bounded)).toBeLessThanOrEqual(MAX_DROP_FILE_NAME_BYTES);
      expect(bounded.length).toBeLessThanOrEqual(MAX_DROP_FILE_NAME_LENGTH);
      expect(bounded.endsWith(".dat")).toBe(true);
    }
  });

  it("never cuts a name in the middle of a character or an emoji", () => {
    const bounded = safeFileName(`${"👨‍👩‍👧‍👦".repeat(50)}.png`);
    expect(bounded).not.toContain("\ufffd");
    expect(new TextDecoder().decode(new TextEncoder().encode(bounded))).toBe(bounded);
    expect(bounded.endsWith("\u200d.png")).toBe(false);
  });

  it("keeps every dot of a name that has several", () => {
    expect(safeFileName("archive.tar.gz")).toBe("archive.tar.gz");
    expect(safeFileName("my.holiday.photo.2026.jpeg")).toBe("my.holiday.photo.2026.jpeg");
  });

  it("keeps a name that has no extension at all", () => {
    expect(safeFileName("Makefile")).toBe("Makefile");
    expect(safeFileName("전입신고서")).toBe("전입신고서");
  });

  it("leaves names in every language the service serves alone", () => {
    for (const name of [
      "전입신고서.hwpx",
      "报销单.xlsx",
      "請求書.pdf",
      "فاتورة.pdf",
      "बिल.pdf",
      "hóa-đơn.pdf",
      "faktur (revisi).pdf",
      "résumé — 2026.pdf",
      "resibo ng bayad.pdf",
      "🎉 party plan.pdf",
    ]) {
      expect(safeFileName(name)).toBe(name);
    }
  });

  it("keeps composed and decomposed spellings distinct rather than mangling one", () => {
    const composed = "\uc11c\uc6b8.pdf";
    const decomposed = "\u110a\u1165\u110b\u116e\u11af.pdf";
    expect(safeFileName(composed)).toBe(composed);
    expect(safeFileName(decomposed)).toBe(decomposed);
  });

  it("treats a very long run after the last dot as name, not as a type", () => {
    const name = `report.${"x".repeat(200)}`;
    const bounded = safeFileName(name);
    expect(utf8Length(bounded)).toBeLessThanOrEqual(MAX_DROP_FILE_NAME_BYTES);
    expect(bounded.startsWith("report.")).toBe(true);
  });
});

describe("splitExtension", () => {
  it("splits on the last dot only", () => {
    expect(splitExtension("archive.tar.gz")).toEqual({ stem: "archive.tar", extension: ".gz" });
  });

  it("treats a leading dot as part of the name", () => {
    expect(splitExtension(".gitignore")).toEqual({ stem: ".gitignore", extension: "" });
  });

  it("treats a trailing dot as no extension", () => {
    expect(splitExtension("report.")).toEqual({ stem: "report.", extension: "" });
  });
});

describe("safeMediaType", () => {
  it("keeps a real media type", () => {
    expect(safeMediaType("image/heic")).toBe("image/heic");
    expect(safeMediaType("application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
  });

  it("drops the empty type phones report for Hancom documents", () => {
    expect(safeMediaType("")).toBe("");
    expect(safeMediaType("   ")).toBe("");
  });

  it("drops anything not shaped like a media type", () => {
    expect(safeMediaType("not a type")).toBe("");
    expect(safeMediaType('image/png"; drop')).toBe("");
    expect(safeMediaType("a".repeat(300))).toBe("");
  });
});

describe("disambiguateFileName", () => {
  it("leaves a free name alone", () => {
    expect(disambiguateFileName("photo.jpg", new Set())).toBe("photo.jpg");
  });

  it("never replaces a file already in the chosen folder", () => {
    const taken = new Set(["photo.jpg", "photo (2).jpg"]);
    expect(disambiguateFileName("photo.jpg", taken)).toBe("photo (3).jpg");
  });

  it("keeps the extension while disambiguating", () => {
    expect(disambiguateFileName("archive.tar.gz", new Set(["archive.tar.gz"]))).toBe(
      "archive.tar (2).gz",
    );
  });
});
