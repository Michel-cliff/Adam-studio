import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { venvPython } from "../../server/paths";
import { setProjectsRoot } from "../../server/settings";

const hasAnalysis = venvPython("analysis", "ADAM_ANALYSIS_PYTHON") !== null;

async function untilEnd(base: string, id: string): Promise<any> {
  const res = await fetch(`${base}/api/jobs/${id}/events`);
  const reader = res.body!.getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const end = text.split("\n\n").map((b) => b.replace(/^data: /, "")).find((b) => b.includes('"type":"end"'));
    if (end) { reader.cancel(); return JSON.parse(end).job; }
  }
  throw new Error(`stream closed without end:\n${text}`);
}

describe.skipIf(!hasAnalysis)("control panel", () => {
  it("creates a project from rushes through the API", async () => {
    const root = mkdtempSync(join(tmpdir(), "adam panel-"));
    const rush = join(root, "take a.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=540x960:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", rush]);
    const settingsFile = join(root, "ui.json");
    setProjectsRoot(join(root, "projects"), settingsFile);
    const server = createApp({ settingsFile, dist: join(root, "no-dist") }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const r = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "projet démo", videos: [rush], format: "9:16", lang: "fr" }) });
      expect(r.status).toBe(202);
      const job = await untilEnd(base, (await r.json()).job.id);
      expect(job.state, job.output).toBe("done");
      const view = await (await fetch(`${base}/api/projects/${encodeURIComponent("projet démo")}`)).json();
      expect(view.ok).toBe(true);
      expect(view.takes).toHaveLength(1);
      expect(view.takes[0].cache.edit).toBe("done");
      expect(view.jobs[0].label).toBe("New project");
      expect(JSON.parse(readFileSync(join(root, "projects", "projet démo", "project.json"), "utf8")).assets[0].path).toBe(rush);
      expect(existsSync(join(root, "projects", "projet démo", "cache", "c01", "proxy.mp4"))).toBe(true);
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
