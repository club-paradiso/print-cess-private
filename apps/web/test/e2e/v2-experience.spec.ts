import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The V2 product structure: one home that leads with Print, Share and Scan,
 * one Share capability with two sides, and a scan that can travel on through
 * Share. Every file here is synthetic.
 */

const DOCUMENT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#26343c"/>
  <polygon points="125,95 790,145 755,1100 82,1038" fill="#fffef8" stroke="#d8d6ce" stroke-width="8"/>
  <g fill="#24313a">
    <rect x="210" y="250" width="410" height="30" rx="6"/>
    <rect x="190" y="330" width="500" height="18" rx="5"/>
    <rect x="180" y="385" width="520" height="18" rx="5"/>
    <rect x="165" y="545" width="535" height="18" rx="5"/>
  </g>
</svg>`;

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test("@viewport the home leads with Print and keeps Share, Scan and workplaces below it", async ({
  page,
}) => {
  await page.goto("/start");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Here to print?");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "How printing works",
    "More you can do here",
    "At work or on a public computer",
  ]);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Share", "Scan"]);
  // Printing begins at the Print-cess screen's QR code, so the print section
  // links nowhere. Its two buttons only open sheets on this page.
  const print = page.getByRole("region", { name: "Here to print?" });
  await expect(print.getByRole("link")).toHaveCount(0);
  await expect(print.getByRole("button")).toHaveText(["Scan QR code", "I can't find the screen"]);
  await expect(print.getByRole("list", { name: "How printing works" })).toHaveCount(0);
  await expect(print.locator("[data-beacon]").first()).toBeVisible();

  // Print must visibly outweigh the two tools beneath it.
  const printBox = await print.boundingBox();
  const shareBox = await page.getByRole("region", { name: "Share" }).boundingBox();
  expect(printBox).not.toBeNull();
  expect(shareBox).not.toBeNull();
  expect(printBox!.height).toBeGreaterThan(shareBox!.height);
  expect(printBox!.y).toBeLessThan(shareBox!.y);

  await expect(page.getByRole("link", { name: "Choose files to send" })).toHaveAttribute(
    "href",
    "/send",
  );
  await expect(page.getByRole("link", { name: "Receive files with a code" })).toHaveAttribute(
    "href",
    "/receive",
  );
  await expect(page.getByRole("link", { name: "Scan a document" })).toHaveAttribute(
    "href",
    "/scan",
  );
  const workplace = page.getByRole("navigation", { name: "At work or on a public computer" });
  await expect(workplace.getByRole("link", { name: "Work computer" })).toHaveAttribute(
    "href",
    "#environment",
  );

  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});

test("@viewport the rescue sheet shows the three things to find and keeps the scan button", async ({
  page,
}) => {
  await page.goto("/start");
  await page.getByRole("button", { name: "I can't find the screen" }).click();

  const sheet = page.getByRole("dialog", { name: "Finding the screen" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveText([
    "Find the printer",
    /Find the big screen beside it/u,
    "Scan the QR code on that screen",
  ]);
  await expect(sheet.getByRole("button", { name: "Scan QR code" })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

const SESSION_ID = `${"A".repeat(21)}A`;
const TOKEN = "A".repeat(43);

/**
 * Chromium on Linux has no BarcodeDetector and CI has no camera, so the scanner
 * is exercised with a stand-in detector that reports whatever `window.__qr`
 * holds, over a synthetic video stream. What is under test is the page's
 * handling of what a camera could read, not a camera.
 */
async function installFakeScanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __qr?: string; BarcodeDetector: unknown };
    scope.BarcodeDetector = class {
      async detect() {
        return scope.__qr ? [{ rawValue: scope.__qr }] : [];
      }
    };
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    setInterval(() => {
      if (!context) return;
      context.fillStyle = "#334";
      context.fillRect(0, 0, 320, 240);
    }, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
  });
}

test("scanning from the home page opens a real Print-cess session code", async ({ page }) => {
  await installFakeScanner(page);
  await page.goto("/start");
  await page.getByRole("button", { name: "Scan QR code" }).click();
  await expect(
    page.getByRole("dialog", { name: "Point at the QR code on the screen" }),
  ).toBeVisible();

  await page.evaluate(
    ([id, token]) => {
      (window as unknown as { __qr: string }).__qr =
        `${location.origin}/s/${id}#t=${token}&fp=${token}`;
    },
    [SESSION_ID, TOKEN],
  );
  await expect(page).toHaveURL(new RegExp(`/s/${SESSION_ID}#t=`, "u"));
});

test("scanning a QR code that is not a Print-cess session goes nowhere", async ({ page }) => {
  await installFakeScanner(page);
  await page.goto("/start");
  await page.getByRole("button", { name: "Scan QR code" }).click();

  for (const foreign of [
    `https://evil.example/s/${SESSION_ID}#t=${TOKEN}&fp=${TOKEN}`,
    "https://example.com/menu",
    "WIFI:S:cafe;T:WPA;P:secret;;",
  ]) {
    await page.evaluate((value) => {
      (window as unknown as { __qr: string }).__qr = value;
    }, foreign);
    await expect(page.getByText("That QR code isn't for printing here.")).toBeVisible();
    await expect(page).toHaveURL(/\/start$/u);
  }
});

/**
 * A camera that works, for the paths that differ only in how a frame is
 * decoded. It replaces getUserMedia on MediaDevices.prototype from an init
 * script: Playwright's WebKit keeps the native method when only the instance
 * property is replaced, and an init script also survives the dev server
 * reloading the page after a route compiles.
 */
async function installFakeCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    const scope = window as unknown as { __streams: MediaStream[] };
    scope.__streams = [];
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    setInterval(() => {
      if (!context) return;
      context.fillStyle = "#334";
      context.fillRect(0, 0, 320, 240);
    }, 50);
    MediaDevices.prototype.getUserMedia = async () => {
      const stream = canvas.captureStream(15);
      scope.__streams.push(stream);
      return stream;
    };
  });
}

test("@viewport a browser without BarcodeDetector scans through the jsQR fallback, as Safari does", async ({
  page,
}) => {
  await installFakeCamera(page);
  // Stands in for the pinned CDN decoder, which reports whatever window.__qr
  // holds. The loader itself (URL, integrity, failure) is covered in
  // drop-scanner.test.ts; what is under test here is the page.
  await page.addInitScript(() => {
    const scope = window as unknown as { __qr?: string; jsQR: unknown };
    scope.jsQR = () => (scope.__qr ? { data: scope.__qr } : null);
  });
  await page.goto("/start");
  await page.getByRole("button", { name: "Scan QR code" }).click();
  await expect(
    page.getByRole("dialog", { name: "Point at the QR code on the screen" }),
  ).toBeVisible();
  await expect(page.getByText(/can't scan QR codes here/u)).toHaveCount(0);

  await page.evaluate(
    ([id, token]) => {
      (window as unknown as { __qr: string }).__qr =
        `${location.origin}/s/${id}#t=${token}&fp=${token}`;
    },
    [SESSION_ID, TOKEN],
  );
  await expect(page).toHaveURL(new RegExp(`/s/${SESSION_ID}#t=`, "u"));
});

test("@viewport a browser that cannot scan says so and points to the phone's camera app", async ({
  page,
}) => {
  // No native detector, and the fallback decoder cannot be fetched: the one
  // case left where this page cannot read a QR code.
  await installFakeCamera(page);
  await page.route("**/npm/jsqr@*/**", (route) => route.abort());
  await page.goto("/start");
  await page.getByRole("button", { name: "Scan QR code" }).click();

  await expect(page.getByText(/can't scan QR codes here/u)).toBeVisible();
  await expect(page.getByText(/camera app/u)).toBeVisible();
  // A decoder that failed to load is not a refused camera.
  await expect(page.getByText(/The camera is blocked/u)).toHaveCount(0);
  // The way back to the rescue sheet stays one tap away.
  await expect(page.getByRole("button", { name: "I can't find the screen" }).last()).toBeVisible();
});

test("@viewport the camera stays off while the decoder is still downloading, and stopping leaves it off", async ({
  page,
}) => {
  // Hold the decoder download open, as a slow network would.
  let releaseDecoder: () => void = () => {};
  const decoderHeld = new Promise<void>((resolve) => {
    releaseDecoder = resolve;
  });
  await page.route("**/npm/jsqr@*/**", async (route) => {
    await decoderHeld;
    await route.abort();
  });

  await installFakeCamera(page);
  await page.goto("/receive");
  await page.getByRole("button", { name: "Scan the QR code" }).click();
  await expect(page.getByRole("heading", { name: "Point at the other phone" })).toBeVisible();
  // A stalled download cannot be cancelled, so the camera must not be on yet.
  const openStreams = () =>
    page.evaluate(
      () =>
        (window as unknown as { __streams: MediaStream[] }).__streams.filter((stream) =>
          stream.getTracks().some((track) => track.readyState !== "ended"),
        ).length,
    );
  await page.waitForTimeout(500);
  expect(await openStreams()).toBe(0);

  await page.getByRole("button", { name: "Type the code instead" }).click();
  releaseDecoder();

  await page.waitForTimeout(500);
  expect(await openStreams()).toBe(0);
  // The visitor already chose to type; a late failure must not talk over that.
  await page.waitForTimeout(500);
  await expect(page.getByText("This browser cannot scan.", { exact: false })).toHaveCount(0);
});

test("a refused camera permission is explained instead of left blank", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      async detect() {
        return [];
      }
    };
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/start");
  await page.getByRole("button", { name: "Scan QR code" }).click();

  await expect(page.getByText(/The camera is blocked/u)).toBeVisible();
});

test("@viewport on a small phone in Korean, scanning needs no scrolling", async ({ browser }) => {
  // iPhone SE / mini with Safari's toolbars showing leave about 548 px; 320 px
  // wide is the narrowest phone the layout supports.
  for (const viewport of [
    { width: 375, height: 548 },
    { width: 320, height: 568 },
  ]) {
    const context = await browser.newContext({
      locale: "ko",
      extraHTTPHeaders: { "accept-language": "ko" },
      viewport,
    });
    const page = await context.newPage();
    await page.goto("/start");

    // The kiosk link is for whoever runs a station and lives in the workplace
    // links at the foot of the page (docs/PRINT_FIRST_ENTRY.md); only the
    // visitor's first action has to clear the fold.
    const scan = page.getByRole("button", { name: "QR 코드 찍기" }).first();
    await expect(scan).toBeVisible();
    const box = await scan.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expectNoSidewaysScroll(page);
    await context.close();
  }
});

test("@viewport the home reads right to left in Arabic without overflowing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ar",
    extraHTTPHeaders: { "accept-language": "ar" },
    viewport: { width: 320, height: 720 },
  });
  const page = await context.newPage();
  await page.goto("/start");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("جئت للطباعة؟");
  await expectNoSidewaysScroll(page);
  await context.close();
});

test("@viewport sending and receiving are two sides of one Share capability", async ({ page }) => {
  await page.goto("/send");
  await expect(page.getByText("Share", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick the files to send" })).toBeVisible();
  // The two sources sit at equal weight; neither is the expected answer.
  await expect(page.getByRole("button", { name: /Open my photos/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open my files/u })).toBeVisible();
  await expect(page.locator(".pc-progress")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await page.getByRole("link", { name: "Receive files with a code" }).click();
  await expect(page).toHaveURL(/\/receive$/u);
  await expect(page.getByText("Share", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Type the two numbers" })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  await page.getByRole("link", { name: "Send files" }).click();
  await expect(page).toHaveURL(/\/send$/u);

  // The name in the header always leads to the visitor's guide, never to the
  // shared display at the root.
  await page.getByRole("link", { name: "Print-cess by Club Paradiso" }).click();
  await expect(page).toHaveURL(/\/start$/u);
});

test("a failed code offers to try again rather than an input that no longer exists", async ({
  page,
}) => {
  await page.goto("/receive#c=2345-6789-ABCD");
  await expect(page.getByRole("heading", { name: /No transfer matches that code/u })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("button", { name: "Type the transfer code" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Type the two numbers" })).toBeVisible();
});

test("the sender sees the other side's state above the code, and erasing comes last", async ({
  page,
}) => {
  await page.goto("/send");
  await page.getByTestId("drop-file-input").setInputFiles({
    name: "synthetic-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("SAMPLE — NOT VALID"),
  });
  await page.getByRole("button", { name: "Send these files" }).click();
  await expect(page.getByRole("heading", { name: "Ready to hand over" })).toBeVisible({
    timeout: 60_000,
  });

  const ready = page.locator(".drop-ready");
  const status = ready.getByRole("status").first();
  await expect(status).toContainText("Waiting for the other phone");
  const order = await ready.evaluate((section) =>
    [".drop-status", ".drop-qr", ".drop-link-actions", ".drop-more-ways", ".drop-erase"].map(
      (selector) => {
        const element = section.querySelector(selector);
        return element ? element.getBoundingClientRect().top : Number.NaN;
      },
    ),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every(Number.isFinite)).toBe(true);
  // The number-and-shape hand-off is one tap away, not gone.
  await ready.locator(".drop-more-ways > summary").click();
  await expect(ready.locator(".pairing-pick")).toBeVisible();
  await expectAccessible(page);
});

test("a scanned PDF travels on through Share and arrives on the other phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.goto("/scan");
  await expect(page.getByText("Scan", { exact: true })).toBeVisible();
  await expectAccessible(page);

  await page.getByTestId("scan-gallery-input").setInputFiles({
    name: "synthetic-page.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(DOCUMENT_SVG),
  });
  await expect(page.getByText("Document edges detected")).toBeVisible({ timeout: 60_000 });
  // With a page in hand, making the PDF is the one primary action.
  await expect(page.locator(".scan-composer .pc-button--primary")).toHaveCount(1);
  await expect(page.locator(".scan-composer .pc-button--primary")).toHaveText(/Make PDF/u);
  await page.getByRole("checkbox", { name: /Searchable PDF/u }).uncheck();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.getByRole("heading", { name: "Your scan is ready" })).toBeVisible({
    timeout: 60_000,
  });
  // Printing from here uses this device's own print window, and says so.
  await expect(page.getByRole("button", { name: "Print from this device" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print now" })).toHaveCount(0);

  await page.getByRole("button", { name: "Send to another device" }).click();
  await expect(page.getByRole("heading", { name: "Pick the files to send" })).toBeVisible();
  await expect(page.getByText("Print-cess-scan.pdf")).toBeVisible();

  // The way back keeps the scan.
  await page.getByRole("button", { name: "Back to the scan" }).click();
  await expect(page.getByRole("heading", { name: "Your scan is ready" })).toBeVisible();
  await page.getByRole("button", { name: "Send to another device" }).click();

  await page.getByRole("button", { name: "Send these files" }).click();
  const ready = page.locator(".drop-ready");
  await expect(ready).toHaveAttribute("data-transfer-code", /.+/u, { timeout: 60_000 });
  const code = await ready.getAttribute("data-transfer-code");

  const receiving = await (await browser.newContext()).newPage();
  await receiving.goto(`/receive#c=${code}`);
  await expect(receiving.getByText("Print-cess-scan.pdf")).toBeVisible({ timeout: 60_000 });
  await receiving.context().close();
});
