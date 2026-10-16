import { describe, expect, it } from "vitest";
import { slideOffset, slideWindows, subjectWindows } from "../../src/lib/subject";
import { timelineOf } from "./helpers";

describe("slideWindows", () => {
  it("splits the slide 40/60 between the end of a clip and the start of the next", () => {
    expect(slideWindows(timelineOf())).toEqual([
      { clipId: "c1", kind: "out", fromFrame: 53, toFrame: 60 },
      { clipId: "c2", kind: "in", fromFrame: 60, toFrame: 71 },
    ]);
  });
  it("has no window without a subjectSlide", () => {
    expect(slideWindows(timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 4000 }] }))).toEqual([]);
  });
});

describe("subjectWindows", () => {
  it("covers behind-subject elements and slides, per clip", () => {
    expect(subjectWindows(timelineOf())).toEqual([
      { clipId: "c1", asset: "s", fromFrame: 9, toFrame: 27 },
      { clipId: "c1", asset: "s", fromFrame: 53, toFrame: 60 },
      { clipId: "c2", asset: "s", fromFrame: 60, toFrame: 71 },
    ]);
  });
  it("merges overlapping windows", () => {
    const tl = timelineOf({
      elements: [{ id: "late", kind: "image", layer: "behind-subject", anchor: { atMs: 1700 }, durationMs: 200, props: { asset: "m" } }],
    });
    expect(subjectWindows(tl).filter((w) => w.clipId === "c1")).toEqual([{ clipId: "c1", asset: "s", fromFrame: 51, toFrame: 60 }]);
  });
});

describe("slideOffset", () => {
  const out = { clipId: "c1", kind: "out" as const, fromFrame: 53, toFrame: 60 };
  const into = { clipId: "c2", kind: "in" as const, fromFrame: 60, toFrame: 71 };
  it("leaves the frame completely at the end of the slide-out", () => {
    expect(slideOffset(out, 59, 1080).dx).toBeCloseTo(-1188, 6);
  });
  it("starts the slide-in outside the frame on the right and lands near 0", () => {
    expect(slideOffset(into, 60, 1080).dx).toBeCloseTo(1188, 6);
    expect(slideOffset(into, 70, 1080).dx).toBeCloseTo(1188 / 1331, 6);
  });
  it("blurs in proportion to speed, capped at 90 px", () => {
    expect(slideOffset(out, 59, 1080).blurPx).toBe(90);
    expect(slideOffset(into, 70, 1080).blurPx).toBeCloseTo(0.55 * 1188 * 3 * (1 / 121) / 11, 6);
  });
});
