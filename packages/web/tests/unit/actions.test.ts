import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionError, addCommand, buildCommand, checkVideos, newProjectCommand } from "../../server/actions";
import { CLI, TSX } from "../../server/paths";

const dir = join(tmpdir(), "projet démo");
const cli = (c: { cmd: string; args: string[] }) => { expect(c.cmd).toBe(process.execPath); expect(c.args.slice(0, 2)).toEqual([TSX, CLI]); return c.args.slice(2); };

describe("buildCommand", () => {
  it("maps each action to the CLI", () => {
    expect(cli(buildCommand("analyze", dir, {}, null))).toEqual(["analyze", dir]);
    expect(cli(buildCommand("analyze", dir, { assets: "c01,c02", steps: "subject,plate", force: true }, null)))
      .toEqual(["analyze", dir, "--assets", "c01,c02", "--steps", "subject,plate", "--force"]);
    expect(cli(buildCommand("render", dir, { force: true }, null))).toEqual(["render", dir, "--force"]);
    expect(cli(buildCommand("review", dir, {}, null))).toEqual(["review", dir]);
    expect(cli(buildCommand("decide", dir, { proposal: "p1", decision: "B", note: "--warmer" }, null))).toEqual(["decide", dir, "p1", "B", "--note=--warmer"]);
    expect(cli(buildCommand("studio", dir, {}, null))).toEqual(["studio", dir]);
  });

  it("runs the CapCut exporter with its python", () => {
    const c = buildCommand("capcut", dir, { name: "1015 adam", force: true, replace: true }, "py.exe");
    expect(c).toEqual({ cmd: "py.exe", args: ["-m", "adam_capcut", "export", dir, "--name=1015 adam", "--force", "--replace"], label: "Export to CapCut" });
  });

  it("refuses bad options before anything runs", () => {
    expect(() => buildCommand("capcut", dir, {}, null)).toThrow(/CapCut environment is missing/);
    expect(() => buildCommand("decide", dir, { proposal: "p1", decision: "D" }, null)).toThrow(ActionError);
    expect(() => buildCommand("decide", dir, { decision: "A" }, null)).toThrow(ActionError);
    expect(() => buildCommand("analyze", dir, { steps: "subject;rm" }, null)).toThrow(ActionError);
    expect(() => buildCommand("analyze", dir, { assets: "--force" }, null)).toThrow(ActionError);
    expect(() => buildCommand("render", dir, { force: "yes" }, null)).toThrow(ActionError);
    expect(() => buildCommand("delete", dir, {}, null)).toThrow(/unknown action/);
  });
});

describe("new and add", () => {
  it("passes the videos and options", () => {
    expect(cli(newProjectCommand(dir, ["C:/a.mp4"], "9:16", "fr"))).toEqual(["new", dir, "C:/a.mp4", "--format", "9:16", "--lang", "fr"]);
    expect(cli(addCommand(dir, ["C:/b.mov"]))).toEqual(["add", dir, "C:/b.mov"]);
    expect(() => newProjectCommand(dir, ["C:/a.mp4"], "4:3")).toThrow(ActionError);
    expect(() => newProjectCommand(dir, ["C:/a.mp4"], "9:16", "french")).toThrow(ActionError);
  });

  it("accepts only existing absolute video files", () => {
    const root = mkdtempSync(join(tmpdir(), "adam actions-"));
    const v = join(root, "take a.mp4");
    writeFileSync(v, "x");
    writeFileSync(join(root, "notes.txt"), "x");
    expect(checkVideos([v])).toEqual([v]);
    expect(() => checkVideos([])).toThrow(/at least one video/);
    expect(() => checkVideos(["take a.mp4"])).toThrow(ActionError);
    expect(() => checkVideos([join(root, "missing.mp4")])).toThrow(/not found/);
    expect(() => checkVideos([join(root, "notes.txt")])).toThrow(/not a video/);
    expect(() => checkVideos("x")).toThrow(ActionError);
  });
});
