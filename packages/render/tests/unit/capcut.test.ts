import { describe, expect, it } from "vitest";
import { planCapcut } from "../../src/lib/capcut";
import { timelineOf } from "./helpers";

const title = {
  id: "t", kind: "title", anchor: { atMs: 2500 }, durationMs: 500,
  props: { phases: [{ startMs: 0, endMs: 500, lines: [{ text: "HELLO" }] }] },
};

describe("planCapcut", () => {
  it("bakes subject windows, merging the two halves of a slide, and reports why", () => {
    const plan = planCapcut(timelineOf());
    expect(plan.bakes).toEqual([
      { id: "b01", fromFrame: 9, toFrame: 27 },
      { id: "b02", fromFrame: 53, toFrame: 71 },
    ]);
    expect(plan.overlays).toEqual([]);
    expect(plan.entries.map((e) => [e.id, e.status])).toEqual([
      ["transition:c1", "baked"],
      ["behind", "baked"],
    ]);
  });

  it("keeps titles native (editable text in CapCut)", () => {
    const plan = planCapcut(timelineOf({ elements: [title] }));
    expect(plan.overlays).toEqual([]);
    expect(plan.bakes).toEqual([{ id: "b01", fromFrame: 53, toFrame: 71 }]);
    expect(plan.entries.find((e) => e.id === "t")).toBeUndefined();
  });

  it("turns front elements of kinds without a native mapping into transparent overlays", () => {
    const plan = planCapcut(timelineOf({ elements: [title] }), new Set(["image"]));
    expect(plan.overlays).toEqual([{ elementId: "t", fromFrame: 75, durationFrames: 15 }]);
    expect(plan.entries.find((e) => e.id === "t")).toEqual({
      id: "t", kind: "title", status: "baked", reason: "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)",
    });
  });

  it("bakes split clips and leaves crossfades to the creator", () => {
    const plan = planCapcut(timelineOf({
      story: [
        { id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: { kind: "crossfade", durationMs: 300 } },
        { id: "c2", asset: "s", inMs: 2000, outMs: 4000, framing: { mode: "split", asset: "s" } },
      ],
      elements: [],
    }));
    expect(plan.bakes).toEqual([{ id: "b01", fromFrame: 60, toFrame: 120 }]);
    expect(plan.entries.map((e) => [e.id, e.status])).toEqual([
      ["transition:c1", "skipped"],
      ["clip:c2", "baked"],
    ]);
  });
});
