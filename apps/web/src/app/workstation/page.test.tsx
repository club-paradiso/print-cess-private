import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import WorkstationPage from "./page";

describe("legacy workstation entry", () => {
  it("routes directly to the public home without a workstation loop", () => {
    WorkstationPage();
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
