import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCommand, newCommand } from "../../src/commands/new";
import { renderCommand } from "../../src/commands/render";
import { analysisPython } from "../../src/analysis";

const hasAnalysis = (() => { try { analysisPython(); return true; } catch { return false; } })();

function rush(path: string, color: string) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=540x960:r=30:d=2`, "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", path]);
}

describe.skipIf(!hasAnalysis)("adam new and add", () => {
  it("turns rushes into a project the renderer accepts", async () => {
    const root = mkdtempSync(join(tmpdir(), "adam new-"));
    const dir = join(root, "projet démo");
    rush(join(root, "take a.mp4"), "red");
    rush(join(root, "take b.mp4"), "blue");
    newCommand(dir, [join(root, "take a.mp4")], { lang: "fr" });
    addCommand(dir, [join(root, "take b.mp4"), join(root, "take a.mp4")], { lang: "fr" });
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    expect(project.assets.map((a: { id: string }) => a.id)).toEqual(["c01", "c02"]);
    expect(project.story).toHaveLength(2);
    for (const f of ["edit.mp4", "proxy.mp4", "probe.json", "transcript.json", "silences.json", "manifest.json"]) {
      expect(existsSync(join(dir, "cache", "c02", f)), f).toBe(true);
    }
    const out = await renderCommand(dir, { force: false });
    expect(existsSync(out)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
