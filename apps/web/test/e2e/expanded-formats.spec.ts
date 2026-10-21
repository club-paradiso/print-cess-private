import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function openMobileAtFilePicker(
  kiosk: Page,
  context: BrowserContext,
  kioskPath = "/kiosk",
): Promise<Page> {
  await kiosk.goto(kioskPath);
  const qr = kiosk.locator(".kiosk-qr");
  await expect(qr).toHaveAttribute("data-session-url", /#t=/u, { timeout: 60_000 });
  const sessionUrl = (await qr.getAttribute("data-session-url"))!;

  const mobile = await context.newPage();
  await mobile.goto(sessionUrl);
  await expect(mobile.getByRole("heading", { name: "Pick files to print" })).toBeVisible({
    timeout: 20_000,
  });
  return mobile;
}

async function createWebpBytes(page: Page): Promise<Buffer | undefined> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#008a8a";
    context.fillRect(12, 16, 56, 88);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    if (!blob || blob.type !== "image/webp") return undefined;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return bytes ? Buffer.from(bytes) : undefined;
}

test("WebP is normalized on the phone and printed through the JPEG path", async ({
  page,
  context,
}) => {
  const mobile = await openMobileAtFilePicker(page, context, "/kiosk?printing=auto");
  const webp = await createWebpBytes(mobile);
  test.skip(!webp, "This browser project cannot encode the synthetic WebP fixture.");

  await mobile.getByTestId("file-input").setInputFiles({
    name: "phone-photo.webp",
    mimeType: "image/webp",
    buffer: webp!,
  });
  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toBeVisible();
  await expect(mobile.getByRole("img", { name: "Preview of the file you picked" })).toBeVisible();
  await mobile.getByRole("button", { name: "Print 1 copy" }).click();

  await expect(page.getByRole("heading", { name: "인쇄가 시작됐어요" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("link", { name: "파일 다운로드 (직원용)" })).toHaveAttribute(
    "download",
    "print-cess-document.jpg",
  );
  await expect(mobile.getByRole("heading", { name: "All done" })).toBeVisible({
    timeout: 60_000,
  });
});

test("HWP selection gives a privacy-preserving PDF conversion instruction", async ({
  page,
  context,
}) => {
  const mobile = await openMobileAtFilePicker(page, context);
  await mobile.getByTestId("file-input").setInputFiles({
    name: "residence-form.hwp",
    mimeType: "application/x-hwp",
    buffer: Buffer.from("synthetic HWP placeholder for format routing"),
  });

  const fileError = mobile.locator(".mobile-file-error");
  await expect(fileError).toContainText("This printer cannot open an HWP/HWPX file");
  await expect(fileError).toContainText("Save the document as a PDF");
  await expect(mobile.getByRole("heading", { name: "Is this the right page?" })).toHaveCount(0);
});
