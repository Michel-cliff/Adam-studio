import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { stillCommand } from "../../src/commands/still";
import { makeSynthetic } from "./synthetic";

function pixel(file: string, x: number, y: number): number[] {
  const png = PNG.sync.read(readFileSync(file));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

/** A Lottie file with one square that stays green. */
const LOTTIE = {
  v: "5.7.4", fr: 30, ip: 0, op: 60, w: 200, h: 200, layers: [{
    ty: 4, ip: 0, op: 60, st: 0, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 100, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes: [{ ty: "gr", it: [
      { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [200, 200] }, r: { a: 0, k: 0 } },
      { ty: "fl", c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 } },
      { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ] }],
  }],
};

describe("effects", () => {
  it("renders the flash cut, the HUD panel and stat, a Lottie and a zoom", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam effects-"));
    makeSynthetic(dir);
    writeFileSync(join(dir, "assets-src", "square.json"), JSON.stringify(LOTTIE));
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    project.story[0].transitionOut = { kind: "flash", durationMs: 400 };
    project.assets.push({ id: "sq", kind: "lottie", path: "assets-src/square.json" });
    project.elements = [
      { id: "panel", kind: "hud.panel", anchor: { atMs: 2400 }, durationMs: 800, position: { x: 0.5, y: 0.3 }, props: { title: "SCAN", lines: ["target found"] } },
      { id: "stat", kind: "hud.stat", anchor: { atMs: 2400 }, durationMs: 800, position: { x: 0.5, y: 0.75 }, props: { label: "jobs", value: 42 } },
      { id: "lot", kind: "lottie", anchor: { atMs: 3300 }, durationMs: 500, position: { x: 0.5, y: 0.5 }, props: { asset: "sq", width: 0.4 } },
      { id: "zoom", kind: "camera.zoom", anchor: { atMs: 3300 }, durationMs: 600, props: { scale: 2, x: 0, y: 0, easeMs: 50 } },
    ];
    writeFileSync(join(dir, "project.json"), JSON.stringify(project));
    const cut = project.story[0].outMs - project.story[0].inMs;
    const [flash, hud, lottie] = await stillCommand(dir, { at: [cut, 3000, 3500] });
    const white = pixel(flash!, 540, 960);
    expect(white.every((c) => c > 230), `the cut should flash white, got ${white}`).toBe(true);
    const bar = pixel(hud!, 540, Math.round(1920 * 0.3) - 60);
    expect(bar, "the HUD panel draws over the frame").not.toEqual(pixel(lottie!, 540, Math.round(1920 * 0.3) - 60));
    const green = pixel(lottie!, 540, 960);
    expect(green[1]! > 200 && green[0]! < 60 && green[2]! < 60, `the Lottie square should be green, got ${green}`).toBe(true);
    if (process.env.KEEP_FX) console.log(`stills: ${flash} ${hud} ${lottie}`);
    else rmSync(dir, { recursive: true, force: true });
  });
});
