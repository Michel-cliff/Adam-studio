import { describe, expect, it } from "vitest";
import { parseProject, parseStyle } from "../src/parse";
import { projectInput, styleInput } from "./helpers";

describe("parseProject (schema level)", () => {
  it("accepts a minimal project and applies defaults", () => {
    const r = parseProject(projectInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const clip = r.value.story[0]!;
    expect(clip.framing).toEqual({ mode: "cover" });
    expect(clip.zoom).toEqual({ base: 1, driftPerSec: 0 });
    expect(clip.transitionOut).toEqual({ kind: "cut" });
    expect(clip.volume).toBe(1);
    expect(r.value.elements).toEqual([]);
    expect(r.value.proposals).toEqual([]);
    expect(r.value.styleOverrides).toEqual({});
  });

  it("names the exact field when a clip ends before it starts", () => {
    const r = parseProject(projectInput({ story: [{ id: "c1", asset: "a", inMs: 500, outMs: 500 }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "story[0].outMs", message: "outMs must be greater than inMs" });
  });

  it("rejects an unknown element kind", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "laser", anchor: { atMs: 0 }, durationMs: 1000 }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "elements[0].kind", message: 'unknown kind "laser"' });
  });

  it("validates element props per kind with a precise path", () => {
    const r = parseProject(projectInput({
      elements: [{
        id: "e1", kind: "title", anchor: { atMs: 0 }, durationMs: 3000,
        props: { phases: [{ startMs: 0, endMs: 1500, lines: [{ text: "" }] }] },
      }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path)).toContain("elements[0].props.phases[0].lines[0].text");
  });

  it("applies kind defaults to props", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 1000, props: { text: "CONTEXTE" } }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.elements[0]!.props).toEqual({ text: "CONTEXTE", color: "accent", sizeScale: 1 });
  });

  it("requires exactly one way to end an element", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "image", anchor: { atMs: 0 }, durationMs: 1000, untilEnd: true, props: { asset: "a" } }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "elements[0].durationMs", message: "set exactly one of durationMs, untilWord, untilEnd" });
  });
});

describe("parseStyle", () => {
  it("accepts the test style and fills defaults", () => {
    const r = parseStyle(styleInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.grade).toEqual({ warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 });
    expect(r.value.caption.maxCharsPerLine).toBe(22);
    expect(r.value.lint["9:16"].maxPauseMs).toBe(350);
    expect(r.value.fillers.fr).toContain("du coup");
  });

  it("names a bad color", () => {
    const r = parseStyle({ ...styleInput, colors: { ...styleInput.colors, accent: "orange" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "colors.accent", message: "expected a #RRGGBB color" });
  });
});
