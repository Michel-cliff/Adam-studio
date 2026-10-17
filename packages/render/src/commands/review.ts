import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyPatch, indexWords, layoutStory, msToFrame, resolve, wordOutput,
  type Project, type Proposal, type StepId, type Timeline,
} from "@adam-studio/model";
import { ensureAnalysis } from "../analysis";
import { bundleWithMedia, renderFrame, renderVideo } from "../engine";
import { expandEnv, mergePlans, planMedia, type MediaPlan } from "../media";
import { loadProject } from "../project-io";

export function reviewTargets(project: Project, step?: string): Proposal[] {
  const pending = project.proposals.filter((p) => p.status === "pending" && p.variants.length > 0);
  const current = step ?? project.workflow?.current;
  return current ? pending.filter((p) => p.step === (current as StepId)) : pending;
}

/** Frames to preview for a proposal, computed on the project as the variant leaves it. */
export function reviewWindow(project: Project, timeline: Timeline, proposal: Proposal): { ranges: [number, number][]; still: number } {
  const fps = timeline.fps;
  const last = Math.max(0, timeline.durationFrames - 1);
  let anchorMs: number | null = null;
  if (proposal.anchor) {
    if ("atMs" in proposal.anchor) anchorMs = proposal.anchor.atMs;
    else {
      const w = indexWords(project).get(proposal.anchor.word);
      const out = w ? wordOutput(layoutStory(project).clips, w) : null;
      anchorMs = out ? out.startMs + proposal.anchor.offsetMs : null;
    }
  }
  if (anchorMs !== null) {
    // A variant can be shorter than the anchor, or an offset can point before the start: stay inside the edit.
    const center = Math.min(last, Math.max(0, msToFrame(anchorMs, fps)));
    const half = Math.round(1.5 * fps);
    return {
      ranges: [[Math.max(0, center - half), Math.min(last, center + half)]],
      still: Math.min(last, center + Math.round(0.15 * fps)),
    };
  }
  const half = Math.round(0.5 * fps);
  const ranges: [number, number][] = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const c = Math.min(last, Math.round(timeline.durationFrames * f));
    const r: [number, number] = [Math.max(0, c - half), Math.min(last, c + half - 1)];
    const prev = ranges[ranges.length - 1];
    // Overlapping samples (short edits) merge, so no frame is rendered twice.
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else ranges.push(r);
  }
  return { ranges, still: Math.min(last, Math.round(timeline.durationFrames * 0.5)) };
}

/** Text safe for ffmpeg drawtext: letters (accents included), digits, spaces, commas, dots, dashes. */
export function sheetLabel(key: string, label: string): string {
  return `${key}  ${label.replace(/[^\p{L}\p{N} ,.\-]/gu, "")}`;
}

function drawtextPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function makeSheet(stills: { file: string; text: string }[], fontFile: string, out: string): void {
  const inputs = stills.flatMap((s) => ["-i", s.file]);
  const font = existsSync(fontFile) ? `fontfile='${drawtextPath(fontFile)}':` : "";
  const labelled = stills
    .map((s, i) => `[${i}:v]scale=360:-1,drawtext=${font}text='${s.text}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=8:x=12:y=12[v${i}]`)
    .join(";");
  const join_ = stills.length > 1 ? `;${stills.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${stills.length}[out]` : "";
  const map = stills.length > 1 ? "[out]" : "[v0]";
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${labelled}${join_}`, "-map", map, "-frames:v", "1", out]);
}

export async function reviewCommand(projectDir: string, opts: { step?: string; analyze?: boolean } = {}): Promise<string[]> {
  const { dir, project, style } = loadProject(projectDir);
  const targets = reviewTargets(project, opts.step);
  if (targets.length === 0) {
    console.log("Nothing to review: no pending proposal with variants in this step.");
    return [];
  }
  type Job = { proposal: Proposal; key: string; label: string; applied: Project; timeline: Timeline; plan: MediaPlan };
  const jobs: Job[] = [];
  for (const p of targets) {
    for (const v of p.variants) {
      const timeline = resolve(project, style, { apply: { proposal: p.id, variant: v.key } });
      const applied = applyPatch(project, v.patch);
      ensureAnalysis(dir, applied, timeline, { analyze: opts.analyze ?? true });
      jobs.push({ proposal: p, key: v.key, label: v.label, applied, timeline, plan: planMedia(dir, applied, timeline) });
    }
  }
  const merged = mergePlans(jobs.map((j) => j.plan));
  const serveUrl = await bundleWithMedia(merged, join(dir, "renders", ".bundle"));
  const folders: string[] = [];
  for (const p of targets) {
    const folder = join(dir, "renders", "review", p.id);
    mkdirSync(folder, { recursive: true });
    const entries: { key: string; label: string; preview: string; still: string; ranges: [number, number][] }[] = [];
    for (const j of jobs.filter((x) => x.proposal.id === p.id)) {
      const win = reviewWindow(j.applied, j.timeline, p);
      // Each variant keeps its own fonts: a captions or hook variant may change them.
      const props = { timeline: j.timeline, media: merged.media, fonts: j.plan.fonts };
      await renderVideo(serveUrl, props, join(folder, `${j.key}.mp4`), win.ranges.length === 1 ? win.ranges[0]! : win.ranges);
      await renderFrame(serveUrl, props, win.still, join(folder, `${j.key}.png`));
      entries.push({ key: j.key, label: j.label, preview: `${j.key}.mp4`, still: `${j.key}.png`, ranges: win.ranges });
    }
    makeSheet(
      entries.map((e) => ({ file: join(folder, e.still), text: sheetLabel(e.key, e.label) })),
      expandEnv(style.fonts.caption.file),
      join(folder, "sheet.jpg"),
    );
    writeFileSync(join(folder, "index.json"), `${JSON.stringify({ proposal: p.id, step: p.step, reason: p.reason, variants: entries }, null, 2)}\n`);
    console.log(`review ready: ${folder}`);
    folders.push(folder);
  }
  return folders;
}
