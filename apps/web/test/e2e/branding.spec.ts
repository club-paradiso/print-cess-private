import { expect, test } from "@playwright/test";

test("uses the Club Paradiso service name", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(page).toHaveTitle("Print-cess by Club Paradiso");
  await expect(page.getByLabel("Print-cess by Club Paradiso")).toBeVisible();
});

test("the root URL opens the shared display", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /휴대전화 카메라로\s*QR코드를 비추세요/u }),
  ).toBeVisible();
  await expect(page.locator(".kiosk-qr")).toBeVisible();

  const more = page.getByRole("navigation", { name: /다른 기능/u });
  for (const [name, href] of [
    [/파일 보내기/u, "/send"],
    [/파일 받기/u, "/receive"],
    [/문서 스캔/u, "/scan"],
    [/이용 안내/u, "/start"],
  ] as const) {
    await expect(more.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  await more.getByRole("link", { name: /파일 보내기/u }).click();
  await expect(page).toHaveURL(/\/send$/u);
});

test("the legacy workstation URL lands on the real home without looping", async ({ page }) => {
  await page.goto("/workstation");
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator(".kiosk-qr")).toBeVisible();
  await expect(page.getByRole("navigation", { name: /다른 기능/u })).toBeVisible();
});

test("the station URL keeps the screen to the QR code alone", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(page.locator(".kiosk-qr")).toBeVisible();
  await expect(page.getByRole("navigation", { name: /다른 기능/u })).toHaveCount(0);
});

test("shows three simple QR steps without network jargon", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(
    page.getByRole("heading", { name: /휴대전화 카메라로\s*QR코드를 비추세요/u }),
  ).toBeVisible();
  await expect(page.getByText("QR코드를 카메라로 비추세요")).toBeVisible();
  const steps = page.getByRole("list", { name: "인쇄하는 방법" }).getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("QR코드 비추기");
  await expect(steps.nth(0)).toContainText("휴대전화에 뜨는 링크를 누르세요");
  await expect(steps.nth(1)).toContainText("휴대전화에서 파일 고르기");
  await expect(steps.nth(2)).toContainText("프린터에서 종이 받기");
  await expect(page.getByText("사진을 찍을 필요는 없습니다", { exact: false })).toBeVisible();
  await expect(page.getByText("Wi-Fi는 필요하지 않습니다.")).toHaveCount(0);
  await expect(page.getByText("휴대전화 모바일 데이터를 사용하세요")).toHaveCount(0);
});

test("repeats the scan instruction in the other visitor languages", async ({ page }) => {
  const rotating = ["ar", "fil", "id", "km", "mn", "ne", "ru", "th", "uk", "vi", "zh-CN"];
  await page.goto("/kiosk");
  await page.bringToFront();
  const spotlight = page.locator(".kiosk-spotlight");

  const first = await spotlight.getAttribute("lang");
  expect(rotating).toContain(first);
  expect((await spotlight.textContent())?.trim()).not.toBe("");

  await expect.poll(() => spotlight.getAttribute("lang"), { timeout: 30_000 }).not.toBe(first);
  expect(rotating).toContain(await spotlight.getAttribute("lang"));
});

test("keeps the primary camera instruction balanced and aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/kiosk");

  const firstLine = page.getByText("휴대전화 카메라로", { exact: true });
  const secondLine = page.locator(".kiosk-title > span").nth(1);
  const englishLine = page.getByText("Point your phone camera at the QR code", { exact: true });

  await expect(firstLine).toBeVisible();
  await expect(secondLine).toBeVisible();

  const [firstBox, secondBox, englishBox] = await Promise.all([
    firstLine.boundingBox(),
    secondLine.boundingBox(),
    englishLine.boundingBox(),
  ]);

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(englishBox).not.toBeNull();
  expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstBox!.x - englishBox!.x)).toBeLessThanOrEqual(1);
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y);
  expect(secondBox!.width).toBeGreaterThan(200);
});

test("fits the whole waiting screen, QR code included, on one landscape screen", async ({
  page,
}) => {
  await page.goto("/kiosk");
  const frame = page.locator(".kiosk-qr__frame");
  await expect(frame).toBeVisible();
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1280, 720],
    [1280, 1024],
  ] as const) {
    await page.setViewportSize({ width, height });
    const box = (await frame.boundingBox())!;
    const panel = (await page.locator(".kiosk-qr").boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    expect(box.width).toBeGreaterThan(320);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      height,
    );
  }
});

test("shows the two-minute QR renewal window", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(page.locator(".kiosk-countdown")).toHaveText(
    /새 QR코드로 바뀌기까지 (?:02:00|01:5\d)/u,
  );
});
