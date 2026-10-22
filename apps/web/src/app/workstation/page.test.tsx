import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import WorkstationPage from "./page";

describe("legacy workstation entry", () => {
  it("routes to the common tools and their environment diagnostics", () => {
    WorkstationPage();
    expect(redirectMock).toHaveBeenCalledWith("/start#environment");
  });
});
