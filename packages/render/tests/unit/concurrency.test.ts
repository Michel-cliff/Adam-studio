import { describe, expect, it } from "vitest";
import { safeConcurrency } from "../../src/lib/concurrency";

const GB = 2 ** 30;
const base = { width: 1080, height: 1920, fps: 30, videoSources: 2, cores: 12 };

describe("safeConcurrency", () => {
  it("keeps few tabs when free memory is low", () => {
    expect(safeConcurrency({ ...base, freeBytes: 2.5 * GB })).toBe(2);
  });
  it("uses up to half the cores when memory allows", () => {
    expect(safeConcurrency({ ...base, freeBytes: 16 * GB })).toBe(6);
  });
  it("never goes below one tab", () => {
    expect(safeConcurrency({ ...base, freeBytes: 0.2 * GB })).toBe(1);
  });
  it("counts at least one video source", () => {
    expect(safeConcurrency({ ...base, videoSources: 0, freeBytes: 2.5 * GB })).toBe(5);
  });
});
