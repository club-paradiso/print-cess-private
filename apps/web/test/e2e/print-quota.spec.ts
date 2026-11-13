import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createSyntheticPdf, createSyntheticPng } from "@print-cess/test-fixtures";

let kioskRateLimitBucket = 0;

async function openMobile(
  kiosk: Page,
  context: BrowserContext,
  kioskPath = "/kiosk",
): Promise<Page> {
  kioskRateLimitBucket += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${kioskRateLimitBucket}`,
  });

  await kiosk.request.get("/api/sessions/e2e-cold-start/claim", { timeout: 60_000 });
  await kiosk.goto(kioskPath);
  const qr = kiosk.locator(".kiosk-qr");
  await expect(qr).toHaveAttribute("data-session-url", /#t=/u, { timeout: 60_000 });
  const mobile = await context.newPage();
  await mobile.goto((await qr.getAttribute("data-session-url"))!);
  await expect(mobile.getByRole("heading", { name: "Pick files to print" })).toBeVisible({
    timeout: 60_000,
  });
  return mobile;
}

async function pickPdf(mobile: Page, pages: number): Promise<void> {
  await mobile.getByTestId("file-input").setInputFiles({
    name: `synthetic-${pages}p.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(await createSyntheticPdf(pages)),
  });
}

const staffNotice = (page: Page) =>
  page.getByText(
    "Printing more than 11 pages requires staff approval at the Windows kiosk. Files will not print until staff approve.",
    { exact: true },
  );

test("eleven pages is the last selection that just prints", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 11);
  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toBeVisible();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
});

test("twelve pages shows the staff-approval notice without a fake paywall", async ({
  page,
  context,
}) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 12);

  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toBeVisible();
  await expect(staffNotice(mobile)).toBeVisible();
  await expect(mobile.getByRole("button", { name: "Print 1 copy" })).toBeVisible();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
});

test("a 37-page PDF requires staff approval and offers no checkout", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 37);

  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toBeVisible();
  await expect(staffNotice(mobile)).toBeVisible();
  await expect(mobile.getByText("₩999,000")).toHaveCount(0);
  await expect(mobile.getByText("₩20,000,000")).toHaveCount(0);
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
});

test("staff authorization is not offered on the visitor's phone", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 20);

  await expect(staffNotice(mobile)).toBeVisible();
  await expect(mobile.getByRole("button", { name: "Staff access" })).toHaveCount(0);
  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toBeVisible();
});

test("past the technical ceiling the joke stops", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 51);

  const dialog = mobile.getByRole("dialog", {
    name: "This is more than the printer can take.",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("51 pages", { exact: true })).toBeVisible();
  await expect(dialog.getByText("50 pages", { exact: true })).toBeVisible();
  await expect(dialog.getByText("₩999,000")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
});

test("a mixed batch is judged on its total, not file by file", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await mobile.getByTestId("file-input").setInputFiles([
    {
      name: "a-7p.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await createSyntheticPdf(7)),
    },
    {
      name: "b.png",
      mimeType: "image/png",
      buffer: Buffer.from(await createSyntheticPng(800, 1100)),
    },
    {
      name: "c-4p.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await createSyntheticPdf(4)),
    },
  ]);

  await expect(mobile.getByRole("heading", { name: "Check these files" })).toBeVisible();
  await expect(mobile.locator("ol.mobile-selected > li")).toHaveCount(3);
  await expect(staffNotice(mobile)).toBeVisible();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
});

test("a batch one page under the limit still prints", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await mobile.getByTestId("file-input").setInputFiles([
    {
      name: "a-7p.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await createSyntheticPdf(7)),
    },
    {
      name: "b.png",
      mimeType: "image/png",
      buffer: Buffer.from(await createSyntheticPng(800, 1100)),
    },
    {
      name: "c-3p.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await createSyntheticPdf(3)),
    },
  ]);
  await expect(mobile.getByRole("heading", { name: "Check these files" })).toBeVisible();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
});

test("the staff-approval preview has no accessibility violations", async ({ page, context }) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 24);
  await expect(staffNotice(mobile)).toBeVisible();

  const results = await new AxeBuilder({ page: mobile })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("@viewport the staff-approval preview fits a phone without sideways scrolling", async ({
  page,
  context,
}) => {
  const mobile = await openMobile(page, context);
  await pickPdf(mobile, 37);
  await expect(staffNotice(mobile)).toBeVisible();

  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("browser kiosk rejects staff-only jobs before printing any page", async ({
  page,
  context,
}) => {
  const mobile = await openMobile(page, context, "/kiosk?printing=auto");
  await pickPdf(mobile, 12);
  await expect(staffNotice(mobile)).toBeVisible();

  await mobile.getByRole("button", { name: "Print 1 copy" }).click();
  await expect(page.getByRole("heading", { name: "지금은 인쇄할 수 없어요" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("heading", { name: "인쇄가 시작됐어요" })).toHaveCount(0);
  await expect(mobile.getByRole("heading", { name: "The printer could not finish." })).toBeVisible({
    timeout: 60_000,
  });
});
