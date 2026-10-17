import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSynthetic } from "../../../render/tests/e2e/synthetic";
import { createApp } from "../../server/app";
import { setProjectsRoot } from "../../server/settings";

let server: Server; let base: string; let dir: string;
const P = `/api/projects/${encodeURIComponent("éditeur test")}`;
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "adam editor-"));
  dir = join(root, "éditeur test");
  mkdirSync(dir);
  makeSynthetic(dir, { withProposal: true });
  const settingsFile = join(root, "ui.json");
  setProjectsRoot(root, settingsFile);
  server = createApp({ settingsFile, dist: join(root, "no-dist") }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);
afterAll(() => server.close());

describe("editor routes", () => {
  it("gives the preview with media as panel URLs, and serves them", async () => {
    const p = await (await fetch(`${base}${P}/preview`)).json();
    expect(p.timeline.durationFrames).toBeGreaterThan(0);
    expect(p.media.s.video).toMatch(/^\/api\/projects\/.+\/media\/cache\/s\/(edit|proxy)\.mp4$/);
    expect(p.fonts.caption).toMatch(/\/media\/fonts\//);
    const r = await fetch(`${base}${p.media.s.video}`, { headers: { range: "bytes=0-99" } });
    expect(r.status).toBe(206);
    expect((await fetch(`${base}${P}/media/cache/s/../../project.json`)).status).toBe(404);
  });

  it("cuts words, undoes, and refuses bad edits", async () => {
    const before = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).story;
    const cut = await post(`${P}/edit`, { op: "cut_words", words: ["s.w1"] });
    expect(cut.status).toBe(200);
    expect((await cut.json()).durationMs).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).story).not.toEqual(before);
    expect((await post(`${P}/edit`, { op: "undo" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).story).toEqual(before);
    const bad = await post(`${P}/edit`, { op: "set_value", pointer: "/canvas/fps", value: "x" });
    expect(bad.status).toBe(400);
    expect((await post(`${P}/edit`, { op: "explode" })).status).toBe(400);
    expect((await (await fetch(`${base}${P}/raw`)).json()).transcript.words.s.length).toBe(4);
  });
});
