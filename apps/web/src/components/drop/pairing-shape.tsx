"use client";

import type { PairingShape } from "@print-cess/protocol";

import type { Text } from "@/lib/use-visitor-locale";

const SHAPE_LABEL_KEYS: Record<PairingShape, string> = {
  circle: "shapeCircle",
  triangle: "shapeTriangle",
  square: "shapeSquare",
  star: "shapeStar",
};

export function shapeLabel(shape: PairingShape, text: Text): string {
  return text(SHAPE_LABEL_KEYS[shape]);
}

export function PairingShapeMark({ shape }: { shape: PairingShape }) {
  return (
    <svg viewBox="0 0 48 48" className="pairing-shape__mark" aria-hidden="true" focusable="false">
      {shape === "circle" ? <circle cx="24" cy="24" r="17" /> : null}
      {shape === "triangle" ? <polygon points="24,6 42,40 6,40" /> : null}
      {shape === "square" ? <rect x="8" y="8" width="32" height="32" rx="3" /> : null}
      {shape === "star" ? (
        <polygon points="24,5 29.6,19.4 45,20.4 33.1,30.2 36.9,45 24,36.8 11.1,45 14.9,30.2 3,20.4 18.4,19.4" />
      ) : null}
    </svg>
  );
}
