import { describe, expect, it } from "vitest";
import type { Timeline } from "@adam-studio/model";
import { cameraAt, cameraWindows } from "../../src/lib/camera";
import { planCapcut } from "../../src/lib/capcut";

const clip = (id: string, fromFrame: number, transitionOut: object) => ({ id, asset: "a", fromFrame, durationFrames: 60, sourceInMs: 0, sourceOutMs: 2000,
  framing: { mode: "cover" }, zoom: { base: 1, driftPerSec: 0 }, transitionOut, volume: 1 });
const timeline = (speed = 1) => ({
  format: "9:16", width: 1080, height: 1920, fps: 30, durationFrames: 180,
  clips: [clip("c1", 0, { kind: "flash", durationMs: 200 }), clip("c2", 60, { kind: "whip", durationMs: 400 }), clip("c3", 120, { kind: "cut" })],
  elements: [{ id: "z", kind: "camera.zoom", layer: "front", fromFrame: 130, durationFrames: 30, trimStartMs: 0, x: 0.5, y: 0.5, props: { scale: 1.5, x: 0.5, y: 0.3, easeMs: 100 } }],
  captions: [], beats: [], audio: [], orphans: [], warnings: [], style: { motion: { speed } },
}) as unknown as Timeline;

describe("camera", () => {
  it("flashes white at a flash cut and nowhere else", () => {
    expect(cameraAt(timeline(), 60).flash).toBe(1);
    expect(cameraAt(timeline(), 40).flash).toBe(0);
  });
  it("whips with blur around a whip cut", () => {
    const c = cameraAt(timeline(), 118);
    expect(c.transform).toMatch(/translateX\(-/);
    expect(c.filter).toMatch(/blur/);
    expect(cameraAt(timeline(), 100).filter).toBeUndefined();
  });
  it("punches in on a zoom element, eased", () => {
    expect(cameraAt(timeline(), 145)).toMatchObject({ transform: "scale(1.5000)", origin: "50% 30%" });
    expect(cameraAt(timeline(), 129).transform).toBeUndefined();
  });
  it("slows effects down when the motion speed is below 1", () => {
    expect(cameraAt(timeline(0.5), 64).flash).toBeGreaterThan(0);
    expect(cameraAt(timeline(1), 64).flash).toBe(0);
  });
  it("bakes camera moves for CapCut and never exports camera.zoom as an overlay", () => {
    expect(cameraWindows(timeline())).toEqual([[130, 160], [57, 63], [114, 126]]);
    const plan = planCapcut(timeline());
    expect(plan.overlays.map((o) => o.elementId)).not.toContain("z");
    expect(plan.bakes.length).toBeGreaterThan(0);
    expect(plan.entries.find((e) => e.id === "z")?.status).toBe("baked");
  });
});
