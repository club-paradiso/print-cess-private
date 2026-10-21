import { createHash } from "node:crypto";
import { expect, test, type Download } from "@playwright/test";

import { handOver } from "./pairing-helpers";

/**
 * Hancom documents are the format this service exists for, and in Korea they
 * arrive with Korean file names and, on most phones, no MIME type at all. The
 * hand-off is deliberately format-blind, so this guards the two things that
 * actually break in practice: the bytes and the name.
 */

/** A structurally real HWPX: a ZIP whose first entry is a STORED `mimetype`. */
function hwpxBytes(): Buffer {
  const name = Buffer.from("mimetype", "ascii");
  const mime = Buffer.from("application/hwp+zip", "ascii");
  let crc = ~0;
  for (const byte of mime) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(~crc >>> 0, 14);
  header.writeUInt32LE(mime.length, 18);
  header.writeUInt32LE(mime.length, 22);
  header.writeUInt16LE(name.length, 26);
  // The padding stands in for the rest of the package.
  return Buffer.concat([header, name, mime, Buffer.alloc(3000, 0x5a)]);
}

/** A legacy HWP begins with the OLE compound-file signature. */
function hwpBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(2000, 0x11),
  ]);
}

async function digestOf(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

test("hands Hancom documents over byte-identically, Korean names included", async ({ browser }) => {
  test.setTimeout(300_000);
  const hwpx = hwpxBytes();
  const hwp = hwpBytes();
  const expected = new Map([
    ["전입신고서.hwpx", createHash("sha256").update(hwpx).digest("hex")],
    ["임대차계약서.hwp", createHash("sha256").update(hwp).digest("hex")],
  ]);

  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  // Chromium's save and folder dialogs are native and cannot be driven, so this
  // run takes the fallback every other browser uses: assemble, then hand the
  // file to the download machinery, which is the path a test can observe.
  await receiver.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await sending.setInputFiles('[data-testid="drop-file-input"]', [
      // Phones commonly report no MIME type for Hancom documents.
      { name: "전입신고서.hwpx", mimeType: "", buffer: hwpx },
      { name: "임대차계약서.hwp", mimeType: "application/x-hwp", buffer: hwp },
    ]);
    await expect(sending.getByText("전입신고서.hwpx")).toBeVisible();
    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await handOver(sending, receiving);
    await expect(receiving.getByText("임대차계약서.hwp")).toBeVisible({ timeout: 60_000 });

    const downloads: Download[] = [];
    receiving.on("download", (download) => downloads.push(download));
    await receiving.getByRole("button", { name: /Save to my phone|휴대전화에 저장하기/u }).click();
    await expect(receiving.getByText(/handed over|건네줬어요/u)).toBeVisible({
      timeout: 180_000,
    });

    expect(downloads).toHaveLength(2);

    // The bytes are the claim that matters, and they are checked by digest
    // against every fixture rather than by trusting the name that came back.
    const arrived = new Set<string>();
    for (const download of downloads) arrived.add(await digestOf(download));
    expect(arrived).toEqual(new Set(expected.values()));

    // The name is checked wherever the browser reports one. Outside a UTF-8
    // locale a browser sanitizes a non-ASCII download name down to the generic
    // "download" even though the page set the attribute correctly — which is
    // why CI pins `LANG`/`LC_ALL` to `C.UTF-8`, and why the strict assertion
    // below is the one that runs there. A run in a locale that cannot carry
    // the name says so instead of failing for a reason that has nothing to do
    // with the service. `drop-file-name.test.ts` pins the name the page sets.
    const reported = downloads
      .map((download) => download.suggestedFilename())
      .filter((name) => name !== "download");
    if (reported.length === downloads.length) {
      expect(reported.sort()).toEqual(["임대차계약서.hwp", "전입신고서.hwpx"]);
    } else {
      test.info().annotations.push({
        type: "locale-limitation",
        description: "This run's locale cannot carry a non-ASCII download name.",
      });
    }

    // What the visitor reads on screen is the real name either way.
    await expect(receiving.getByText("전입신고서.hwpx")).toBeVisible();
  } finally {
    await sender.close();
    await receiver.close();
  }
});
