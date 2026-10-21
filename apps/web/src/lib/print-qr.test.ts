import { describe, expect, it } from "vitest";

import { parsePrintSessionQr, sessionOriginFrom } from "./print-qr";

const ORIGIN = "https://print.example";
const SESSION_ID = `${"A".repeat(21)}A`;
const TOKEN = "A".repeat(43);
const FRAGMENT = `#t=${TOKEN}&fp=${TOKEN}`;
const VALID = `${ORIGIN}/s/${SESSION_ID}${FRAGMENT}`;

describe("print QR validation", () => {
  it("accepts the code a Print-cess screen draws and returns a path on this site", () => {
    expect(parsePrintSessionQr(VALID, ORIGIN)).toBe(`/s/${SESSION_ID}${FRAGMENT}`);
  });

  it("keeps the capability flags the screen declared", () => {
    const withFlags = `${VALID}&hwpx=1&bundle=1`;
    expect(parsePrintSessionQr(withFlags, ORIGIN)).toBe(
      `/s/${SESSION_ID}${FRAGMENT}&hwpx=1&bundle=1`,
    );
  });

  it("tolerates whitespace around the scanned text", () => {
    expect(parsePrintSessionQr(`  ${VALID}\n`, ORIGIN)).toBe(`/s/${SESSION_ID}${FRAGMENT}`);
  });

  it("never navigates to another origin, however much it looks like a session", () => {
    expect(parsePrintSessionQr(VALID.replace(ORIGIN, "https://evil.example"), ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(VALID.replace("https://", "http://"), ORIGIN)).toBeNull();
    expect(
      parsePrintSessionQr(VALID.replace(ORIGIN, "https://print.example.evil.example"), ORIGIN),
    ).toBeNull();
    expect(
      parsePrintSessionQr(
        VALID.replace("https://print.example", "https://user:pw@print.example"),
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("rejects content that is not a URL, or not a session URL", () => {
    expect(parsePrintSessionQr("WIFI:S:cafe;T:WPA;P:hunter2;;", ORIGIN)).toBeNull();
    expect(parsePrintSessionQr("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(parsePrintSessionQr("/s/" + SESSION_ID + FRAGMENT, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${ORIGIN}/send${FRAGMENT}`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${ORIGIN}/s/${SESSION_ID}/extra${FRAGMENT}`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${ORIGIN}/s/not-a-session${FRAGMENT}`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr("", ORIGIN)).toBeNull();
  });

  it("rejects a session link whose credentials are missing, malformed or extended", () => {
    expect(parsePrintSessionQr(`${ORIGIN}/s/${SESSION_ID}`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${ORIGIN}/s/${SESSION_ID}#t=${TOKEN}`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${VALID}&next=https://evil.example`, ORIGIN)).toBeNull();
    expect(parsePrintSessionQr(`${ORIGIN}/s/${SESSION_ID}?next=/x${FRAGMENT}`, ORIGIN)).toBeNull();
  });

  it("ignores absurdly long content before parsing it", () => {
    expect(parsePrintSessionQr(`${VALID}${"a".repeat(600)}`, ORIGIN)).toBeNull();
  });

  it("accepts a code naming the deployment's configured origin and stays on this one", () => {
    const configured = "https://paradiso-print-cess-web.vercel.app";
    const fromKiosk = `${configured}/s/${SESSION_ID}${FRAGMENT}`;

    expect(parsePrintSessionQr(fromKiosk, ORIGIN, [configured])).toBe(
      `/s/${SESSION_ID}${FRAGMENT}`,
    );
    expect(parsePrintSessionQr(fromKiosk, ORIGIN)).toBeNull();
    expect(
      parsePrintSessionQr(
        `https://paradiso-print-cess-web.vercel.app.evil.example/s/${SESSION_ID}${FRAGMENT}`,
        ORIGIN,
        [configured],
      ),
    ).toBeNull();
  });
});

describe("configured session origin", () => {
  it("trusts only a bare http(s) origin", () => {
    expect(sessionOriginFrom("https://print.example")).toBe("https://print.example");
    expect(sessionOriginFrom("https://print.example/")).toBe("https://print.example");
    expect(sessionOriginFrom(undefined)).toBeUndefined();
    expect(sessionOriginFrom("")).toBeUndefined();
    expect(sessionOriginFrom("not a url")).toBeUndefined();
    expect(sessionOriginFrom("https://print.example/app")).toBeUndefined();
    expect(sessionOriginFrom("https://print.example/?x=1")).toBeUndefined();
    expect(sessionOriginFrom("https://user@print.example")).toBeUndefined();
    expect(sessionOriginFrom("javascript:alert(1)")).toBeUndefined();
  });
});
