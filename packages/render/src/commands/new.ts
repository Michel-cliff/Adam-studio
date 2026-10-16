import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import { parseProject, type ProjectInput } from "@adam-studio/model";
import { CHEAP_STEPS, readTake, runAnalysis } from "../analysis";
import { CliError, formatErrors, loadProject } from "../project-io";
import { addTakes, defaultStyle, findSystemFont, nextAssetIds } from "../takes";

type Opts = { lang?: string; format?: string; style?: string; name?: string };

/** Analyzes the videos not yet in the project (cheap steps), merges them, validates and writes project.json. */
function analyzeAndAdd(dir: string, project: ProjectInput, videos: string[], opts: Opts): ProjectInput {
  const paths = videos.map((v) => resolvePath(v));
  for (const p of paths) if (!existsSync(p)) throw new CliError(`video not found: ${p}`);
  const known = new Set((project.assets ?? []).map((a) => a.path));
  for (const p of paths) if (known.has(p)) console.log(`already in the project, skipped: ${p}`);
  const fresh = [...new Set(paths.filter((p) => !known.has(p)))];
  const ids = nextAssetIds((project.assets ?? []).map((a) => a.id), fresh.length);
  runAnalysis(dir, Object.fromEntries(fresh.map((p, i) => [ids[i]!, p])), CHEAP_STEPS, { fps: project.canvas.fps, lang: opts.lang });
  const next = addTakes(project, fresh.map((p, i) => readTake(dir, ids[i]!, p)));
  const parsed = parseProject(next);
  if (!parsed.ok) throw new CliError(formatErrors("project.json", parsed.errors));
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function newCommand(dir: string, videos: string[], opts: Opts): void {
  if (videos.length === 0) throw new CliError("adam new needs at least one video");
  if (existsSync(join(dir, "project.json"))) throw new CliError(`${dir} already has a project.json: use adam add`);
  const format = opts.format ?? "9:16";
  if (format !== "9:16" && format !== "16:9") throw new CliError(`--format must be 9:16 or 16:9, got "${format}"`);
  mkdirSync(dir, { recursive: true });
  const style = opts.style ? JSON.parse(readFileSync(resolvePath(opts.style), "utf8")) : defaultStyle(findSystemFont());
  writeFileSync(join(dir, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  const project: ProjectInput = { version: 1, name: opts.name ?? basename(dir), canvas: { format, fps: 30 }, style: "style.json", assets: [], story: [] };
  const done = analyzeAndAdd(dir, project, videos, opts);
  console.log(`${dir}: ${done.assets!.length} takes, ${Object.values(done.transcript!.words!).flat().length} words`);
}

export function addCommand(dir: string, videos: string[], opts: Opts): void {
  if (videos.length === 0) throw new CliError("adam add needs at least one video");
  const { project } = loadProject(dir);
  const done = analyzeAndAdd(dir, project, videos, opts);
  console.log(`${dir}: ${done.assets!.length} takes`);
}
