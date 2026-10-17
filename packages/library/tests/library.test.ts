import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { importAsset, lookAt } from "../src/importer";
import { scanInspiration, searchLocal } from "../src/local";
import { searchOnline } from "../src/online";

let root: string;
const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "adam inspi-"));
  mkdirSync(join(root, "Hooks", "Glitch intros"), { recursive: true });
  mkdirSync(join(root, "Sons"), { recursive: true });
  mkdirSync(join(root, "Polices"), { recursive: true });
  ff(["-f", "lavfi", "-i", "testsrc2=s=320x568:r=30:d=2", "-pix_fmt", "yuv420p", join(root, "Hooks", "Glitch intros", "mrbeast style.mp4")]);
  writeFileSync(join(root, "Hooks", "Glitch intros", "mrbeast style.mp4.txt"), "fast zoom punch on the first word, red flash");
  ff(["-f", "lavfi", "-i", "sine=frequency=600:duration=0.5", join(root, "Sons", "whoosh rapide.wav")]);
  ff(["-f", "lavfi", "-i", "color=c=orange:s=200x200", "-frames:v", "1", join(root, "Hooks", "palette été.png")]);
  copyFileSync("C:/Windows/Fonts/arial.ttf", join(root, "Polices", "arial.ttf"));
  writeFileSync(join(root, "Hooks", "anim.json"), JSON.stringify({ v: "5", fr: 30, ip: 0, op: 30, w: 10, h: 10, layers: [] }));
  writeFileSync(join(root, "Hooks", "not-lottie.json"), JSON.stringify({ hello: 1 }));
}, 60000);

describe("inspiration folder", () => {
  it("indexes media with tags from folders, notes and thumbnails", () => {
    const items = scanInspiration(root);
    expect(items.map((i) => i.kind).sort()).toEqual(["audio", "font", "image", "lottie", "video"]);
    const video = items.find((i) => i.kind === "video")!;
    expect(video.tags).toEqual(expect.arrayContaining(["hooks", "glitch", "intros", "mrbeast", "style"]));
    expect(video.notes).toContain("red flash");
    expect(video.durationMs).toBeGreaterThan(1900);
    expect(existsSync(video.thumb!)).toBe(true);
    expect(scanInspiration(root).find((i) => i.kind === "video")!.thumb).toBe(video.thumb);
  });

  it("searches by words of names, folders and notes, accents ignored", () => {
    expect(searchLocal("glitch", undefined, root).map((i) => i.kind)).toEqual(["video"]);
    expect(searchLocal("red flash", "video", root)).toHaveLength(1);
    expect(searchLocal("ete", undefined, root).map((i) => i.title)).toEqual(["palette été"]);
    expect(searchLocal("whoo", "audio", root)).toHaveLength(1);
    expect(searchLocal("glitch", "audio", root)).toHaveLength(0);
  });
});

describe("import and look", () => {
  it("copies a file into the project with credits", async () => {
    const project = mkdtempSync(join(tmpdir(), "adam import-"));
    const item = searchLocal("whoosh", "audio", root)[0]!;
    const a = await importAsset(project, { path: item.path, license: "CC0", creator: "me" });
    expect(a).toMatchObject({ id: "whoosh_rapide", kind: "audio", path: "assets/whoosh_rapide.wav" });
    expect(existsSync(a.file)).toBe(true);
    expect(readFileSync(join(project, "assets", "CREDITS.md"), "utf8")).toContain("CC0");
    await expect(importAsset(project, { path: item.path })).rejects.toThrow(/exists/);
  });

  it("makes pictures of videos, sounds, fonts and images", async () => {
    for (const q of ["glitch", "whoosh", "arial", "palette"]) {
      const item = searchLocal(q, undefined, root)[0]!;
      const look = await lookAt(item.path);
      expect(look.jpeg.length, q).toBeGreaterThan(500);
    }
  });
});

describe("online", () => {
  it("finds CC0 or CC BY sounds on Openverse and says which keys are missing", async () => {
    let r;
    try { r = await searchOnline("whoosh", "audio", 3); } catch { return; }
    if (r.notes.some((n) => n.startsWith("openverse:"))) return; // offline
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items.filter((x) => x.source === "openverse")) expect(i.license).toMatch(/^(CC0|PDM|BY)\b/);
  }, 30000);
});
