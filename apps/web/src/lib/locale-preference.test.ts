import { describe, expect, it } from "vitest";

import { preferredLocaleFromCookie, VISITOR_LOCALE_COOKIE } from "./locale-preference";

describe("explicit visitor language", () => {
  it("accepts every supported locale, including right-to-left languages", () => {
    for (const code of [
      "ko",
      "en",
      "zh-CN",
      "id",
      "fil",
      "vi",
      "th",
      "ne",
      "km",
      "ar",
      "ru",
      "mn",
      "uk",
    ]) {
      expect(preferredLocaleFromCookie(`${VISITOR_LOCALE_COOKIE}=${code}`)).toBe(code);
    }
  });

  it("reads the preference among unrelated cookies", () => {
    expect(preferredLocaleFromCookie("visit=one; print-cess-locale=vi; theme=light")).toBe("vi");
  });

  it("rejects unsupported and malformed cookie values", () => {
    expect(preferredLocaleFromCookie("print-cess-locale=xx")).toBeUndefined();
    expect(preferredLocaleFromCookie("print-cess-locale=%")).toBeUndefined();
    expect(preferredLocaleFromCookie("print-cess-locale=ko-KR")).toBeUndefined();
    expect(preferredLocaleFromCookie(null)).toBeUndefined();
  });
});
