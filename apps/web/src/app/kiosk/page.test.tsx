import { afterEach, describe, expect, it, vi } from "vitest";

const { notFound } = vi.hoisted(() => ({ notFound: vi.fn() }));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "accept-language": "ko-KR,ko;q=0.9" })),
}));
vi.mock("@/components/kiosk/kiosk-simulator", () => ({
  KioskSimulator: ({ automaticPrinting }: { automaticPrinting?: boolean }) => (
    <div data-testid="kiosk-simulator" data-automatic-printing={automaticPrinting} />
  ),
}));

import BrowserKioskPage from "./page";

describe("public browser kiosk page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    notFound.mockReset();
  });

  it("renders in Production when the browser kiosk is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", "true");
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");

    const page = await BrowserKioskPage({ searchParams: Promise.resolve({}) });

    expect(notFound).not.toHaveBeenCalled();
    expect(page.type).toBeDefined();
  });

  it("enables the managed automatic-printing completion screen explicitly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", "true");

    const page = await BrowserKioskPage({
      searchParams: Promise.resolve({ printing: "auto" }),
    });

    expect(page.props.automaticPrinting).toBe(true);
  });

  it("stays hidden in Production when the browser kiosk is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_BROWSER_KIOSK", "false");
    vi.stubEnv("ENABLE_DEMO_ROUTES", "false");

    await BrowserKioskPage({ searchParams: Promise.resolve({}) });

    expect(notFound).toHaveBeenCalledOnce();
  });
});
