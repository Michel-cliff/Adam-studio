import { describe, expect, it } from "vitest";
import { CORE_RULES, FRAMEWORKS, getFramework } from "../src/frameworks";

describe("frameworks", () => {
  it("ships the five reels frameworks", () => {
    expect(FRAMEWORKS.map((f) => f.id)).toEqual(["hrst", "bab", "soar", "three-act", "open-loop"]);
  });

  it("orders the beats of each framework", () => {
    expect(getFramework("hrst")!.beats.map((b) => b.role)).toEqual(["hook", "relatable", "show", "takeaway"]);
    expect(getFramework("bab")!.beats.map((b) => b.role)).toEqual(["before", "after", "bridge"]);
    expect(getFramework("soar")!.beats.map((b) => b.role)).toEqual(["situation", "obstacle", "action", "results"]);
    expect(getFramework("three-act")!.beats.map((b) => b.role)).toEqual(["setup", "conflict", "resolution"]);
    expect(getFramework("open-loop")!.beats.map((b) => b.role)).toEqual(["curiosity", "explore", "closure"]);
  });

  it("gives every beat a description for Claude", () => {
    for (const f of FRAMEWORKS) for (const b of f.beats) expect(b.description.length).toBeGreaterThan(10);
  });

  it("limits the hook beat to 3 seconds and ties the open loop back to its hook", () => {
    expect(getFramework("hrst")!.beats[0]!.maxMs).toBe(3000);
    expect(getFramework("open-loop")!.rules).toContain("closure-ties-to-hook");
  });

  it("returns undefined for an unknown framework", () => {
    expect(getFramework("xyz")).toBeUndefined();
  });

  it("keeps the three core reels rules", () => {
    expect(CORE_RULES).toHaveLength(3);
  });
});
