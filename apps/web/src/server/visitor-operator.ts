import { createHmac, timingSafeEqual } from "node:crypto";

/** A bounded operator authorization cookie; no operator secret is put into browser bundles. */
export const VISITOR_OPERATOR_COOKIE = "pc_visitor_operator";
const VALID_FOR_MS = 30 * 60_000;
const DOMAIN = "print-cess:visitor-operator:v1:";

function signature(expiration: string, key: string): Buffer {
  return createHmac("sha256", key).update(DOMAIN + expiration).digest();
}

export function issueVisitorOperatorCookie(
  now = Date.now(),
  key = process.env.KIOSK_REGISTRATION_SECRET,
): string {
  if (!key || key.length < 32) {
    throw new Error("Operator signing key is not configured.");
  }
  const expiration = String(now + VALID_FOR_MS);
  return `${expiration}.${signature(expiration, key).toString("base64url")}`;
}

export function isValidVisitorOperatorCookie(
  token: string | undefined,
  now = Date.now(),
  key = process.env.KIOSK_REGISTRATION_SECRET,
): boolean {
  if (
    !key ||
    key.length < 32 ||
    !token ||
    !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return false;
  }
  const [expiration, mac] = token.split(".");
  const expires = Number(expiration);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= now ||
    expires > now + VALID_FOR_MS
  ) {
    return false;
  }
  const candidate = Buffer.from(mac, "base64url");
  const expected = signature(expiration, key);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
