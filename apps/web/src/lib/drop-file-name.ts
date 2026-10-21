import { MAX_DROP_FILE_NAME_BYTES, MAX_DROP_MIME_LENGTH } from "@print-cess/protocol";

/**
 * A file name is the one piece of a hand-off that is chosen by a person, read
 * by a person, and then handed to a file system. All three want different
 * things from it, so this module is the single place the trade is made.
 *
 * It runs on both ends deliberately. The sending phone sanitizes before the
 * name is sealed into the manifest, and the receiving phone sanitizes again
 * before the name reaches a picker, a directory handle, or a download
 * attribute — because by then the name has arrived from another device and is
 * exactly as trustworthy as any other byte in the transfer.
 */

const FALLBACK_NAME = "file";
/**
 * Past this a run of characters after the last dot is part of the name, not a
 * type, and preserving it would eat the budget the readable part needs.
 */
const MAX_EXTENSION_BYTES = 24;

/**
 * Path separators, the characters Windows refuses outright, C0 and C1 control
 * characters, and the bidirectional overrides that let a name ending in
 * `.exe` paint itself as a `.png` on the receiving screen.
 */
const UNSAFE_CHARACTERS =
  /[\u0000-\u001f\u007f\u0080-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/gu;

/** MS-DOS device names, which Windows still refuses at any extension. */
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

/**
 * The name a received file is allowed to be given.
 *
 * Traversal is impossible because separators are replaced rather than trimmed,
 * so no output of this function contains one at all. Everything else is a
 * fidelity decision: the extension survives truncation, a dotfile keeps its
 * single leading dot, and the budget is spent in UTF-8 bytes so a Korean or
 * emoji name is bounded by what it actually costs rather than by a count that
 * means something different in every script.
 */
export function safeFileName(rawName: string, budget = MAX_DROP_FILE_NAME_BYTES): string {
  const cleaned = rawName
    .replace(UNSAFE_CHARACTERS, "_")
    // Two or more leading dots is `..` wearing a disguise; one is a dotfile,
    // which is an ordinary name worth keeping intact.
    .replace(/^\.{2,}/u, "_")
    .trim()
    // Windows silently drops trailing dots and spaces, so a name that ends in
    // one would be stored under a name nobody asked for.
    .replace(/[.\s]+$/u, "");
  if (cleaned.length === 0) return FALLBACK_NAME;

  const { stem, extension } = splitExtension(cleaned);
  const safeStem = RESERVED_DEVICE_NAME.test(stem) ? `_${stem}` : stem;
  const truncated = truncateToBytes(safeStem, Math.max(1, budget - utf8Length(extension)));
  const assembled = `${truncated.length > 0 ? truncated : FALLBACK_NAME}${extension}`;
  // Truncation can uncover a trailing dot or space that was in the middle of
  // the original name.
  const settled = assembled.replace(/[.\s]+$/u, "");
  return settled.length > 0 ? settled : FALLBACK_NAME;
}

/**
 * Media types are advisory: they help a phone pick an icon and an app, and
 * nothing in the transfer depends on them. Anything that is not shaped like a
 * media type is therefore dropped rather than corrected.
 */
export function safeMediaType(rawType: string): string {
  const candidate = rawType.trim();
  // Dropped rather than truncated. A shortened media type is a different media
  // type, and quietly declaring the wrong one is worse than declaring none —
  // which is already the ordinary case for Hancom documents on most phones.
  if (candidate.length > MAX_DROP_MIME_LENGTH) return "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(candidate)
    ? candidate
    : "";
}

/**
 * Picks a name that is free, so saving five files into a folder the visitor
 * chose never silently replaces something already in it.
 */
export function disambiguateFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const { stem, extension } = splitExtension(name);
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = safeFileName(`${stem} (${counter})${extension}`);
    if (!taken.has(candidate)) return candidate;
  }
  return safeFileName(`${stem} (${Date.now().toString(36)})${extension}`);
}

/**
 * A leading dot is part of the name, not a type, so `.gitignore` truncates as
 * one word instead of losing its only visible character.
 */
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

/**
 * Cutting a name by grapheme keeps a family emoji or a decomposed Hangul
 * syllable whole. Code points are the fallback, and they at least never split a
 * surrogate pair into two lone halves.
 */
function graphemes(value: string): Iterable<string> {
  const segmenter = Intl.Segmenter;
  if (typeof segmenter !== "function") return Array.from(value);
  const segments = new segmenter(undefined, { granularity: "grapheme" }).segment(value);
  return Array.from(segments, (segment) => segment.segment);
}
