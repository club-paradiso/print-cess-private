// @vitest-environment jsdom
// Save destinations are browser APIs, so the choices between them can only
// be exercised where a window, a document, and an anchor exist.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  downloadTarget,
  MEMORY_SAVE_LIMIT_BYTES,
  pickDirectoryTarget,
  pickSaveTarget,
  SaveError,
  saveCapabilities,
  supportsStreamingSave,
} from "./drop-save";

/**
 * What a save is allowed to claim about itself.
 *
 * The distinction under test is the one the receiving screen used to lose: a
 * file written through a handle the visitor chose is saved, and a blob handed
 * to the download machinery has started a download and nothing more. Every
 * assertion here is about which of those two sentences the code is entitled to.
 */

const originalNavigator = globalThis.navigator;

type PickerWindow = Window & {
  showSaveFilePicker?: unknown;
  showDirectoryPicker?: unknown;
};

function clearPickers() {
  delete (window as PickerWindow).showSaveFilePicker;
  delete (window as PickerWindow).showDirectoryPicker;
}

/** A writable that records what it was given and whether it was closed. */
function fakeWritable() {
  const written: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  return {
    written,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    stream: {
      write: vi.fn(async (chunk: ArrayBuffer) => {
        written.push(new Uint8Array(chunk));
      }),
      close: vi.fn(async () => {
        closed = true;
      }),
      abort: vi.fn(async () => {
        aborted = true;
      }),
    } as unknown as FileSystemWritableFileStream,
  };
}

beforeEach(() => {
  clearPickers();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { ...originalNavigator, storage: undefined },
  });
});

afterEach(() => {
  clearPickers();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  vi.restoreAllMocks();
});

describe("saveCapabilities", () => {
  it("detects features rather than guessing from the user agent", () => {
    expect(saveCapabilities()).toMatchObject({ canPickFile: false, canPickDirectory: false });
    (window as PickerWindow).showSaveFilePicker = () => undefined;
    expect(saveCapabilities().canPickFile).toBe(true);
    // A browser that exposes a save dialog need not expose a folder one.
    expect(saveCapabilities().canPickDirectory).toBe(false);
  });

  it("reports no streaming save when nothing can stream", () => {
    expect(supportsStreamingSave()).toBe(false);
    (window as PickerWindow).showSaveFilePicker = () => undefined;
    expect(supportsStreamingSave()).toBe(true);
  });
});

describe("a file the visitor chose a place for", () => {
  it("reports a save, and only after the file is closed", async () => {
    const writable = fakeWritable();
    const handle = {
      createWritable: vi.fn(async () => writable.stream),
    } as unknown as FileSystemFileHandle;
    const picker = vi.fn(async () => handle);
    (window as PickerWindow).showSaveFilePicker = picker;

    const target = await pickSaveTarget(
      { name: "report.pdf", type: "application/pdf", size: 10 },
      { preferFilePicker: true },
    );
    expect(target.kind).toBe("picked-file");
    expect(target.outcome).toBe("saved");

    const sink = await target.open({ name: "report.pdf", type: "application/pdf" });
    await sink.write(new Uint8Array([1, 2, 3]));
    expect(writable.closed).toBe(false);

    await expect(sink.finish()).resolves.toBe("saved");
    expect(writable.closed).toBe(true);
    expect(writable.written[0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("offers the file's own name and type to the dialog", async () => {
    const picker = vi.fn(async () => ({ createWritable: async () => fakeWritable().stream }));
    (window as PickerWindow).showSaveFilePicker = picker;

    await pickSaveTarget(
      { name: "전입신고서.hwpx", type: "application/hwp+zip", size: 10 },
      { preferFilePicker: true },
    );

    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "전입신고서.hwpx" }),
    );
  });

  it("treats a dismissed dialog as a decision, not a failure to route around", async () => {
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });

    await expect(
      pickSaveTarget(
        { name: "report.pdf", type: "application/pdf", size: 10 },
        { preferFilePicker: true },
      ),
    ).rejects.toMatchObject({ code: "dropSaveCancelled" });
  });

  it("does not report a save when closing the file failed", async () => {
    const stream = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => {
        throw new Error("disk full");
      }),
      abort: vi.fn(async () => undefined),
    } as unknown as FileSystemWritableFileStream;
    (window as PickerWindow).showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => stream,
    }));

    const target = await pickSaveTarget(
      { name: "a.bin", type: "", size: 1 },
      { preferFilePicker: true },
    );
    const sink = await target.open({ name: "a.bin", type: "" });
    await expect(sink.finish()).rejects.toThrow(/disk full/u);
  });
});

describe("the download fallback", () => {
  it("never opens the Chromium save picker for a default download", async () => {
    const picker = vi.fn(async () => {
      throw new Error("File picker must be an explicit opt-in");
    });
    (window as PickerWindow).showSaveFilePicker = picker;

    const target = await pickSaveTarget({ name: "report.pdf", type: "application/pdf", size: 10 });
    expect(target.kind).toBe("download");
    expect(target.outcome).toBe("downloadStarted");
    expect(picker).not.toHaveBeenCalled();
  });

  it("reports a started download rather than a save", async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:fake");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    const target = downloadTarget(16);
    expect(target.kind).toBe("download");
    // This is the whole point: the browser was asked to download the file. That
    // it reaches storage is not something this code can observe.
    expect(target.outcome).toBe("downloadStarted");

    const sink = await target.open({ name: "photo.jpg", type: "image/jpeg" });
    await sink.write(new Uint8Array([9, 9]));
    await expect(sink.finish()).resolves.toBe("downloadStarted");
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it.each([
    ["page.html", "text/html", "application/octet-stream"],
    ["logo.svg", "image/svg+xml", "application/octet-stream"],
    ["feed.xml", "application/atom+xml", "application/octet-stream"],
    ["photo.jpg", "image/jpeg", "image/jpeg"],
  ])("hands %s over as %s → %s", async (name, type, expected) => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:fake");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    const sink = await downloadTarget(4).open({ name, type });
    await sink.write(new Uint8Array([1, 2, 3, 4]));
    await sink.finish();
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe(expected);
  });

  it("refuses a file too large to assemble in memory instead of crashing the tab", () => {
    // Without private origin storage the chunks and the blob built from them are
    // both live at once, so the real cost approaches twice the file size.
    expect(() => downloadTarget(MEMORY_SAVE_LIMIT_BYTES + 1)).toThrow(SaveError);
    expect(() => downloadTarget(MEMORY_SAVE_LIMIT_BYTES + 1)).toThrow(/dropTooLargeForBrowser/u);
    expect(() => downloadTarget(MEMORY_SAVE_LIMIT_BYTES)).not.toThrow();
  });

  it("allows a large file when it can be staged on disk instead", () => {
    const capabilities = { ...saveCapabilities(), canStage: true };
    expect(() => downloadTarget(MEMORY_SAVE_LIMIT_BYTES * 4, capabilities)).not.toThrow();
  });

  it("rejects oversized memory fallback when OPFS is advertised but access is denied", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        ...originalNavigator,
        storage: {
          getDirectory: vi.fn(async () => {
            throw new DOMException("Storage blocked by workstation policy", "SecurityError");
          }),
        },
      },
    });
    const target = downloadTarget(MEMORY_SAVE_LIMIT_BYTES + 1);
    await expect(target.open({ name: "huge.bin", type: "" })).rejects.toMatchObject({
      code: "dropTooLargeForBrowser",
    });
    // Small files still use the safe in-memory fallback when staging is denied.
    const small = downloadTarget(16);
    await expect(small.open({ name: "small.bin", type: "" })).resolves.toBeDefined();
  });
});

describe("a folder the visitor chose", () => {
  function fakeDirectory() {
    const created: string[] = [];
    const existing = new Set<string>();
    return {
      created,
      existing,
      handle: {
        requestPermission: vi.fn(async () => "granted"),
        getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
          if (!options?.create) {
            if (existing.has(name)) return { createWritable: async () => fakeWritable().stream };
            throw new DOMException("not found", "NotFoundError");
          }
          created.push(name);
          existing.add(name);
          return { createWritable: async () => fakeWritable().stream };
        }),
        removeEntry: vi.fn(async () => undefined),
      },
    };
  }

  it("writes each file into the folder and reports real saves", async () => {
    const directory = fakeDirectory();
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => directory.handle);

    const target = await pickDirectoryTarget();
    expect(target?.outcome).toBe("saved");
    const sink = await target!.open({ name: "photo.jpg", type: "image/jpeg" });
    await expect(sink.finish()).resolves.toBe("saved");
    expect(directory.created).toEqual(["photo.jpg"]);
  });

  it("never silently replaces a file already in the folder", async () => {
    const directory = fakeDirectory();
    directory.existing.add("photo.jpg");
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => directory.handle);

    const target = await pickDirectoryTarget();
    await target!.open({ name: "photo.jpg", type: "image/jpeg" });

    expect(directory.created).toEqual(["photo (2).jpg"]);
  });

  it("gives two files of the same name two different places to land", async () => {
    const directory = fakeDirectory();
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => directory.handle);

    const target = await pickDirectoryTarget();
    await target!.open({ name: "scan.pdf", type: "application/pdf" });
    await target!.open({ name: "scan.pdf", type: "application/pdf" });

    expect(directory.created).toEqual(["scan.pdf", "scan (2).pdf"]);
  });

  it("sanitizes a name that arrived from the other device", async () => {
    const directory = fakeDirectory();
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => directory.handle);

    const target = await pickDirectoryTarget();
    await target!.open({ name: "../../etc/passwd", type: "" });

    // Whatever the sender called it, nothing that reaches a directory handle
    // can contain a separator.
    expect(directory.created[0]).not.toContain("/");
    expect(directory.created[0]).not.toContain("\\");
  });

  it("returns nothing when the visitor dismisses the folder dialog", async () => {
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    await expect(pickDirectoryTarget()).resolves.toBeNull();
  });

  it("reports a refused permission rather than writing nowhere", async () => {
    const directory = fakeDirectory();
    directory.handle.requestPermission = vi.fn(async () => "denied");
    (window as PickerWindow).showDirectoryPicker = vi.fn(async () => directory.handle);

    await expect(pickDirectoryTarget()).rejects.toMatchObject({ code: "dropSaveRefused" });
  });

  it("is absent on a browser that has no folder picker", async () => {
    await expect(pickDirectoryTarget()).resolves.toBeNull();
  });
});
