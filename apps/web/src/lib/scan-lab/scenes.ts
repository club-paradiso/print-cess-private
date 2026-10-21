import type { DocumentQuad, ScanPoint } from "@/lib/document-scan-engine";

/**
 * Synthetic photographs of a document with a known answer.
 *
 * Each scene places an A4 sheet in 3D in front of a pinhole camera, so the
 * corners the scanner should find, and the page's true proportions, are exact
 * rather than hand-annotated. The sheet carries text-like lines and a table so
 * edge detection has to tell the page outline from its contents, and the scene
 * adds the things that break real scans: busy or low-contrast desks, shadows,
 * glare, low light, motion blur, sensor noise, clutter, a page that is too far
 * away or cut off by the frame, and no page at all.
 *
 * Everything is drawn from a fixed seed, so a run is reproducible in CI. A pass
 * here is evidence about the pipeline on synthetic scenes only; it is not a
 * real-device result (see benchmarks/scanner/README.md).
 */

export const A4_ASPECT = 210 / 297;

/** Source photo size: a 3:4 portrait phone frame. */
export const SCENE_WIDTH = 1512;
export const SCENE_HEIGHT = 2016;

export type SceneBackground = "wood" | "gray-desk" | "beige" | "cloth" | "dark";

export type ScanLabScene = {
  id: string;
  /** What the scene is testing, in a few words. */
  label: string;
  background: SceneBackground;
  /** Camera pose relative to the sheet, in degrees, and distance in sheet heights. */
  pose: {
    pitch: number;
    yaw: number;
    roll: number;
    distance: number;
    offsetX?: number;
    offsetY?: number;
    /** Focal length as a multiple of the frame's long edge; 1.15 when omitted. */
    focal?: number;
  };
  /** Draw no sheet at all (an empty desk). */
  empty?: boolean;
  clutter?: boolean;
  /** Linear shadow across the frame, 0 (none) to 1 (black edge). */
  shadow?: number;
  /** A clipped specular highlight on the sheet, as a fraction of the frame width. */
  glare?: number;
  /** Overall exposure multiplier, 1 = normal. */
  exposure?: number;
  /** Gaussian blur radius in source pixels (motion/focus blur). */
  blur?: number;
  /** Per-pixel sensor noise amplitude, 0–255. */
  noise?: number;
  /** What a correct scanner does with this scene. */
  expect: {
    /** `true`: must find the sheet; `false`: must not claim one; `null`: either is acceptable. */
    detect: boolean | null;
    autoCapture: boolean;
  };
};

export const SCAN_LAB_SCENES: readonly ScanLabScene[] = [
  {
    id: "flat-wood",
    label: "Flat page on a wooden desk",
    background: "wood",
    pose: { pitch: 0, yaw: 0, roll: 0, distance: 1.55 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "tilt-25",
    label: "Phone tilted 25° towards the page",
    background: "gray-desk",
    pose: { pitch: 25, yaw: 0, roll: 0, distance: 1.55 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "yaw-roll",
    label: "Page turned 12° and seen from the side",
    background: "wood",
    pose: { pitch: 8, yaw: 18, roll: 12, distance: 1.6 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "steep-perspective",
    label: "Steep 40° perspective",
    background: "dark",
    pose: { pitch: 40, yaw: 8, roll: -4, distance: 1.75 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "sideways",
    label: "Page lying sideways",
    background: "gray-desk",
    pose: { pitch: 5, yaw: 0, roll: 84, distance: 2.05 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "desk-shadow",
    label: "Hand/phone shadow across the page",
    background: "gray-desk",
    pose: { pitch: 10, yaw: -6, roll: 3, distance: 1.55 },
    shadow: 0.55,
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "cluttered-desk",
    label: "Busy desk with other objects",
    background: "wood",
    pose: { pitch: 6, yaw: 4, roll: -7, distance: 1.75 },
    clutter: true,
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "low-contrast",
    label: "White page on a beige desk",
    background: "beige",
    pose: { pitch: 12, yaw: 0, roll: 5, distance: 1.6 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "patterned-cloth",
    label: "Page on a checked tablecloth",
    background: "cloth",
    pose: { pitch: 15, yaw: -10, roll: -3, distance: 1.6 },
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "noisy-dim",
    label: "Dim room with sensor noise",
    background: "dark",
    pose: { pitch: 8, yaw: 0, roll: 2, distance: 1.6 },
    exposure: 0.72,
    noise: 14,
    expect: { detect: true, autoCapture: true },
  },
  {
    id: "too-far",
    label: "Page too far away",
    background: "wood",
    pose: { pitch: 0, yaw: 0, roll: 6, distance: 3.3 },
    expect: { detect: null, autoCapture: false },
  },
  {
    id: "glare",
    label: "Strong glare on the page",
    background: "gray-desk",
    pose: { pitch: 6, yaw: 0, roll: 0, distance: 1.55 },
    glare: 0.26,
    expect: { detect: null, autoCapture: false },
  },
  {
    id: "too-dark",
    label: "Almost no light",
    background: "wood",
    pose: { pitch: 4, yaw: 0, roll: 0, distance: 1.55 },
    exposure: 0.14,
    expect: { detect: null, autoCapture: false },
  },
  {
    id: "motion-blur",
    label: "Phone moving while shooting",
    background: "gray-desk",
    pose: { pitch: 6, yaw: 0, roll: 2, distance: 1.55 },
    blur: 9,
    expect: { detect: null, autoCapture: false },
  },
  {
    id: "cut-off",
    label: "Page cut off by the frame",
    background: "dark",
    pose: { pitch: 0, yaw: 0, roll: 0, distance: 1.25, offsetX: 0.42, offsetY: 0.18 },
    expect: { detect: null, autoCapture: false },
  },
  {
    id: "empty-desk",
    label: "No page in view",
    background: "wood",
    pose: { pitch: 0, yaw: 0, roll: 0, distance: 1.55 },
    empty: true,
    clutter: true,
    expect: { detect: false, autoCapture: false },
  },
];

export type RenderedScene = {
  canvas: HTMLCanvasElement;
  /** The sheet's true corners, normalized, top-left first; null when no sheet is drawn. */
  quad: DocumentQuad | null;
  /** True when every corner of the sheet is inside the frame. */
  fullyInFrame: boolean;
};

type Homography = [number, number, number, number, number, number, number, number];

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Unit square (u, v) to an image quadrilateral (TL, TR, BR, BL), Heckbert's closed form. */
function squareToQuad(quad: readonly ScanPoint[]): Homography {
  const [p0, p1, p2, p3] = quad as [ScanPoint, ScanPoint, ScanPoint, ScanPoint];
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0];
  }
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / denominator;
  const h = (dx1 * sy - sx * dy1) / denominator;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
  ];
}

function mapPoint([a, b, c, d, e, f, g, h]: Homography, u: number, v: number): ScanPoint {
  const w = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
}

/** The sheet's corners in pixels, projected through a pinhole camera. */
export function projectSheet(scene: ScanLabScene): ScanPoint[] {
  const rad = Math.PI / 180;
  const pitch = scene.pose.pitch * rad;
  const yaw = scene.pose.yaw * rad;
  const roll = scene.pose.roll * rad;
  const sheetHeight = 1;
  const sheetWidth = A4_ASPECT;
  const focal = SCENE_HEIGHT * (scene.pose.focal ?? 1.15);
  const distance = scene.pose.distance;
  const offsetX = (scene.pose.offsetX ?? 0) * sheetHeight;
  const offsetY = (scene.pose.offsetY ?? 0) * sheetHeight;

  const corners = [
    [-sheetWidth / 2, -sheetHeight / 2],
    [sheetWidth / 2, -sheetHeight / 2],
    [sheetWidth / 2, sheetHeight / 2],
    [-sheetWidth / 2, sheetHeight / 2],
  ] as const;

  return corners.map(([x0, y0]) => {
    // Roll the sheet in its own plane, then tilt it away from the camera.
    let x = x0 * Math.cos(roll) - y0 * Math.sin(roll);
    let y = x0 * Math.sin(roll) + y0 * Math.cos(roll);
    let z = 0;
    // Pitch about the x axis.
    const y1 = y * Math.cos(pitch) - z * Math.sin(pitch);
    const z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
    y = y1;
    z = z1;
    // Yaw about the y axis.
    const x2 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z2 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    x = x2 + offsetX;
    z = z2 + distance;
    y += offsetY;
    return { x: SCENE_WIDTH / 2 + (focal * x) / z, y: SCENE_HEIGHT / 2 + (focal * y) / z };
  });
}

function fillQuad(context: CanvasRenderingContext2D, points: readonly ScanPoint[]) {
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fill();
}

function drawBackground(
  context: CanvasRenderingContext2D,
  background: SceneBackground,
  random: () => number,
) {
  const { width, height } = context.canvas;
  if (background === "wood") {
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#7d5434");
    base.addColorStop(1, "#5e3c22");
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 140; index += 1) {
      const x = random() * width;
      context.strokeStyle = `rgba(${random() > 0.5 ? "40,22,10" : "150,105,70"},${0.12 + random() * 0.2})`;
      context.lineWidth = 2 + random() * 7;
      context.beginPath();
      context.moveTo(x, 0);
      context.bezierCurveTo(
        x + (random() - 0.5) * 60,
        height * 0.33,
        x + (random() - 0.5) * 60,
        height * 0.66,
        x + (random() - 0.5) * 40,
        height,
      );
      context.stroke();
    }
    return;
  }
  if (background === "cloth") {
    const cell = 44;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        context.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#3d5a80" : "#98c1d9";
        context.fillRect(x, y, cell, cell);
      }
    }
    return;
  }
  const colors: Record<Exclude<SceneBackground, "wood" | "cloth">, [string, string]> = {
    "gray-desk": ["#8f959c", "#757b82"],
    beige: ["#dccdb4", "#cbbb9f"],
    dark: ["#2a2d33", "#1c1e22"],
  };
  const [start, end] = colors[background];
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, start);
  base.addColorStop(1, end);
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
}

function drawClutter(
  context: CanvasRenderingContext2D,
  random: () => number,
  avoid: ScanPoint[] | null,
) {
  const { width, height } = context.canvas;
  const palette = ["#1f2937", "#b91c1c", "#0f766e", "#e5e7eb", "#facc15", "#111827"];
  const centerX = avoid ? avoid.reduce((sum, point) => sum + point.x, 0) / 4 : width / 2;
  const centerY = avoid ? avoid.reduce((sum, point) => sum + point.y, 0) / 4 : height / 2;
  for (let index = 0; index < 7; index += 1) {
    // Keep objects near the frame edges, as on a real desk, so they sit beside
    // the page rather than on it.
    const side = index % 4;
    const x =
      side === 0
        ? random() * width * 0.16
        : side === 1
          ? width * (0.84 + random() * 0.16)
          : random() * width;
    const y =
      side === 2
        ? random() * height * 0.1
        : side === 3
          ? height * (0.9 + random() * 0.1)
          : random() * height;
    if (avoid && Math.hypot(x - centerX, y - centerY) < Math.min(width, height) * 0.25) continue;
    context.save();
    context.translate(x, y);
    context.rotate(random() * Math.PI);
    context.fillStyle = palette[Math.floor(random() * palette.length)]!;
    const w = 40 + random() * 220;
    const h = 14 + random() * (random() > 0.6 ? 260 : 40);
    context.fillRect(-w / 2, -h / 2, w, h);
    context.restore();
  }
}

function drawSheet(context: CanvasRenderingContext2D, corners: ScanPoint[], random: () => number) {
  const homography = squareToQuad(corners);
  const quadAt = (u0: number, v0: number, u1: number, v1: number) => [
    mapPoint(homography, u0, v0),
    mapPoint(homography, u1, v0),
    mapPoint(homography, u1, v1),
    mapPoint(homography, u0, v1),
  ];

  // A soft contact shadow under the sheet.
  context.save();
  context.filter = "blur(10px)";
  context.fillStyle = "rgba(0,0,0,0.35)";
  fillQuad(
    context,
    corners.map((point) => ({ x: point.x + 6, y: point.y + 10 })),
  );
  context.restore();

  // Paper, very slightly warmer at one end, as under a desk lamp.
  const paper = context.createLinearGradient(
    corners[0]!.x,
    corners[0]!.y,
    corners[2]!.x,
    corners[2]!.y,
  );
  paper.addColorStop(0, "#f7f4ec");
  paper.addColorStop(1, "#ebe7dc");
  context.fillStyle = paper;
  fillQuad(context, corners);

  // Content stays inside an 8% margin, so the page edge itself is clean paper.
  context.fillStyle = "#23262d";
  fillQuad(context, quadAt(0.1, 0.07, 0.52, 0.1));
  context.fillStyle = "#3a3f48";
  for (let v = 0.15; v < 0.5; v += 0.026) {
    fillQuad(context, quadAt(0.1, v, 0.1 + 0.48 + random() * 0.34, v + 0.0085));
  }
  // A small table, whose straight lines compete with the page outline.
  context.fillStyle = "#4b5160";
  const top = 0.55;
  const bottom = 0.74;
  for (let row = 0; row <= 4; row += 1) {
    const v = top + ((bottom - top) * row) / 4;
    fillQuad(context, quadAt(0.1, v, 0.9, v + 0.0025));
  }
  for (const u of [0.1, 0.38, 0.64, 0.9]) {
    fillQuad(context, quadAt(u, top, u + 0.0028, bottom + 0.0025));
  }
  for (let v = 0.79; v < 0.9; v += 0.026) {
    fillQuad(context, quadAt(0.1, v, 0.1 + 0.3 + random() * 0.45, v + 0.0085));
  }
}

function applyLighting(
  context: CanvasRenderingContext2D,
  scene: ScanLabScene,
  corners: ScanPoint[] | null,
) {
  const { width, height } = context.canvas;
  if (scene.shadow) {
    const shadow = context.createLinearGradient(width * 0.15, 0, width * 0.85, height * 0.3);
    shadow.addColorStop(0, `rgba(0,0,0,${scene.shadow})`);
    shadow.addColorStop(0.55, `rgba(0,0,0,${scene.shadow * 0.45})`);
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = shadow;
    context.fillRect(0, 0, width, height);
  }
  if (scene.glare && corners) {
    const cx = corners.reduce((sum, point) => sum + point.x, 0) / 4;
    const cy = corners.reduce((sum, point) => sum + point.y, 0) / 4;
    const radius = width * scene.glare;
    const glare = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glare.addColorStop(0, "rgba(255,255,255,1)");
    glare.addColorStop(0.7, "rgba(255,255,255,1)");
    glare.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glare;
    context.fillRect(0, 0, width, height);
  }
  if (scene.exposure !== undefined && scene.exposure !== 1) {
    const level = Math.round(Math.max(0, Math.min(1, scene.exposure)) * 255);
    context.save();
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgb(${level},${level},${level})`;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
}

function applyNoise(context: CanvasRenderingContext2D, amplitude: number, random: () => number) {
  const { width, height } = context.canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const delta = (random() + random() + random() - 1.5) * amplitude;
    data[index] = data[index]! + delta;
    data[index + 1] = data[index + 1]! + delta;
    data[index + 2] = data[index + 2]! + delta;
  }
  context.putImageData(image, 0, 0);
}

export function renderScanScene(scene: ScanLabScene): RenderedScene {
  const random = mulberry32(seedOf(scene.id));
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("scanLabCanvasUnavailable");

  drawBackground(context, scene.background, random);
  const corners = scene.empty ? null : projectSheet(scene);
  if (scene.clutter) drawClutter(context, random, corners);
  if (corners) drawSheet(context, corners, random);
  applyLighting(context, scene, corners);
  if (scene.noise) applyNoise(context, scene.noise, random);

  let output = canvas;
  if (scene.blur) {
    output = document.createElement("canvas");
    output.width = SCENE_WIDTH;
    output.height = SCENE_HEIGHT;
    const blurred = output.getContext("2d");
    if (!blurred) throw new Error("scanLabCanvasUnavailable");
    blurred.filter = `blur(${scene.blur}px)`;
    blurred.drawImage(canvas, 0, 0);
  }

  const quad = corners
    ? (corners.map((point) => ({
        x: point.x / SCENE_WIDTH,
        y: point.y / SCENE_HEIGHT,
      })) as DocumentQuad)
    : null;
  const fullyInFrame = quad
    ? quad.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
    : false;
  return { canvas: output, quad, fullyInFrame };
}
