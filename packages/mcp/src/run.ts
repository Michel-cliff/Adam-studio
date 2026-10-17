import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { buildCommand, cliCommand, type Command } from "@adam-studio/web/server/actions";
import { JobManager } from "@adam-studio/web/server/jobs";
import { venvPython } from "@adam-studio/web/server/paths";
import type { JobView } from "@adam-studio/web/server/types";
import { ToolError } from "./store";

const PANEL = `http://127.0.0.1:${process.env.ADAM_UI_PORT ?? 4317}`;
const local = new JobManager();

async function panelUp(): Promise<boolean> {
  try { return (await (await fetch(`${PANEL}/api/ping`, { signal: AbortSignal.timeout(800) })).json()).app === "adam-studio"; } catch { return false; }
}

function waitLocal(job: JobView): Promise<JobView> {
  return new Promise((res) => {
    if (job.state !== "running") return res(job);
    local.subscribe(job.id, (e) => { if (e.type === "end") res(e.job); });
  });
}

/** The project's name when it lives directly in the panel's projects folder. */
export function nameInRoot(dir: string, root: string): string | null {
  const r = relative(root, dir);
  return r && !r.startsWith("..") && !isAbsolute(r) && !/[\\/]/.test(r) ? r : null;
}

async function viaPanel(path: string, body: unknown): Promise<JobView> {
  const r = await fetch(`${PANEL}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new ToolError(data.error ?? `panel answered ${r.status}`);
  let job: JobView = data.job;
  while (job.state === "running") {
    await new Promise((res) => setTimeout(res, 1000));
    job = await (await fetch(`${PANEL}/api/jobs/${job.id}`)).json();
  }
  return job;
}

/**
 * Runs a panel action (analyze, render, review, capcut) and waits for it. Through the panel when it runs and
 * the project is in its folder, so the creator watches it live; otherwise as a local process.
 */
export async function runAction(dir: string, root: string, action: string, options: Record<string, unknown>): Promise<JobView> {
  const name = nameInRoot(dir, root);
  if (name && (await panelUp())) return viaPanel(`/projects/${encodeURIComponent(name)}/jobs`, { action, options });
  let command: Command;
  try { command = buildCommand(action, dir, options, venvPython("capcut", "ADAM_CAPCUT_PYTHON")); } catch (e) { throw new ToolError((e as Error).message); }
  return waitLocal(local.start(dir, command));
}

/** new / add through the panel when it runs, else locally. */
export async function runSetup(kind: "new" | "add", name: string | null, command: Command, body: unknown): Promise<JobView> {
  if (name && (await panelUp())) return viaPanel(kind === "new" ? "/projects" : `/projects/${encodeURIComponent(name)}/add`, body);
  return waitLocal(local.start(name ?? command.args.join(" "), command));
}

export function tail(job: JobView, lines = 30): string {
  const out = job.output.replace(/\r/g, "\n").split("\n").filter((l) => l.trim()).slice(-lines).join("\n");
  return `${job.label}: ${job.state}\n${out}`;
}

/** Renders stills and returns them as JPEG (960 px high) for Claude to look at. */
export async function stills(dir: string, at: number[], variant?: string): Promise<{ job: JobView; images: { file: string; data: string }[] }> {
  const job = await waitLocal(local.start(dir, cliCommand(["still", dir, "--at", at.join(","), ...(variant ? ["--variant", variant] : [])], "Still")));
  const files = [...job.output.matchAll(/^wrote (.+\.png)\s*$/gm)].map((m) => m[1]!.trim());
  const images = files.map((file) => {
    const jpg = join(tmpdir(), `adam-still-${process.pid}-${Date.now()}.jpg`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=-2:'min(960,ih)'", "-q:v", "4", jpg]);
    const data = readFileSync(jpg).toString("base64");
    rmSync(jpg, { force: true });
    return { file, data };
  });
  return { job, images };
}
