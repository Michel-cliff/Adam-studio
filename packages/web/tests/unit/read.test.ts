import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serveFile } from "../../server/files";
import { listFolder } from "../../server/fsbrowse";
import { listProjects, projectView } from "../../server/projects";
import { projectsRoot, setProjectsRoot } from "../../server/settings";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "adam web-"));
  const dir = join(root, "projet démo");
  mkdirSync(join(dir, "cache", "c01"), { recursive: true });
  mkdirSync(join(dir, "renders", "review", "p1"), { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({
    version: 1, name: "projet démo", canvas: { format: "9:16", fps: 30 }, style: "style.json",
    assets: [{ id: "c01", kind: "video", path: "C:/rushes/take a.mp4", meta: { durationMs: 2000, width: 1080, height: 1920, hasAudio: true } }],
    transcript: { lang: "fr", words: { c01: ["Bonjour", "tout", "le", "monde"].map((text, i) => ({ id: `c01.w${i}`, text, startMs: i * 300, endMs: i * 300 + 250 })) } },
    story: [{ id: "s1", asset: "c01", inMs: 0, outMs: 2000 }],
    proposals: [{ id: "p1", step: "hook", status: "pending", reason: "stronger start", variants: [{ key: "A", label: "zoom", patch: {} }, { key: "B", label: "cut", patch: {} }] }],
  }));
  for (const f of ["edit.mp4", "proxy.mp4", "transcript.json"]) writeFileSync(join(dir, "cache", "c01", f), "x");
  writeFileSync(join(dir, "cache", "c01", "probe.json"), JSON.stringify({ durationMs: 2000 }));
  writeFileSync(join(dir, "renders", "demo.mp4"), "0123456789");
  writeFileSync(join(dir, "renders", "review", "p1", "index.json"), JSON.stringify({ proposal: "p1", variants: [{ key: "A", preview: "A.mp4" }, { key: "B", preview: "B.mp4" }] }));
  writeFileSync(join(dir, "renders", "review", "p1", "sheet.jpg"), "x");
  mkdirSync(join(root, "broken"));
  writeFileSync(join(root, "broken", "project.json"), "{ not json");
  mkdirSync(join(root, "not a project"));
  return root;
}

describe("settings", () => {
  it("saves the projects root and falls back to the default", () => {
    const file = join(mkdtempSync(join(tmpdir(), "adam set-")), "sub", "ui.json");
    expect(projectsRoot(file)).toBeTruthy();
    setProjectsRoot("C:/Videos/Projects", file);
    expect(projectsRoot(file)).toBe("C:/Videos/Projects");
    expect(() => setProjectsRoot("relative/dir", file)).toThrow(/absolute/);
  });
});

describe("projects", () => {
  it("lists project folders, broken ones with their error", () => {
    const list = listProjects(fixture());
    expect(list.map((p) => p.name)).toEqual(["broken", "projet démo"]);
    expect(list[0]!.ok).toBe(false);
    expect(list[0]!.error).toBeTruthy();
    expect(list[1], list[1]!.error).toMatchObject({ ok: true, format: "9:16", takes: 1 });
    expect(list[1]!.lastRender).toBeTypeOf("number");
  });

  it("summarises takes, cache, renders and review", () => {
    const root = fixture();
    const v = projectView(root, "projet démo")!;
    expect(v.takes).toEqual([{ id: "c01", file: "take a.mp4", durationMs: 2000, firstWords: "Bonjour tout le monde",
      cache: { edit: "done", proxy: "done", transcript: "done", silences: "missing", subject: "on demand", plate: "on demand" } }]);
    expect(v.renders.map((r) => r.file)).toEqual(["renders/demo.mp4"]);
    expect(v.proposals[0]).toMatchObject({ id: "p1", status: "pending", variants: [{ key: "A", label: "zoom" }, { key: "B", label: "cut" }],
      review: { sheet: "renders/review/p1/sheet.jpg", clips: { A: "renders/review/p1/A.mp4", B: "renders/review/p1/B.mp4" } } });
    expect(projectView(root, "not a project")).toBeNull();
    expect(projectView(root, "broken")!.ok).toBe(false);
  });
});

describe("listFolder", () => {
  it("lists folders and videos only", () => {
    const root = mkdtempSync(join(tmpdir(), "adam fs-"));
    mkdirSync(join(root, "rushes"));
    mkdirSync(join(root, ".hidden"));
    for (const f of ["take a.mp4", "b.MOV", "notes.txt"]) writeFileSync(join(root, f), "x");
    const v = listFolder(root);
    expect(v.folders).toEqual([join(root, "rushes")]);
    expect(v.videos).toEqual([join(root, "b.MOV"), join(root, "take a.mp4")]);
    expect(v.parent).toBeTruthy();
    expect(listFolder().folders.length).toBeGreaterThan(0);
  });
});

describe("serveFile", () => {
  it("serves byte ranges", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "adam file-")), "v.mp4");
    writeFileSync(file, "0123456789");
    const server = createServer((req, res) => serveFile(req, res, file)).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const get = (range?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((res) => {
      request({ port, host: "127.0.0.1", path: "/", headers: range ? { range } : {} }, (r) => {
        let body = ""; r.on("data", (c) => (body += c)); r.on("end", () => res({ status: r.statusCode!, body, headers: r.headers }));
      }).end();
    });
    expect(await get()).toMatchObject({ status: 200, body: "0123456789" });
    const part = await get("bytes=2-4");
    expect(part).toMatchObject({ status: 206, body: "234" });
    expect(part.headers["content-range"]).toBe("bytes 2-4/10");
    expect((await get("bytes=-3")).body).toBe("789");
    expect((await get("bytes=7-")).body).toBe("789");
    expect((await get("bytes=20-30")).status).toBe(416);
    expect(part.headers["content-type"]).toBe("video/mp4");
    server.close();
  });
});
