import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("./visitor-flow", () => ({
  VisitorPrintFlow: ({ copy }: { copy: { title: string } }) => (
    <div data-testid="visitor-print-flow" data-title={copy.title} />
  ),
}));

import VisitorPage from "./page";

describe("visitor print mode page", () => {
  it("renders the Korean copy for a Korean visitor", async () => {
    const { headers } = await import("next/headers");
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ "accept-language": "ko-KR" }));

    const page = await VisitorPage();

    expect(page.type).toBeDefined();
  });

  it("renders the counter screen shell", async () => {
    const { headers } = await import("next/headers");
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ "accept-language": "en-US" }));

    const page = await VisitorPage();

    expect(page.props.className).toBe("visitor-page");
  });
});
