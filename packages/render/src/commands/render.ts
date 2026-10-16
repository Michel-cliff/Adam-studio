import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { lint, resolve, type Project, type Timeline } from "@adam-studio/model";
import { bundleWithMedia, renderVideo } from "../engine";
import { planMedia } from "../media";
import { CliError, loadProject } from "../project-io";

export function parseFrames(s?: string): [number, number] | null {
  if (!s) return null;
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (!m) throw new CliError(`--frames expects a-b (e.g. 0-90), got "${s}"`);
  return [Number(m[1]), Number(m[2])];
}

/** The project name as a file name: characters Windows forbids become "-" (a ":" would write an NTFS stream). */
export function fileSafeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/, "").trim() || "edit";
}

/** Prints the lint warnings and refuses to go on while any is an error, unless forced. */
export function lintGate(project: Project, timeline: Timeline, dir: string, force: boolean, action: "render" | "export"): void {
  const warnings = lint(project, timeline, { projectDir: dir, fileExists: existsSync });
  for (const w of warnings) console.log(`${w.severity === "error" ? "ERROR" : "warn "} ${w.rule}: ${w.message}`);
  if (warnings.some((w) => w.severity === "error") && !force) {
    throw new CliError(`Refusing to ${action}: fix the errors above, or pass --force.`);
  }
}

export async function renderCommand(projectDir: string, opts: { out?: string; frames?: string; force: boolean }): Promise<string> {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  lintGate(project, timeline, dir, opts.force, "render");
  const plan = planMedia(dir, project, timeline);
  const serveUrl = await bundleWithMedia(plan, join(dir, "renders", ".bundle"));
  const name = fileSafeName(project.name);
  const out = opts.out ? resolvePath(opts.out) : join(dir, "renders", `${name}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(join(dir, "renders", `${name}.timeline.json`), `${JSON.stringify(timeline, null, 2)}\n`);
  await renderVideo(serveUrl, { timeline, media: plan.media, fonts: plan.fonts }, out, parseFrames(opts.frames));
  console.log(`wrote ${out}`);
  return out;
}
