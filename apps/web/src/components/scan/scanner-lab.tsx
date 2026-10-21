"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentQuad } from "@/lib/document-scan-engine";
import {
  runScanLab,
  runScanLabScene,
  type ScanLabObservation,
  type ScanLabPreview,
} from "@/lib/scan-lab/run";
import { SCAN_LAB_SCENES } from "@/lib/scan-lab/scenes";

declare global {
  interface Window {
    __printCessScanLab?: {
      scenes: string[];
      run: () => Promise<ScanLabObservation[]>;
      runScene: (id: string) => Promise<ScanLabObservation>;
    };
  }
}

type Row = { observation: ScanLabObservation; preview: ScanLabPreview | undefined };

function outline(quad: DocumentQuad | undefined): string | undefined {
  return quad?.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function verdict(observation: ScanLabObservation): { ok: boolean; text: string } {
  const problems: string[] = [];
  if (observation.expectDetect === true && !observation.detected) problems.push("missed page");
  if (observation.expectDetect === false && observation.detected) problems.push("phantom page");
  if (observation.shouldAutoCapture !== observation.didAutoCapture) {
    problems.push(
      observation.didAutoCapture
        ? "fired when it should wait"
        : `held back (${observation.captureIssue})`,
    );
  }
  return problems.length === 0
    ? { ok: true, text: "as expected" }
    : { ok: false, text: problems.join(", ") };
}

export function ScannerLab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const urls = useRef<string[]>([]);

  const run = useCallback(async () => {
    setRunning(true);
    setRows([]);
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    try {
      return await runScanLab({
        previews: true,
        onResult: (observation, preview) => {
          if (preview?.outputUrl) urls.current.push(preview.outputUrl);
          setRows((current) => [...current, { observation, preview }]);
        },
      });
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    window.__printCessScanLab = {
      scenes: SCAN_LAB_SCENES.map((scene) => scene.id),
      run: () => runScanLab(),
      runScene: async (id: string) => {
        const scene = SCAN_LAB_SCENES.find((candidate) => candidate.id === id);
        if (!scene) throw new Error(`unknownScanLabScene:${id}`);
        return (await runScanLabScene(scene)).observation;
      },
    };
    return () => {
      delete window.__printCessScanLab;
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, []);

  return (
    <main className="scan-lab" data-ready="true">
      <header className="scan-lab__header">
        <h1>Scanner lab</h1>
        <p>
          {SCAN_LAB_SCENES.length} synthetic scenes with a known answer, run through the same
          detection, capture check, perspective correction and PDF steps as the scan screen. Green
          is the true page edge, orange is what the scanner found. Synthetic evidence only, not a
          real-device result.
        </p>
        <button
          type="button"
          className="pc-button pc-button--primary"
          onClick={() => void run()}
          disabled={running}
        >
          {running ? `Running… ${rows.length}/${SCAN_LAB_SCENES.length}` : "Run all scenes"}
        </button>
      </header>
      <ol className="scan-lab__grid">
        {rows.map(({ observation, preview }) => {
          const result = verdict(observation);
          return (
            <li key={observation.id} className={result.ok ? "is-ok" : "is-problem"}>
              <figure>
                <div className="scan-lab__scene">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local data URL
                    <img src={preview.sceneUrl} alt="" />
                  ) : null}
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {observation.expectedQuad ? (
                      <polygon points={outline(observation.expectedQuad)} className="is-truth" />
                    ) : null}
                    {observation.detected ? (
                      <polygon points={outline(observation.detectedQuad)} className="is-detected" />
                    ) : null}
                  </svg>
                </div>
                {preview?.outputUrl && observation.detected ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                  <img className="scan-lab__output" src={preview.outputUrl} alt="" />
                ) : null}
                <figcaption>
                  <strong>{observation.label}</strong>
                  <span>{result.text}</span>
                  <small>
                    {observation.detected
                      ? `confidence ${observation.confidence.toFixed(2)}`
                      : "no page"}{" "}
                    · capture {observation.captureIssue}
                    {observation.aspectErrorPercent !== undefined
                      ? ` · aspect error ${observation.aspectErrorPercent.toFixed(1)}%`
                      : ""}
                    {` · ${observation.processingMs} ms`}
                  </small>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
