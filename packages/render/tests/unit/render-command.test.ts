import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrames } from "../../src/commands/render";
import { CliError, loadProject } from "../../src/project-io";
import { projectInput, styleInput } from "./helpers";

describe("parseFrames", () => {
  it("reads a-b and rejects anything else", () => {
    expect(parseFrames("10-40")).toEqual([10, 40]);
    expect(parseFrames(undefined)).toBeNull();
    expect(() => parseFrames("ten")).toThrow(CliError);
  });
});

describe("loadProject", () => {
  it("loads the project and its style relative to the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam io-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify(projectInput()));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    const { project, style } = loadProject(dir);
    expect(project.name).toBe("synthetic");
    expect(style.name).toBe("Test");
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists every invalid field", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam io-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...projectInput(), story: [{ id: "c1", asset: "s", inMs: 5, outMs: 5 }] }));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    expect(() => loadProject(dir)).toThrow("project.json is invalid:\n- story[0].outMs: outMs must be greater than inMs");
    rmSync(dir, { recursive: true, force: true });
  });
});
