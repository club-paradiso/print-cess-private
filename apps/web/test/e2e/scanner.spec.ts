import { expect, test } from "@playwright/test";

const DOCUMENT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#26343c"/>
  <polygon points="125,95 790,145 755,1100 82,1038" fill="#fffef8" stroke="#d8d6ce" stroke-width="8"/>
  <g fill="#24313a">
    <rect x="210" y="250" width="410" height="30" rx="6"/>
    <rect x="190" y="330" width="500" height="18" rx="5"/>
    <rect x="180" y="385" width="520" height="18" rx="5"/>
    <rect x="170" y="440" width="490" height="18" rx="5"/>
    <rect x="165" y="545" width="535" height="18" rx="5"/>
    <rect x="160" y="600" width="500" height="18" rx="5"/>
    <rect x="155" y="655" width="525" height="18" rx="5"/>
    <rect x="150" y="760" width="510" height="18" rx="5"/>
    <rect x="145" y="815" width="480" height="18" rx="5"/>
  </g>
</svg>`;

async function uploadSyntheticDocument(page: import("@playwright/test").Page) {
  await page.getByTestId("scan-gallery-input").setInputFiles({
    name: "skewed-document.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(DOCUMENT_SVG),
  });
  await expect(page.getByText("Document edges detected")).toBeVisible({ timeout: 60_000 });
}

test("document scanner detects edges, lets the user refine them, and produces an image PDF", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/scan");
  await uploadSyntheticDocument(page);
  await page.getByRole("button", { name: "Adjust edges" }).click();

  const dialog = page.getByRole("dialog", { name: "Adjust edges" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("circle")).toHaveCount(4);
  await page.getByRole("button", { name: "Black & white" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  await expect(page.getByRole("checkbox", { name: /Searchable PDF/u })).not.toBeChecked();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.getByRole("heading", { name: "Your scan is ready" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Print-cess-scan.pdf")).toBeVisible();
  expect(errors).toEqual([]);
});

test("searchable PDF runs local OCR and completes without sending the page to an OCR API", async ({
  page,
}) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.addInitScript(() => {
    const worker = {
      recognize: async () => ({
        data: {
          text: "HELLO IMMIGRATION 한국어",
          confidence: 96,
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        {
                          text: "HELLO",
                          confidence: 97,
                          bbox: { x0: 180, y0: 245, x1: 330, y1: 285 },
                        },
                        {
                          text: "IMMIGRATION",
                          confidence: 95,
                          bbox: { x0: 345, y0: 245, x1: 610, y1: 285 },
                        },
                        {
                          text: "한국어",
                          confidence: 94,
                          bbox: { x0: 180, y0: 330, x1: 340, y1: 375 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
      terminate: async () => undefined,
    };
    Object.defineProperty(window, "Tesseract", {
      configurable: true,
      value: {
        createWorker: async () => worker,
      },
    });
  });

  await page.goto("/scan");
  await uploadSyntheticDocument(page);
  await expect(page.getByRole("checkbox", { name: /Searchable PDF/u })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Searchable PDF/u }).check();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.getByRole("heading", { name: "Your scan is ready" })).toBeVisible({
    timeout: 60_000,
  });
  expect(
    requestedUrls.some((url) => /(?:ocr|recognize|vision|document-ai|textract)/iu.test(url)),
  ).toBe(false);
});

test("smart camera falls back cleanly when browser camera permission is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
  });

  await page.goto("/scan");
  await page.getByTestId("scan-smart-camera").click();
  const dialog = page.getByRole("dialog", { name: "Smart camera" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("paragraph")).toHaveText("Camera access is unavailable.");
  await expect(dialog.getByRole("button", { name: "Use the device camera instead" })).toBeVisible();
});
