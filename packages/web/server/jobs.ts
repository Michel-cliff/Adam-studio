import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Command } from "./actions";
import type { Hint, JobEvent, JobView } from "./types";

const MAX_OUTPUT = 200_000;
export class BusyError extends Error {}

export function hintOf(output: string): Hint {
  if (/Pass --replace/.test(output)) return "replace";
  if (/Refusing to (render|export)/.test(output)) return "force";
  return null;
}

export class JobManager {
  private jobs = new Map<string, JobView>();
  private procs = new Map<string, ChildProcess>();
  private listeners = new Map<string, Set<(e: JobEvent) => void>>();
  private stopping = new Set<string>();
  private seq = 0;

  constructor(private keep = 20) {}

  running(project: string): JobView | undefined {
    return [...this.jobs.values()].find((j) => j.project === project && j.state === "running");
  }

  start(project: string, c: Command, onEnd?: (j: JobView) => void): JobView {
    const busy = this.running(project);
    if (busy) throw new BusyError(`${project} is busy: ${busy.label} is running`);
    const job: JobView = { id: `j${++this.seq}`, project, label: c.label, state: "running", output: "", startedAt: Date.now(), hint: null };
    this.jobs.set(job.id, job);
    const emit = (e: JobEvent) => { for (const fn of this.listeners.get(job.id) ?? []) fn(e); };
    const add = (chunk: Buffer | string) => {
      const text = chunk.toString();
      job.output = (job.output + text).slice(-MAX_OUTPUT);
      const link = text.match(/https?:\/\/localhost:\d+/);
      if (link && !job.link) job.link = link[0];
      emit({ type: "output", text });
    };
    const finish = (code: number | null) => {
      if (job.state !== "running") return;
      job.state = this.stopping.delete(job.id) ? "stopped" : code === 0 ? "done" : "failed";
      job.hint = job.state === "failed" ? hintOf(job.output) : null;
      job.endedAt = Date.now();
      this.procs.delete(job.id);
      emit({ type: "end", job: { ...job } });
      this.listeners.delete(job.id);
      this.prune(project);
      onEnd?.(job);
    };
    const child = spawn(c.cmd, c.args, { windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, FORCE_COLOR: "0" } });
    this.procs.set(job.id, child);
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    child.on("error", (err) => { add(`${err.message}\n`); finish(1); });
    child.on("close", (code) => finish(code));
    return job;
  }

  get(id: string): JobView | undefined { return this.jobs.get(id); }

  /** Newest first. */
  list(project: string): JobView[] {
    return [...this.jobs.values()].filter((j) => j.project === project).reverse();
  }

  subscribe(id: string, fn: (e: JobEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn);
    this.listeners.set(id, set);
    return () => set.delete(fn);
  }

  stop(id: string): boolean {
    const child = this.procs.get(id);
    if (!child || child.pid === undefined) return false;
    this.stopping.add(id);
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
    return true;
  }

  stopAll(): void { for (const id of [...this.procs.keys()]) this.stop(id); }

  private prune(project: string): void {
    const ended = [...this.jobs.values()].filter((j) => j.project === project && j.state !== "running");
    for (const j of ended.slice(0, Math.max(0, ended.length - this.keep))) this.jobs.delete(j.id);
  }
}
