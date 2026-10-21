import { afterEach, describe, expect, it, vi } from "vitest";

const { acceptLanguage } = vi.hoisted(() => ({ acceptLanguage: { value: "" } }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "accept-language": acceptLanguage.value })),
}));

import WorkstationPage from "./page";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function hrefsOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefsOf);
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { href?: unknown; children?: unknown } }).props;
    return [...(typeof props.href === "string" ? [props.href] : []), ...hrefsOf(props.children)];
  }
  return [];
}

describe("workstation page", () => {
  it("offers both transfer directions without a kiosk dependency", async () => {
    acceptLanguage.value = "en-US,en;q=0.9";

    const page = await WorkstationPage();
    const hrefs = hrefsOf(page);
    const copy = textOf(page);

    expect(hrefs).toEqual(expect.arrayContaining(["/start", "/receive", "/send"]));
    expect(copy).toContain("Use Print-cess in a managed browser, with no install");
    expect(copy).toContain("Print-cess does not bypass agency security controls");
    expect(copy).not.toContain("Open kiosk");
  });

  it("shows Korean public-sector guidance to Korean browsers", async () => {
    acceptLanguage.value = "ko-KR,ko;q=0.9,en;q=0.8";

    const copy = textOf(await WorkstationPage());

    expect(copy).toContain("국가기관 · 공공기관 업무용 PC");
    expect(copy).toContain("설치 없이, 업무용 브라우저에서 바로 사용");
    expect(copy).toContain("기관 보안정책을 우회하지 않습니다");
    expect(copy).toContain("Internet Explorer 모드나 오래된 브라우저는 지원 대상이 아닙니다");
  });

  describe("allowlist guidance", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("promises a single-origin allowlist only when the deployment can relay", async () => {
      acceptLanguage.value = "en-US";
      vi.stubEnv(
        "BLOB_READ_WRITE_TOKEN",
        ["vercel", "blob", "rw", "Store1", "synthetic"].join("_"),
      );
      expect(textOf(await WorkstationPage())).toContain("request only this site's address");
    });

    it("asks for the storage address too when transfers go to storage directly", async () => {
      acceptLanguage.value = "en-US";
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
      const copy = textOf(await WorkstationPage());
      expect(copy).not.toContain("request only this site's address");
      expect(copy).toContain("the file storage address too");
    });
  });
});
