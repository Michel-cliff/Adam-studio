import { describe, expect, it } from "vitest";
import { cropBox, cropRectAt, zoomAt } from "../../src/lib/framing";

const crop = (keyframes: { atMs: number; rect: { x: number; y: number; w: number; h: number } }[] = []) => ({
  mode: "crop" as const,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  keyframes,
});

describe("zoomAt", () => {
  it("adds the drift per second to the base zoom", () => {
    expect(zoomAt({ base: 1.08, driftPerSec: 0.004 }, 2500)).toBeCloseTo(1.09, 6);
  });
});

describe("cropRectAt", () => {
  it("returns the base rect without keyframes", () => {
    expect(cropRectAt(crop(), 5000)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it("interpolates linearly in source time and holds after the last keyframe", () => {
    const f = crop([{ atMs: 1000, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }]);
    expect(cropRectAt(f, 500)).toEqual({ x: 0.125, y: 0.125, w: 0.75, h: 0.75 });
    expect(cropRectAt(f, 2000)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });
});

describe("cropBox", () => {
  const portrait = { width: 1080, height: 1920 };
  it("fills the canvas with the full frame of a same-shaped source", () => {
    expect(cropBox({ x: 0, y: 0, w: 1, h: 1 }, portrait, portrait)).toEqual({ left: 0, top: 0, width: 1080, height: 1920 });
  });
  it("scales and centers a rect so it covers the canvas", () => {
    expect(cropBox({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, portrait, portrait)).toEqual({ left: -540, top: -960, width: 2160, height: 3840 });
  });
  it("reads the rect in the source frame when the source is landscape", () => {
    // Right part of a 16:9 screen recording (480x1080 px) shown in a 9:16 canvas: scale 2.25, the rect's center lands mid-canvas.
    expect(cropBox({ x: 0.5, y: 0, w: 0.25, h: 1 }, { width: 1920, height: 1080 }, portrait)).toEqual({ left: -2160, top: -255, width: 4320, height: 2430 });
  });
});
