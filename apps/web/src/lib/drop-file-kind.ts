import { splitExtension } from "./drop-file-name";

export type DropFileKind =
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "document"
  | "sheet"
  | "slides"
  | "text"
  | "hancom"
  | "file";

const BY_EXTENSION: Record<string, DropFileKind> = {
  pdf: "pdf",

  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  heif: "image",
  avif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  svg: "image",

  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  m4v: "video",

  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  opus: "audio",

  zip: "archive",
  "7z": "archive",
  rar: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",

  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  pages: "document",

  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  csv: "sheet",
  tsv: "sheet",

  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  key: "slides",

  txt: "text",
  md: "text",
  json: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  html: "text",
  css: "text",
  js: "text",
  sql: "text",
  log: "text",

  hwp: "hancom",
  hwpx: "hancom",
};

const BY_MEDIA_PREFIX: [string, DropFileKind][] = [
  ["application/pdf", "pdf"],
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["text/", "text"],
];

export function dropFileKind(name: string, mediaType = ""): DropFileKind {
  const { extension } = splitExtension(name);
  const suffix = extension.replace(/^\./u, "").toLowerCase();
  const byExtension = BY_EXTENSION[suffix];
  if (byExtension) return byExtension;
  const type = mediaType.toLowerCase();
  for (const [prefix, kind] of BY_MEDIA_PREFIX) {
    if (type.startsWith(prefix)) return kind;
  }
  return "file";
}

export function dropFileKindLabelKey(kind: DropFileKind): string {
  return `fileKind_${kind}`;
}
