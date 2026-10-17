import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSynthetic } from "../../../render/tests/e2e/synthetic";
import { createApp } from "../../server/app";
import { askCommand } from "../../server/claude";
import { setProjectsRoot } from "../../server/settings";

let server: Server; let base: string; let dir: string;
const P = `/api/projects/${encodeURIComponent("studio test")}`;
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "adam studio-"));
  dir = join(root, "studio test");
  mkdirSync(dir);
  makeSynthetic(dir, { withProposal: true });
  const settingsFile = join(root, "ui.json");
  setProjectsRoot(root, settingsFile);
  server = createApp({ settingsFile, dist: join(root, "no-dist") }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);
afterAll(() => server.close());

describe("asking Claude", () => {
  it("runs Claude Code headless with the adam-studio tools only, for one proposal of the step", () => {
    const c = askCommand("ep 1", "hook", "A bold question");
    expect(c.label).toBe("Claude: hook");
    expect(c.args.slice(0, 2)).toEqual(["-p", "A bold question"]);
    expect(c.args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--allowedTools", "mcp__adam-studio", "--output-format", "stream-json"]));
    const system = c.args[c.args.indexOf("--append-system-prompt") + 1]!;
    expect(system).toMatch(/Project: "ep 1"/);
    expect(system).toMatch(/id "ask\.hook\./);
    expect(() => askCommand("ep 1", "wrap", "x")).toThrow(/unknown step/);
    expect(() => askCommand("ep 1", "hook", "  ")).toThrow(/write what you want/);
  });
});

describe("studio routes", () => {
  it("previews a variant and tells the project's workflow and variant summaries", async () => {
    const v = await (await fetch(`${base}${P}`)).json();
    expect(v.proposals[0].variants[0].summary).toMatch(/1 image/);
    const a = await (await fetch(`${base}${P}/preview?proposal=p1&variant=A`)).json();
    const now = await (await fetch(`${base}${P}/preview`)).json();
    expect(a.timeline.elements.length).toBe(now.timeline.elements.length + 1);
    expect((await fetch(`${base}${P}/preview?proposal=p1&variant=Z`)).status).toBe(400);
  });

  it("decides and skips steps through the edit route", async () => {
    expect((await post(`${P}/edit`, { op: "decide", proposal: "p1", decision: "A" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).proposals[0].status).toEqual({ accepted: "A" });
    expect((await post(`${P}/edit`, { op: "decide", proposal: "p1", decision: "maybe" })).status).toBe(400);
  });
});
