import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project, Timeline } from "@adam-studio/model";
import { missingAnalysis } from "./media";
import { CliError } from "./project-io";
import type { Take } from "./takes";

export const CHEAP_STEPS = ["edit", "proxy", "transcript", "silences"];
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function analysisPython(): string {
  if (process.env.ADAM_ANALYSIS_PYTHON) return process.env.ADAM_ANALYSIS_PYTHON;
  for (const p of [join(REPO, "py/analysis/.venv/Scripts/python.exe"), join(REPO, "py/analysis/.venv/bin/python")]) if (existsSync(p)) return p;
  throw new CliError("The analysis environment is missing. Create it (see README, Analysis):\n  python -m venv py/analysis/.venv\n  ...");
}

export function analysisArgs(projectDir: string, videos: Record<string, string>, steps: string[], opts: { fps: number; lang?: string; force?: boolean }): string[] {
  return [
    "-m", "adam_analysis", "run", projectDir,
    ...Object.entries(videos).flatMap(([id, path]) => ["--video", `${id}=${path}`]),
    "--steps", steps.join(","), "--fps", String(opts.fps),
    ...(opts.lang ? ["--lang", opts.lang] : []),
    ...(opts.force ? ["--force"] : []),
  ];
}

export function runAnalysis(projectDir: string, videos: Record<string, string>, steps: string[], opts: { fps: number; lang?: string; force?: boolean }): void {
  if (Object.keys(videos).length === 0 || steps.length === 0) return;
  const r = spawnSync(analysisPython(), analysisArgs(projectDir, videos, steps, opts), { stdio: "inherit" });
  if (r.status !== 0) throw new CliError("The analysis failed: see the message above.");
}

export function readTake(projectDir: string, id: string, path: string): Take {
  const cache = join(projectDir, "cache", id);
  const probe = JSON.parse(readFileSync(join(cache, "probe.json"), "utf8"));
  const transcript = JSON.parse(readFileSync(join(cache, "transcript.json"), "utf8"));
  return {
    path,
    probe: { durationMs: probe.durationMs, width: probe.width, height: probe.height, hasAudio: probe.sourceHasAudio ?? probe.hasAudio },
    transcript: { lang: transcript.lang, words: transcript.words },
  };
}

/** Runs the analysis the timeline still needs, or refuses with the command when analysis is off. */
export function ensureAnalysis(projectDir: string, project: Project, timeline: Timeline,
  opts: { analyze: boolean; run?: (dir: string, videos: Record<string, string>, steps: string[], o: { fps: number }) => void }): void {
  const missing = missingAnalysis(projectDir, project, timeline);
  if (missing.length === 0) return;
  if (!opts.analyze) {
    const list = missing.map((m) => `${m.asset} ${m.step}`).join(", ");
    throw new CliError(`The cache lacks: ${list}. Run: npm run adam -- analyze ${projectDir}`);
  }
  const run = opts.run ?? runAnalysis;
  const paths = new Map(project.assets.map((a) => [a.id, a.path]));
  for (const step of ["edit", "subject", "plate"] as const) {
    const ids = missing.filter((m) => m.step === step).map((m) => m.asset);
    if (ids.length) run(projectDir, Object.fromEntries(ids.map((id) => [id, paths.get(id)!])), [step], { fps: project.canvas.fps });
  }
}
