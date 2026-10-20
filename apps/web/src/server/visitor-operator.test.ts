import { describe, expect, it } from "vitest";
import { isValidVisitorOperatorCookie, issueVisitorOperatorCookie } from "./visitor-operator";

const secret = "dev-only-fixture-operator-authorization-key-123456789";
const now = 1780000000000;

describe("visitor operator authorization", () => {
  it("validates a signed cookie only during its 30-minute lifetime", () => {
    const cookie = issueVisitorOperatorCookie(now, secret);
    expect(isValidVisitorOperatorCookie(cookie, now, secret)).toBe(true);
    expect(isValidVisitorOperatorCookie(cookie, now + 30 * 60_000, secret)).toBe(false);
    expect(isValidVisitorOperatorCookie(cookie, now, secret + "other")).toBe(false);
  });
  it("rejects tampering, future-dated, malformed and unsigned values", () => {
    const valid = issueVisitorOperatorCookie(now, secret);
    expect(isValidVisitorOperatorCookie(valid.slice(0, -1) + "x", now, secret)).toBe(false);
    expect(
      isValidVisitorOperatorCookie(issueVisitorOperatorCookie(now + 1, secret), now, secret),
    ).toBe(false);
    expect(isValidVisitorOperatorCookie("nope", now, secret)).toBe(false);
    expect(isValidVisitorOperatorCookie(valid, now)).toBe(false);
  });
});
