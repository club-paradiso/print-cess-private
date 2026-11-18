import { describe, expect, it } from "vitest";

import { splitFirstSentence } from "./first-sentence";

describe("splitFirstSentence", () => {
  it("separates what happened from what to do", () => {
    expect(
      splitFirstSentence("QR코드 정보가 완전하지 않아요. 큰 화면의 QR코드를 다시 스캔하세요."),
    ).toEqual(["QR코드 정보가 완전하지 않아요.", "큰 화면의 QR코드를 다시 스캔하세요."]);
  });

  it("splits on full-width and Indic sentence marks", () => {
    expect(splitFirstSentence("这个链接不完整。请重新扫大屏幕上的二维码。")).toEqual([
      "这个链接不完整。",
      "请重新扫大屏幕上的二维码。",
    ]);
    expect(splitFirstSentence("लिङ्क पूरा छैन। फेरि स्क्यान गर्नुहोस्।")).toEqual([
      "लिङ्क पूरा छैन।",
      "फेरि स्क्यान गर्नुहोस्।",
    ]);
  });

  it("leaves a single sentence, or unpunctuated text, whole", () => {
    expect(splitFirstSentence("All done")).toEqual(["All done", ""]);
    expect(splitFirstSentence("Printing failed.")).toEqual(["Printing failed.", ""]);
    expect(splitFirstSentence("ลิงก์นี้ไม่สมบูรณ์ สแกนใหม่")).toEqual(["ลิงก์นี้ไม่สมบูรณ์ สแกนใหม่", ""]);
  });

  it("does not split inside a number or a file extension", () => {
    expect(splitFirstSentence("Keep PDFs under 10.5 MB. Try again.")).toEqual([
      "Keep PDFs under 10.5 MB.",
      "Try again.",
    ]);
  });
});
