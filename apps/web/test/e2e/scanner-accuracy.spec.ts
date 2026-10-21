import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

// @ts-expect-error -- plain ESM module shared with the benchmark CLI
import { polygonIou, scoreBenchmark } from "../../../../scripts/scanner-benchmark/metrics.mjs";


type Observation = {
  id: string;
  label: string;
  image: { width: number; height: number };
  expectedQuad?: { x: number; y: number }[];
  detectedQuad?: { x: number; y: number }[];
  expectDetect: boolean | null;
  detected: boolean;
  confidence: number;
  shouldAutoCapture: boolean;
  didAutoCapture: boolean;
  captureIssue: string;
  processingMs: number;
  aspectErrorPercent?: number;
  borderBleed?: number;
};

const ARTIFACT_DIR = resolve(process.cwd(), "../../artifacts/scanner-benchmark");

const SCENE_MIN_IOU = 0.95;
const SCENE_MAX_ASPECT_ERROR_PERCENT = 10;
const SCENE_MAX_BORDER_BLEED = 0.05;

test("the scanner finds, crops and gates synthetic documents within the quality gates", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/demo/scanner-lab");
  await page.waitForFunction(() => Boolean(window.__printCessScanLab), null, { timeout: 60_000 });
  const observations = (await page.evaluate(() =>
    window.__printCessScanLab!.run(),
  )) as Observation[];

  const input = {
    version: 1,
    suite: "scanner-synthetic-render",
    source: "synthetic-render",
    device: "Chromium (Playwright), development build; synthetic scenes, not a real-device claim",
    gates: {
      minOcrCases: 0,
      p95ProcessingMs: 8000,
    },
    cases: observations.map((observation) => ({ ...observation, pages: 1 })),
  };
  const report = scoreBenchmark(input);

  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(
    resolve(ARTIFACT_DIR, "synthetic-render-observations.json"),
    `${JSON.stringify(input, null, 2)}\n`,
  );
  await writeFile(
    resolve(ARTIFACT_DIR, "synthetic-render-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const failedChecks = report.checks.filter((check: { passed: boolean }) => !check.passed);
  expect(failedChecks, "suite-level scanner gates").toEqual([]);

  for (const observation of observations) {
    const name = `${observation.id} (${observation.label})`;
    if (observation.expectDetect === true) {
      expect(observation.detected, `${name}: finds the page`).toBe(true);
    }
    if (observation.expectDetect === false) {
      expect(observation.detected, `${name}: does not invent a page`).toBe(false);
    }
    expect(
      observation.didAutoCapture,
      `${name}: auto-capture decision (${observation.captureIssue})`,
    ).toBe(observation.shouldAutoCapture);
    if (observation.expectedQuad && observation.detectedQuad) {
      const iou = polygonIou(observation.expectedQuad, observation.detectedQuad) as number;
      expect(iou, `${name}: edge IoU`).toBeGreaterThanOrEqual(SCENE_MIN_IOU);
      expect(
        observation.aspectErrorPercent ?? Infinity,
        `${name}: page proportions`,
      ).toBeLessThanOrEqual(SCENE_MAX_ASPECT_ERROR_PERCENT);
      expect(
        observation.borderBleed ?? Infinity,
        `${name}: desk left in the crop`,
      ).toBeLessThanOrEqual(SCENE_MAX_BORDER_BLEED);
    }
  }

  expect(errors).toEqual([]);
});
