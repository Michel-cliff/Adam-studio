import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPrepFolder } from "../../src/prep-folder";
import { CliError } from "../../src/project-io";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adam prep-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("clearPrepFolder", () => {
  it("refuses a folder holding anything else, and leaves it untouched", () => {
    writeFileSync(join(dir, "keep.txt"), "x");
    mkdirSync(join(dir, "bake"));
    expect(() => clearPrepFolder(dir)).toThrow(CliError);
    expect(() => clearPrepFolder(dir)).toThrow("keep.txt");
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("x");
    expect(existsSync(join(dir, "bake"))).toBe(true);
  });

  it("clears a previous prepare step and recreates its folders", () => {
    mkdirSync(join(dir, "bake"));
    writeFileSync(join(dir, "bake", "b01.mp4"), "old");
    writeFileSync(join(dir, "capcut-plan.json"), "{}");
    clearPrepFolder(dir);
    expect(readdirSync(dir).sort()).toEqual(["bake", "overlay"]);
    expect(readdirSync(join(dir, "bake"))).toEqual([]);
  });

  it("creates a missing folder", () => {
    const out = join(dir, "renders", "capcut");
    clearPrepFolder(out);
    expect(readdirSync(out).sort()).toEqual(["bake", "overlay"]);
  });
});
