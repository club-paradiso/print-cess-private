import { MAX_DROP_FILE_NAME_BYTES, MAX_DROP_MIME_LENGTH } from "@print-cess/protocol";


const FALLBACK_NAME = "file";
const MAX_EXTENSION_BYTES = 24;

const UNSAFE_CHARACTERS =
  /[\u0000-\u001f\u007f\u0080-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/gu;

const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

export function safeFileName(rawName: string, budget = MAX_DROP_FILE_NAME_BYTES): string {
  const cleaned = rawName
    .replace(UNSAFE_CHARACTERS, "_")
    .replace(/^\.{2,}/u, "_")
    .trim()
    .replace(/[.\s]+$/u, "");
  if (cleaned.length === 0) return FALLBACK_NAME;

  const { stem, extension } = splitExtension(cleaned);
  const safeStem = RESERVED_DEVICE_NAME.test(stem) ? `_${stem}` : stem;
  const truncated = truncateToBytes(safeStem, Math.max(1, budget - utf8Length(extension)));
  const assembled = `${truncated.length > 0 ? truncated : FALLBACK_NAME}${extension}`;
  const settled = assembled.replace(/[.\s]+$/u, "");
  return settled.length > 0 ? settled : FALLBACK_NAME;
}

export function safeMediaType(rawType: string): string {
  const candidate = rawType.trim();
  if (candidate.length > MAX_DROP_MIME_LENGTH) return "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(candidate)
    ? candidate
    : "";
}

export function disambiguateFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const { stem, extension } = splitExtension(name);
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = safeFileName(`${stem} (${counter})${extension}`);
    if (!taken.has(candidate)) return candidate;
  }
  return safeFileName(`${stem} (${Date.now().toString(36)})${extension}`);
}

export function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };
  const extension = name.slice(dot);
  if (utf8Length(extension) > MAX_EXTENSION_BYTES) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension };
}

function truncateToBytes(value: string, budget: number): string {
  if (utf8Length(value) <= budget) return value;
  let used = 0;
  let kept = "";
  for (const cluster of graphemes(value)) {
    const cost = utf8Length(cluster);
    if (used + cost > budget) break;
    used += cost;
    kept += cluster;
  }
  return kept;
}

function graphemes(value: string): Iterable<string> {
  const segmenter = Intl.Segmenter;
  if (typeof segmenter !== "function") return Array.from(value);
  const segments = new segmenter(undefined, { granularity: "grapheme" }).segment(value);
  return Array.from(segments, (segment) => segment.segment);
}
