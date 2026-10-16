import { describe, expect, it } from "vitest";
import { analysisArgs } from "../../src/analysis";

describe("analysisArgs", () => {
  it("passes every video as an argument, never through a shell", () => {
    expect(analysisArgs("C:/My Projects/démo", { c01: "C:/rushes/a é.mp4", c02: "D:/b.mp4" }, ["edit", "proxy"], { fps: 30, lang: "fr" })).toEqual([
      "-m", "adam_analysis", "run", "C:/My Projects/démo", "--video", "c01=C:/rushes/a é.mp4", "--video", "c02=D:/b.mp4",
      "--steps", "edit,proxy", "--fps", "30", "--lang", "fr",
    ]);
  });
  it("adds --force when asked", () => {
    expect(analysisArgs("p", { c01: "a.mp4" }, ["subject"], { fps: 25, force: true }).slice(-2)).toEqual(["25", "--force"]);
  });
});
