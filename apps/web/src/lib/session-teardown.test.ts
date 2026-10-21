// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearBrowserSiteData } from "./session-teardown";

describe("session teardown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("empties every store this origin can reach and asks the server to clear the rest", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const cacheDelete = vi.fn().mockResolvedValue(true);
    const unregister = vi.fn().mockResolvedValue(true);
    const deleteDatabase = vi.fn(() => {
      const request = {} as IDBOpenDBRequest & { onsuccess?: () => void };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", { keys: async () => ["assets", "pdf"], delete: cacheDelete });
    vi.stubGlobal("indexedDB", { databases: async () => [{ name: "leftover" }], deleteDatabase });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
    });

    window.localStorage.setItem("stale", "value");
    window.sessionStorage.setItem("stale", "value");

    await clearBrowserSiteData();

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(cacheDelete.mock.calls.map(([name]) => name)).toEqual(["assets", "pdf"]);
    expect(deleteDatabase).toHaveBeenCalledWith("leftover");
    expect(unregister).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session-end",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("still finishes when the browser refuses a step or the request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", {
      keys: async () => {
        throw new Error("denied");
      },
      delete: vi.fn(),
    });
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn() });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => {
          throw new Error("denied");
        },
      },
    });

    await expect(clearBrowserSiteData()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
