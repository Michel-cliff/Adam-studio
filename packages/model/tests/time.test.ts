import { describe, expect, it } from "vitest";
import { canvasSize, msToFrame } from "../src/time";

describe("canvasSize", () => {
  it("maps 9:16 to a vertical 1080x1920 canvas", () => {
    expect(canvasSize("9:16")).toEqual({ width: 1080, height: 1920 });
  });
  it("maps 16:9 to a landscape 1920x1080 canvas", () => {
    expect(canvasSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("msToFrame", () => {
  it("rounds to the nearest frame", () => {
    expect(msToFrame(0, 30)).toBe(0);
    expect(msToFrame(1010, 30)).toBe(30);
    expect(msToFrame(2020, 30)).toBe(61);
  });
});
