import {
  DROP_CODE_LENGTH,
  DROP_CODE_PATTERN,
  formatDropCode,
  normalizeDropCode,
} from "@print-cess/protocol";

const FRAGMENT_KEY = "c=";
const MAX_INPUT_LENGTH = 2048;

export function buildDropLink(origin: string, code: string): string {
  return `${origin}/receive#${FRAGMENT_KEY}${code}`;
}

export function parseDropFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > MAX_INPUT_LENGTH) return null;
  const parameters = new URLSearchParams(raw);
  const candidate = parameters.get("c") ?? raw;
  const code = normalizeDropCode(candidate);
  return DROP_CODE_PATTERN.test(code) ? code : null;
}

export function parseDropCode(rawValue: string): string | null {
  const input = rawValue.trim();
  if (!input || input.length > MAX_INPUT_LENGTH) return null;
  try {
    const fromLink = parseDropFragment(new URL(input, "https://placeholder.invalid").hash);
    if (fromLink) return fromLink;
  } catch {
  }
  const bare = normalizeDropCode(input);
  return DROP_CODE_PATTERN.test(bare) ? bare : null;
}

export type DropCodeEntry = {
  display: string;
  code: string | null;
  fromLink: boolean;
};

export function readDropCodeEntry(rawValue: string): DropCodeEntry {
  const trimmed = rawValue.trim();
  const looksLikeLink = /[:/#?]/u.test(trimmed);
  const linked = looksLikeLink ? parseDropCode(trimmed) : null;
  if (linked) return { display: formatDropCode(linked), code: linked, fromLink: true };
  const typed = normalizeDropCode(rawValue).slice(0, DROP_CODE_LENGTH);
  return {
    display: formatDropCode(typed),
    code: DROP_CODE_PATTERN.test(typed) ? typed : null,
    fromLink: false,
  };
}

export { formatDropCode, normalizeDropCode };
