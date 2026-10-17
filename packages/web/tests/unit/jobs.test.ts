import { describe, expect, it } from "vitest";
import { BusyError, hintOf, JobManager } from "../../server/jobs";
import type { JobEvent, JobView } from "../../server/types";

const node = (code: string, label = "test") => ({ cmd: process.execPath, args: ["-e", code], label });
const ended = (m: JobManager, id: string) => new Promise<JobView>((res) => {
  const j = m.get(id)!;
  if (j.state !== "running") return res(j);
  m.subscribe(id, (e: JobEvent) => { if (e.type === "end") res(e.job); });
});

describe("JobManager", () => {
  it("collects output and the exit state", async () => {
    const m = new JobManager();
    const ok = await ended(m, m.start("p", node("console.log('hello'); console.error('oops')")).id);
    expect(ok.state).toBe("done");
    expect(ok.output).toContain("hello");
    expect(ok.output).toContain("oops");
    const bad = await ended(m, m.start("p", node("process.exit(3)")).id);
    expect(bad.state).toBe("failed");
  });

  it("runs one job at a time per project", async () => {
    const m = new JobManager();
    const a = m.start("p", node("setTimeout(() => {}, 5000)", "Render"));
    expect(() => m.start("p", node(""))).toThrow(BusyError);
    expect(() => m.start("p", node(""))).toThrow(/Render is running/);
    const other = m.start("q", node(""));
    await ended(m, other.id);
    m.stop(a.id);
    expect((await ended(m, a.id)).state).toBe("stopped");
  });

  it("stops the whole process tree", async () => {
    const m = new JobManager();
    const code = "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => console.log(\"child\"), 100)'], { stdio: 'inherit' }); setTimeout(() => {}, 60000)";
    const j = m.start("p", node(code));
    await new Promise((r) => setTimeout(r, 600));
    m.stop(j.id);
    const done = await ended(m, j.id);
    expect(done.state).toBe("stopped");
    const len = m.get(j.id)!.output.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(m.get(j.id)!.output.length).toBe(len);
  });

  it("streams output to subscribers and finds the Studio link", async () => {
    const m = new JobManager();
    const j = m.start("p", node("console.log('Server ready - Local: http://localhost:3001'); setTimeout(() => {}, 200)"));
    const seen: string[] = [];
    m.subscribe(j.id, (e) => { if (e.type === "output") seen.push(e.text); });
    const done = await ended(m, j.id);
    expect(seen.join("")).toContain("Server ready");
    expect(done.link).toBe("http://localhost:3001");
  });

  it("keeps the last jobs of each project", async () => {
    const m = new JobManager(2);
    for (let i = 0; i < 3; i++) await ended(m, m.start("p", node(`console.log(${i})`)).id);
    expect(m.list("p").map((j) => j.output.trim())).toEqual(["2", "1"]);
  });

  it("reports a command that cannot start", async () => {
    const m = new JobManager();
    const j = await ended(m, m.start("p", { cmd: "no-such-program-xyz", args: [], label: "x" }).id);
    expect(j.state).toBe("failed");
    expect(j.output).toMatch(/ENOENT/);
  });
});

describe("hintOf", () => {
  it("names what would let a refused job through", () => {
    expect(hintOf("ERROR proposals.pending: 1\nRefusing to render: fix the errors above, or pass --force.")).toBe("force");
    expect(hintOf("Refusing to export: fix the errors above")).toBe("force");
    expect(hintOf('CapCut project "x" has been opened in CapCut since the last export: edits made there would be lost. Pass --replace to overwrite it')).toBe("replace");
    expect(hintOf('CapCut project "x" exists and was not created by Adam Studio')).toBeNull();
  });
});
