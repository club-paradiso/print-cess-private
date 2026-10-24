import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  chooseSenderShape,
  handOver,
  readShortCode,
  waitForReceiveHydration,
} from "./pairing-helpers";

const FILE_NAME = "paradiso-note.txt";
const CONTENTS = "Paradiso hand-off\n".repeat(2048);

async function useDownloadFallback(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });
}

async function pickFile(page: Page, name: string, body: string): Promise<void> {
  await page.setInputFiles('[data-testid="drop-file-input"]', {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(body, "utf8"),
  });
}

async function readTransferCode(page: Page): Promise<string> {
  const ready = page.locator(".drop-ready");
  await expect(ready).toHaveAttribute("data-transfer-code", /^[0-9A-HJKMNP-TV-Z]{12}$/u, {
    timeout: 120_000,
  });
  return (await ready.getAttribute("data-transfer-code"))!;
}

test("hands a file from one phone to another and back to disk", async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  await useDownloadFallback(receiver);

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await expect(sending.getByRole("heading", { name: /Pick the files|보낼 파일/u })).toBeVisible();

    await pickFile(sending, FILE_NAME, CONTENTS);
    await expect(sending.getByText(FILE_NAME)).toBeVisible();

    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await handOver(sending, receiving);

    await expect(receiving.getByText(FILE_NAME)).toBeVisible({ timeout: 60_000 });

    const download = receiving.waitForEvent("download", { timeout: 120_000 });
    await receiving.getByRole("button", { name: /Save to my phone|휴대전화에 저장하기/u }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(FILE_NAME);

    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(CONTENTS);

    await expect(receiving.getByText(/Download started|내려받기를 시작했어요/u)).toBeVisible();
    await expect(receiving.getByText(/handed over|건네줬어요/u)).toBeVisible();

    await expect(sending.getByText(/has taken the files|받아 갔어요/u)).toBeVisible({
      timeout: 60_000,
    });
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("defaults to permission-free downloads on a desktop receiver with file pickers", async ({
  browser,
}) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  await receiver.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "__printCessPickerCalls", { value: calls });
    for (const name of ["showSaveFilePicker", "showDirectoryPicker"]) {
      Object.defineProperty(window, name, {
        configurable: true,
        value: () => {
          calls.push(name);
          throw new Error(`Unexpected file-system picker: ${name}`);
        },
      });
    }
  });

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await sending.setInputFiles('[data-testid="drop-file-input"]', [
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);
    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await handOver(sending, receiving);
    await expect(receiving.getByText("second.txt")).toBeVisible({ timeout: 60_000 });

    const firstDownload = receiving.waitForEvent("download", { timeout: 120_000 });
    await receiving
      .locator(".drop-file-list--actions > li")
      .first()
      .getByRole("button", { name: /^Save$|^저장하기$/u })
      .click();
    expect((await firstDownload).suggestedFilename()).toBe("first.txt");

    const secondDownload = receiving.waitForEvent("download", { timeout: 120_000 });
    await receiving.locator(".drop-receive-files .mobile-actions > button").first().click();
    expect((await secondDownload).suggestedFilename()).toBe("second.txt");

    const pickerCalls = await receiving.evaluate(
      () => (window as unknown as { __printCessPickerCalls: string[] }).__printCessPickerCalls,
    );
    expect(pickerCalls).toEqual([]);
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("saves one of several files without fetching the rest", async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  await useDownloadFallback(receiver);

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await sending.setInputFiles('[data-testid="drop-file-input"]', [
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first\n") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second\n") },
      { name: "third.txt", mimeType: "text/plain", buffer: Buffer.from("third\n") },
    ]);
    await expect(sending.getByText("second.txt")).toBeVisible();

    await sending.getByRole("button", { name: /Remove second\.txt|second\.txt 빼기/u }).click();
    await expect(sending.getByText("second.txt")).toHaveCount(0);
    await expect(sending.getByText("first.txt")).toBeVisible();
    await expect(sending.getByText("third.txt")).toBeVisible();

    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await handOver(sending, receiving);
    await expect(receiving.getByText("third.txt")).toBeVisible({ timeout: 60_000 });

    const downloads: string[] = [];
    receiving.on("download", (download) => downloads.push(download.suggestedFilename()));
    const rows = receiving.locator(".drop-file-list--actions > li");
    await rows
      .nth(1)
      .getByRole("button", { name: /^Save$|^저장하기$/u })
      .click();

    await expect(rows.nth(1).getByText(/Download started|내려받기를 시작했어요/u)).toBeVisible({
      timeout: 60_000,
    });
    await expect(rows.nth(0).getByText(/Not saved yet|아직 저장 안 했어요/u)).toBeVisible();
    expect(downloads).toEqual(["third.txt"]);
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("lets a receiver scan before the sender has finished uploading", async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  await useDownloadFallback(receiver);

  try {
    const sending = await sender.newPage();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await sending.route("**/api/dev/blob**", async (route) => {
      if (route.request().method() === "PUT") await held;
      await route.continue();
    });

    await sending.goto("/send");
    await pickFile(sending, FILE_NAME, "waiting for the receiver\n");
    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    const transferCode = await readTransferCode(sending);
    const receiving = await receiver.newPage();
    await receiving.goto(`/receive#c=${transferCode}`);

    await expect(receiving.getByRole("heading", { name: /Connected|연결됐어요/u })).toBeVisible({
      timeout: 60_000,
    });
    await expect(receiving.getByText(/still being prepared|준비하고 있어요/u)).toBeVisible();
    await expect(receiving.getByText(FILE_NAME)).toHaveCount(0);

    release();
    await expect(receiving.getByText(FILE_NAME)).toBeVisible({ timeout: 120_000 });
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("opens a transfer from a pasted link, not just from twelve characters", async ({
  browser,
}) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext({ acceptDownloads: true });
  await useDownloadFallback(receiver);

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await pickFile(sending, FILE_NAME, "pasted link\n");
    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();
    const transferCode = await readTransferCode(sending);

    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await waitForReceiveHydration(receiving);
    await receiving.getByRole("group").click();
    await receiving
      .getByTestId("drop-code-input")
      .fill(`http://127.0.0.1:3000/receive#c=${transferCode}`);

    await expect(receiving.getByText(FILE_NAME)).toBeVisible({ timeout: 60_000 });
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("says so plainly when a transfer code matches nothing", async ({ page }) => {
  await page.goto("/receive");
  await waitForReceiveHydration(page);
  await page.getByRole("group").click();
  await page.getByTestId("drop-code-input").fill("2345-6789-ABCD");
  await page.getByRole("button", { name: /Show me the files|파일 확인하기/u }).click();

  await expect(
    page.getByRole("heading", { name: /No transfer matches that code|맞는 전송이 없어요/u }),
  ).toBeVisible({ timeout: 60_000 });
});

test("keeps the transfer code out of request URLs", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => sent.push(request.url()));

  await page.goto("/send");
  await pickFile(page, FILE_NAME, "short");
  await page.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

  const transferCode = (await readTransferCode(page)).replaceAll("-", "");

  expect(transferCode).toHaveLength(12);
  for (const url of sent) {
    expect(url).not.toContain(transferCode);
  }
});

test("consumes the pairing after two wrong shapes", async ({ browser }) => {
  const sender = await browser.newContext();
  const receiver = await browser.newContext();

  try {
    const sending = await sender.newPage();
    await sending.goto("/send");
    await pickFile(sending, FILE_NAME, "held back\n");
    await sending.getByRole("button", { name: /Send these files|이 파일 보내기/u }).click();

    await chooseSenderShape(sending, "star");
    const shortCode = await readShortCode(sending);
    const receiving = await receiver.newPage();
    await receiving.goto("/receive");
    await waitForReceiveHydration(receiving);
    for (const digit of shortCode) {
      await receiving.getByTestId(`pairing-key-${digit}`).click();
    }

    await expect(receiving.getByTestId("pairing-shape-circle")).toBeVisible({ timeout: 60_000 });
    await receiving.getByTestId("pairing-shape-circle").click();
    await expect(receiving.getByText(/numbers and shape|숫자와 도형/u)).toBeVisible();
    await expect(receiving.getByText(FILE_NAME)).toHaveCount(0);

    for (const digit of shortCode) {
      await receiving.getByTestId(`pairing-key-${digit}`).click();
    }
    await receiving.getByTestId("pairing-shape-triangle").click();
    await expect(receiving.getByText(/numbers and shape|숫자와 도형/u)).toBeVisible();

    for (const digit of shortCode) {
      await receiving.getByTestId(`pairing-key-${digit}`).click();
    }
    await receiving.getByTestId("pairing-shape-star").click();
    await expect(receiving.getByText(/numbers and shape|숫자와 도형/u)).toBeVisible();
    await expect(receiving.getByText(FILE_NAME)).toHaveCount(0);
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test("says so plainly when four digits match nothing", async ({ page }) => {
  await page.goto("/receive");
  await waitForReceiveHydration(page);
  for (let index = 0; index < 4; index += 1) {
    await page.getByTestId("pairing-key-0").click();
  }
  await page.getByTestId("pairing-shape-circle").click();

  await expect(page.getByText(/numbers and shape|숫자와 도형/u)).toBeVisible({
    timeout: 60_000,
  });
});
