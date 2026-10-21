"use client";

import { useRef, useState } from "react";
import { ScanLine, WandSparkles } from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { PrimaryButton, SecondaryButton } from "@print-cess/ui";

import {
  clampQuad,
  detectDocument,
  type DocumentQuad,
  type ScanFilter,
} from "@/lib/document-scan-engine";
import { advancedScanCopy } from "./scan-advanced-copy";

export function DocumentCropEditor({
  locale,
  file,
  previewUrl,
  initialQuad,
  initialFilter,
  onApply,
  onCancel,
}: {
  locale: SupportedLocale;
  file: File;
  previewUrl: string;
  initialQuad: DocumentQuad;
  initialFilter: ScanFilter;
  onApply: (value: { quad: DocumentQuad; filter: ScanFilter }) => void;
  onCancel: () => void;
}) {
  const copy = advancedScanCopy(locale);
  const [quad, setQuad] = useState<DocumentQuad>(initialQuad);
  const [filter, setFilter] = useState<ScanFilter>(initialFilter);
  const [detecting, setDetecting] = useState(false);
  const activeCorner = useRef<number | null>(null);
  const overlay = useRef<SVGSVGElement>(null);

  const moveCorner = (clientX: number, clientY: number) => {
    const index = activeCorner.current;
    const element = overlay.current;
    if (index === null || !element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = Math.min(0.995, Math.max(0.005, (clientX - bounds.left) / bounds.width));
    const y = Math.min(0.995, Math.max(0.005, (clientY - bounds.top) / bounds.height));
    setQuad((current) => {
      const next = current.map((point) => ({ ...point })) as DocumentQuad;
      next[index] = { x, y };
      return clampQuad(next);
    });
  };

  const redetect = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const detection = await detectDocument(file);
      setQuad(detection.quad);
    } finally {
      setDetecting(false);
    }
  };

  const polygon = quad.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");
  const filters: Array<{ value: ScanFilter; label: string }> = [
    { value: "auto", label: copy.auto },
    { value: "color", label: copy.color },
    { value: "grayscale", label: copy.grayscale },
    { value: "bw", label: copy.blackWhite },
  ];

  return (
    <div className="scan-crop-dialog" role="dialog" aria-modal="true" aria-label={copy.adjustCrop}>
      <div className="scan-crop-panel">
        <div className="scan-crop-header">
          <div>
            <strong>{copy.adjustCrop}</strong>
            <p>{copy.cropHelp}</p>
          </div>
          <SecondaryButton onClick={() => void redetect()} disabled={detecting}>
            <WandSparkles aria-hidden="true" /> {detecting ? copy.detecting : copy.autoCrop}
          </SecondaryButton>
        </div>

        <div className="scan-crop-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" />
          <svg
            ref={overlay}
            className="scan-crop-overlay"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            onPointerMove={(event) => moveCorner(event.clientX, event.clientY)}
            onPointerUp={() => {
              activeCorner.current = null;
            }}
            onPointerCancel={() => {
              activeCorner.current = null;
            }}
          >
            <polygon points={polygon} />
            {quad.map((point, index) => (
              <circle
                key={index}
                cx={point.x * 1000}
                cy={point.y * 1000}
                r="34"
                tabIndex={0}
                role="slider"
                aria-label={`${copy.adjustCrop} ${index + 1}`}
                aria-valuemin={0}
                aria-valuemax={1000}
                aria-valuenow={Math.round((point.x + point.y) * 500)}
                onPointerDown={(event) => {
                  activeCorner.current = index;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  moveCorner(event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.02 : 0.006;
                  let deltaX = 0;
                  let deltaY = 0;
                  if (event.key === "ArrowLeft") deltaX = -step;
                  else if (event.key === "ArrowRight") deltaX = step;
                  else if (event.key === "ArrowUp") deltaY = -step;
                  else if (event.key === "ArrowDown") deltaY = step;
                  else return;
                  event.preventDefault();
                  setQuad((current) => {
                    const next = current.map((entry) => ({ ...entry })) as DocumentQuad;
                    const selected = next[index]!;
                    next[index] = { x: selected.x + deltaX, y: selected.y + deltaY };
                    return clampQuad(next);
                  });
                }}
              />
            ))}
          </svg>
        </div>

        <fieldset className="scan-filter-picker">
          <legend>{copy.filter}</legend>
          <div>
            {filters.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={filter === entry.value ? "is-selected" : undefined}
                aria-pressed={filter === entry.value}
                onClick={() => setFilter(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="scan-crop-actions">
          <SecondaryButton onClick={onCancel}>{copy.cancel}</SecondaryButton>
          <PrimaryButton onClick={() => onApply({ quad, filter })}>
            <ScanLine aria-hidden="true" /> {copy.apply}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
