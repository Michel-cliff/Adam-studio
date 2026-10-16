import { describe, expect, it } from "vitest";
import { audioVolume } from "../../src/lib/audio";
import { gradeFilter, vignetteBackground, warmthMatrix } from "../../src/lib/grade";

const neutral = { warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 };

describe("gradeFilter", () => {
  it("is none for a neutral grade", () => {
    expect(gradeFilter(neutral, "g")).toBe("none");
  });
  it("chains warmth, contrast, saturation and brightness", () => {
    expect(gradeFilter({ ...neutral, warmth: 0.35, contrast: 0.1, saturation: 0.12, brightness: -0.02 }, "g"))
      .toBe("url(#g) contrast(1.1) saturate(1.12) brightness(0.98)");
  });
});

describe("warmthMatrix", () => {
  it("is the identity at 0", () => {
    expect(warmthMatrix(0)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  });
  it("boosts red and cuts blue when warm", () => {
    const m = warmthMatrix(1);
    expect(m[0]).toBeCloseTo(1.12, 6);
    expect(m[6]).toBeCloseTo(1.02, 6);
    expect(m[12]).toBeCloseTo(0.86, 6);
  });
});

describe("vignetteBackground", () => {
  it("is none at 0 and a radial gradient otherwise", () => {
    expect(vignetteBackground(0)).toBe("none");
    expect(vignetteBackground(0.5)).toBe("radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.325) 100%)");
  });
});

describe("audioVolume", () => {
  const item = { id: "s", asset: "b", fromFrame: 0, durationFrames: 30, sourceInMs: 0, volume: 0.5, fadeInMs: 200, fadeOutMs: 200 };
  it("ramps in and out", () => {
    expect(audioVolume(item, 0, 30)).toBe(0);
    expect(audioVolume(item, 3, 30)).toBeCloseTo(0.25, 6);
    expect(audioVolume(item, 15, 30)).toBe(0.5);
    expect(audioVolume(item, 27, 30)).toBeCloseTo(0.25, 6);
  });
  it("never exceeds 1", () => {
    expect(audioVolume({ ...item, volume: 3, fadeInMs: 0, fadeOutMs: 0 }, 10, 30)).toBe(1);
  });
});
