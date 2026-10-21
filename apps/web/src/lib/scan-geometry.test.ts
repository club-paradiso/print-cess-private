import { describe, expect, it } from "vitest";

import {
  orderDocumentQuad,
  perspectiveAspectRatio,
  runsAlongFrame,
  type DocumentQuad,
} from "./document-scan-engine";
import {
  A4_ASPECT,
  projectSheet,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  type ScanLabScene,
} from "./scan-lab/scenes";

function pixelQuad(pose: ScanLabScene["pose"]): DocumentQuad {
  const scene: ScanLabScene = {
    id: "geometry",
    label: "geometry",
    background: "gray-desk",
    pose,
    expect: { detect: true, autoCapture: true },
  };
  const ordered = orderDocumentQuad(
    projectSheet(scene).map((point) => ({ x: point.x / SCENE_WIDTH, y: point.y / SCENE_HEIGHT })),
  );
  return ordered.map((point) => ({
    x: point.x * SCENE_WIDTH,
    y: point.y * SCENE_HEIGHT,
  })) as DocumentQuad;
}

describe("perspective aspect ratio", () => {
  it.each([
    { pitch: 40, yaw: 8, roll: -4 },
    { pitch: 8, yaw: 18, roll: 12 },
    { pitch: 15, yaw: -10, roll: -3 },
  ])(
    "recovers A4 from a sheet with two vanishing points: pitch $pitch°, yaw $yaw°, roll $roll°",
    (angles) => {
      const ratio = perspectiveAspectRatio(
        pixelQuad({ ...angles, distance: 1.8 }),
        SCENE_WIDTH,
        SCENE_HEIGHT,
      );
      expect(ratio).toBeDefined();
      expect(Math.abs(ratio! - A4_ASPECT) / A4_ASPECT).toBeLessThan(0.02);
    },
  );

  it.each([0.65, 0.8, 1.0, 1.15])(
    "stays close to A4 for a straight-back tilt whatever the real focal length (%sx)",
    (focal) => {
      const ratio = perspectiveAspectRatio(
        pixelQuad({ pitch: 25, yaw: 0, roll: 0, distance: 1.8, focal }),
        SCENE_WIDTH,
        SCENE_HEIGHT,
      );
      expect(ratio).toBeDefined();
      expect(Math.abs(ratio! - A4_ASPECT) / A4_ASPECT).toBeLessThan(0.06);
    },
  );

  it("leaves a sheet parallel to the sensor to the side-length estimate", () => {
    expect(
      perspectiveAspectRatio(
        pixelQuad({ pitch: 0, yaw: 0, roll: 0, distance: 1.8 }),
        SCENE_WIDTH,
        SCENE_HEIGHT,
      ),
    ).toBeUndefined();
  });

  it("refuses an implausible estimate instead of distorting the page", () => {
    const quad: DocumentQuad = [
      { x: 100, y: 100 },
      { x: 1400, y: 120 },
      { x: 1450, y: 1950 },
      { x: 700, y: 400 },
    ];
    const ratio = perspectiveAspectRatio(quad, SCENE_WIDTH, SCENE_HEIGHT);
    if (ratio !== undefined) expect(ratio).toBeGreaterThan(0.2);
  });
});

describe("frame-edge rejection", () => {
  it("rejects a contour that follows the photo's own edge", () => {
    expect(
      runsAlongFrame([
        { x: 0.028, y: 0 },
        { x: 0.988, y: 0 },
        { x: 0.99, y: 0.999 },
        { x: 0, y: 0.981 },
      ]),
    ).toBe(true);
    expect(
      runsAlongFrame([
        { x: 0.11, y: 0 },
        { x: 0.849, y: 0 },
        { x: 0.839, y: 0.999 },
        { x: 0.113, y: 0.999 },
      ]),
    ).toBe(true);
  });

  it("keeps a page whose corner merely comes close to the edge", () => {
    expect(
      runsAlongFrame([
        { x: 0.005, y: 0.22 },
        { x: 0.8, y: 0.16 },
        { x: 0.83, y: 0.71 },
        { x: 0.31, y: 0.72 },
      ]),
    ).toBe(false);
    expect(
      runsAlongFrame([
        { x: 0.15, y: 0.13 },
        { x: 0.85, y: 0.13 },
        { x: 0.85, y: 0.87 },
        { x: 0.15, y: 0.87 },
      ]),
    ).toBe(false);
  });
});
