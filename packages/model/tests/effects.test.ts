import { describe, expect, it } from "vitest";
import { parseProject, parseStyle } from "../src/parse";
import { resolve } from "../src/resolve";
import { makeStyle, projectInput, styleInput } from "./helpers";

describe("effects in the model", () => {
  it("accepts the new transitions and keeps their timing like a cut", () => {
    for (const kind of ["flash", "whip", "zoom"]) {
      const p = parseProject(projectInput({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 4000, transitionOut: { kind, durationMs: 300 } as never }, { id: "c2", asset: "a", inMs: 5000, outMs: 9000 }] }));
      expect(p.ok, kind).toBe(true);
      if (p.ok) expect(resolve(p.value, makeStyle()).durationFrames).toBe(240);
    }
  });

  it("validates the new kinds", () => {
    const el = (kind: string, props: object) => ({ id: "e", kind, anchor: { atMs: 0 }, durationMs: 1000, props });
    const ok = (kind: string, props: object) => parseProject(projectInput({ elements: [el(kind, props)] as never })).ok;
    expect(ok("hud.panel", { title: "SCAN", lines: ["target: found"] })).toBe(true);
    expect(ok("hud.panel", { lines: "nope" })).toBe(false);
    expect(ok("hud.stat", { label: "jobs refused", value: 42 })).toBe(true);
    expect(ok("hud.stat", { label: "x" })).toBe(false);
    expect(ok("camera.zoom", { scale: 1.4, x: 0.5, y: 0.35 })).toBe(true);
    expect(ok("camera.zoom", { scale: 0.5 })).toBe(false);
    expect(ok("lottie", { asset: "nope" })).toBe(false);
  });

  it("has a motion speed in the style, 1 by default", () => {
    expect(makeStyle().motion.speed).toBe(1);
    expect(parseStyle({ ...styleInput, motion: { speed: 0.7 } }).ok).toBe(true);
    expect(parseStyle({ ...styleInput, motion: { speed: 0 } }).ok).toBe(false);
  });
});
