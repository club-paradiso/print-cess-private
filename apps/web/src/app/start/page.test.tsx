import { afterEach, describe, expect, it, vi } from "vitest";

const { acceptLanguage, preferredCookie } = vi.hoisted(() => ({
  acceptLanguage: { value: "" },
  preferredCookie: { value: "" },
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({ "accept-language": acceptLanguage.value, cookie: preferredCookie.value }),
    ),
}));

import HomePage from "./page";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function headingsOf(node: unknown, level: string): string[] {
  if (Array.isArray(node)) return node.flatMap((child) => headingsOf(child, level));
  if (node && typeof node === "object" && "props" in node) {
    const element = node as { type?: unknown; props: { children?: unknown } };
    return element.type === level
      ? [textOf(element.props.children)]
      : headingsOf(element.props.children, level);
  }
  return [];
}

function sessionOriginOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sessionOriginOf).find((value) => value !== undefined);
  if (node && typeof node === "object" && "props" in node) {
    const element = node as {
      props: { labels?: unknown; sessionOrigin?: unknown; children?: unknown };
    };
    if (element.props.labels !== undefined && "sessionOrigin" in element.props) {
      return element.props.sessionOrigin ?? null;
    }
    return sessionOriginOf(element.props.children);
  }
  return undefined;
}

function entryLabelsOf(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(entryLabelsOf).find((labels) => labels !== undefined);
  if (node && typeof node === "object" && "props" in node) {
    const element = node as { props: { labels?: Record<string, unknown>; children?: unknown } };
    if (element.props.labels && "scanCta" in element.props.labels) return element.props.labels;
    return entryLabelsOf(element.props.children);
  }
  return undefined;
}

function hrefsOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefsOf);
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { href?: unknown; children?: unknown } }).props;
    return [...(typeof props.href === "string" ? [props.href] : []), ...hrefsOf(props.children)];
  }
  return [];
}

describe("home page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    acceptLanguage.value = "";
    preferredCookie.value = "";
  });

  it("keeps file hand-off, workstation, and kiosk entry discoverable when the browser kiosk is enabled", async () => {
    vi.stubEnv("ENABLE_BROWSER_KIOSK", "true");
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");
    vi.stubEnv("VERCEL_ENV", "production");

    const page = await HomePage();

    expect(page.props.className).toBe("home");
    expect(hrefsOf(page)).toEqual(
      expect.arrayContaining(["/scan", "/send", "/receive", "/workstation", "/kiosk"]),
    );
  });

  it("keeps workstation access while hiding a disabled production kiosk shortcut", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", "false");
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");
    vi.stubEnv("VERCEL_ENV", "production");

    const page = await HomePage();
    const hrefs = hrefsOf(page);

    expect(hrefs).toEqual(expect.arrayContaining(["/scan", "/send", "/receive", "/workstation"]));
    expect(hrefs).not.toContain("/kiosk");
  });

  it("shows the kiosk entry in Vercel Production when the flag is not set at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", undefined);
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");
    vi.stubEnv("VERCEL_ENV", "production");

    expect(hrefsOf(await HomePage())).toContain("/kiosk");
  });

  it("hides the kiosk entry in a production build outside Vercel unless it is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", undefined);
    vi.stubEnv("ENABLE_DEMO_ROUTES", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);

    expect(hrefsOf(await HomePage())).not.toContain("/kiosk");
  });

  it("lets the scanner accept codes for the configured public origin", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://paradiso-print-cess-web.vercel.app");
    expect(sessionOriginOf(await HomePage())).toBe("https://paradiso-print-cess-web.vercel.app");

    vi.stubEnv("PUBLIC_BASE_URL", "https://print.example/not-an-origin");
    expect(sessionOriginOf(await HomePage())).toBeNull();
  });

  it("keeps the public entry page on the dedicated kiosk Preview branch", async () => {
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "preview");

    const page = await HomePage();

    expect(page.props.className).toBe("home");
    expect(hrefsOf(page)).toEqual(
      expect.arrayContaining(["/scan", "/send", "/receive", "/workstation", "/kiosk"]),
    );
  });

  it("greets a visitor in the language their browser asked for", async () => {
    acceptLanguage.value = "ko-KR,ko;q=0.9,en;q=0.8";

    const copy = textOf(await HomePage());

    expect(copy).toContain("프린터 옆 화면의 QR 코드를 찍으세요");
    expect(copy).toContain("Print-cess 화면은 프린터 바로 옆에 있어요.");
    expect(copy).toContain("휴대전화 카메라로 찍으면 인쇄할 파일을 고르는 화면이 열려요.");
    expect(copy).toContain("이 표시가 있는 화면을 찾으세요.");
    expect(copy).toContain("세 번이면 끝나요");
    expect(copy).toContain("QR 찍기");
    expect(copy).toContain("파일 고르기");
    expect(copy).toContain("종이 받기");
    expect(copy).toContain("이런 것도 돼요");
    expect(copy).toContain("공유");
    expect(copy).toContain("스캔");
    expect(copy).toContain("보낼 파일 고르기");
    expect(copy).toContain("코드로 파일 받기");
    expect(copy).toContain("문서 스캔하기");
    expect(copy).toContain("업무용 PC");
    expect(copy).toContain("이 기기를 Print-cess 화면으로 쓰기");
    expect(copy).not.toContain("Here to print?");
    expect(copy).not.toContain("키오스크");
    expect(entryLabelsOf(await HomePage())).toMatchObject({
      scanCta: "QR 코드 찍기",
      lostCta: "화면을 못 찾겠어요",
    });
  });

  it("keeps an explicit language choice on the landing page despite the browser preference", async () => {
    acceptLanguage.value = "en-US,en;q=0.9";
    preferredCookie.value = "print-cess-locale=vi";
    const copy = textOf(await HomePage());
    expect(copy).not.toContain("Here to print?");
    expect(copy).not.toContain("프린터 옆 화면의 QR 코드를 찍으세요");
    expect(copy).toContain("Print-cess");
  });

  it("falls back to English when no language is asked for", async () => {
    const copy = textOf(await HomePage());

    expect(copy).toContain("Here to print?");
    expect(copy).toContain("Find the Print-cess screen next to the printer.");
    expect(copy).toContain("Choose files to send");
    expect(copy).toContain("Receive files with a code");
    expect(copy).toContain("Scan a document");
    expect(copy).toContain("Work computer");
    expect(copy).toContain("Use this device as the print screen");
    expect(copy).not.toContain("kiosk");
  });

  it("keeps the setup entrances below every visitor tool", async () => {
    const page = await HomePage();
    const order = hrefsOf(page);

    expect(headingsOf(page, "h1")).toEqual(["Here to print?"]);
    expect(headingsOf(page, "h2")).toEqual([
      "How printing works",
      "More you can do here",
      "At work or on a public computer",
    ]);
    expect(headingsOf(page, "h3")).toEqual(["Share", "Scan"]);
    for (const visitorLink of ["/send", "/receive", "/scan"]) {
      expect(order.indexOf(visitorLink)).toBeLessThan(order.indexOf("/kiosk"));
      expect(order.indexOf(visitorLink)).toBeLessThan(order.indexOf("/workstation"));
    }
  });

  it("shows the Beacon first and the three steps after it, without the old find-the-screen step", async () => {
    const copy = textOf(await HomePage());

    expect(copy).toContain("Look for the screen with this mark.");
    expect(copy).not.toContain("Find the screen");
    const beacon = copy.indexOf("Look for the screen with this mark.");
    const steps = ["Scan its QR code", "Pick your file", "Take your paper"].map((step) =>
      copy.indexOf(step),
    );
    for (const step of steps) expect(step).toBeGreaterThan(beacon);
    expect(steps).toEqual([...steps].sort((first, second) => first - second));
    expect(steps[2]).toBeLessThan(copy.indexOf("Choose files to send"));
  });

  it("gives the rescue sheet and the scanner every word they show", async () => {
    const labels = entryLabelsOf(await HomePage()) as Record<string, unknown>;

    expect(labels.scanCta).toBe("Scan QR code");
    expect(labels.lostCta).toBe("I can't find the screen");
    expect(labels.lostSteps).toEqual([
      "Find the printer",
      "Find the big screen beside it",
      "Scan the QR code on that screen",
    ]);
    for (const [name, value] of Object.entries(labels)) {
      expect(value, name).toBeTruthy();
    }
  });

  it("never offers a print button that has nowhere honest to go", async () => {
    const hrefs = hrefsOf(await HomePage());

    expect(hrefs.some((href) => href.startsWith("/s/"))).toBe(false);
    expect(hrefs).not.toContain("/print");
  });
});
