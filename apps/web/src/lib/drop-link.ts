import {
  DROP_CODE_LENGTH,
  DROP_CODE_PATTERN,
  formatDropCode,
  normalizeDropCode,
} from "@print-cess/protocol";

const FRAGMENT_KEY = "c=";
/**
 * Long enough for any link this service prints, short enough that pasting a
 * document into the field costs one comparison rather than a scan of it.
 */
const MAX_INPUT_LENGTH = 2048;

/**
 * The transfer code travels in the URL fragment, which browsers never send to a
 * server. Scanning the QR code and typing the twelve characters therefore reach
 * exactly the same place, and neither reveals the key to the service.
 */
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

/**
 * The one place a transfer code is read, whatever shape it arrived in: a full
 * link, a bare code, a code with hyphens or spaces, in any case, with the
 * look-alike letters people mistype folded onto the digits they resemble.
 *
 * The scanner, the fragment on arrival, and the keypad all come through here.
 * They used to disagree — the keypad stripped every non-alphanumeric character
 * from its input and then took the first twelve, which turned a pasted receive
 * link into the letters of its own hostname — and a service that accepts a link
 * in one place and mangles it in another is worse than one that never accepted
 * it at all.
 */
export function parseDropCode(rawValue: string): string | null {
  const input = rawValue.trim();
  if (!input || input.length > MAX_INPUT_LENGTH) return null;
  try {
    // The base makes a relative path parse too, so a link copied without its
    // origin still yields its fragment. A code that is not a URL simply has no
    // fragment and falls through.
    const fromLink = parseDropFragment(new URL(input, "https://placeholder.invalid").hash);
    if (fromLink) return fromLink;
  } catch {
    // Not a URL; fall through to the bare-code reading below.
  }
  // The whole input has to be the code. Requiring an exact length is what stops
  // a hostname or a sentence from contributing twelve stray characters.
  const bare = normalizeDropCode(input);
  return DROP_CODE_PATTERN.test(bare) ? bare : null;
}

export type DropCodeEntry = {
  /** What the field should now show. */
  display: string;
  /** The complete code, once there is one. */
  code: string | null;
  /** A whole link arrived at once, which is worth acting on without a tap. */
  fromLink: boolean;
};

/**
 * Turns whatever landed in the code field into what should be displayed and
 * whether it is ready. Pasting a link replaces the field with the twelve
 * characters it carried, so what is on screen is always the thing being used.
 */
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
