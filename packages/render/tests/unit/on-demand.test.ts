import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { ensureAnalysis } from "../../src/analysis";
import { missingAnalysis } from "../../src/media";
import { CliError } from "../../src/project-io";
import { projectInput, styleInput } from "./helpers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adam on demand-"));
  mkdirSync(join(dir, "cache", "s"), { recursive: true });
  writeFileSync(join(dir, "cache", "s", "edit.mp4"), "x");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function load() {
  const p = parseProject(projectInput());
  const s = parseStyle(styleInput);
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, timeline: resolve(p.value, s.value) };
}

describe("missingAnalysis", () => {
  it("lists the cut-out and the plate the edit needs and the cache lacks", () => {
    const { project, timeline } = load();
    expect(missingAnalysis(dir, project, timeline)).toEqual([{ asset: "s", step: "subject" }, { asset: "s", step: "plate" }]);
    writeFileSync(join(dir, "cache", "s", "subject.webm"), "x");
    writeFileSync(join(dir, "cache", "s", "plate.png"), "x");
    expect(missingAnalysis(dir, project, timeline)).toEqual([]);
  });
});

describe("ensureAnalysis", () => {
  it("runs exactly the missing steps for the assets that need them", () => {
    const { project, timeline } = load();
    const calls: [Record<string, string>, string[]][] = [];
    ensureAnalysis(dir, project, timeline, { analyze: true, run: (_d, videos, steps) => calls.push([videos, steps]) });
    expect(calls).toEqual([[{ s: "cache/s/edit.mp4" }, ["subject"]], [{ s: "cache/s/edit.mp4" }, ["plate"]]]);
  });
  it("refuses with the command to run when analysis is turned off", () => {
    const { project, timeline } = load();
    expect(() => ensureAnalysis(dir, project, timeline, { analyze: false })).toThrow(CliError);
    expect(() => ensureAnalysis(dir, project, timeline, { analyze: false })).toThrow("npm run adam -- analyze");
  });
});
