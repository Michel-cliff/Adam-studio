import type { Project } from "./schema/project";
import type { Timeline } from "./schema/timeline";
import { getFramework } from "./frameworks";
import { layoutStory, wordOutput } from "./layout";
import { normalizeWord } from "./text";
import { indexWords } from "./words";

export interface LintWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  ids: string[];
}

export interface LintOptions {
  /** Project folder, used to locate relative asset paths and the analysis cache. */
  projectDir?: string;
  /** Injected file check (the model package never touches the file system itself). */
  fileExists?: (path: string) => boolean;
}

const TEXT_KINDS = new Set(["title", "text.behindSubject"]);

function keptWords(project: Project) {
  const { clips } = layoutStory(project);
  const out: { id: string; text: string; startMs: number; endMs: number }[] = [];
  for (const w of indexWords(project).values()) {
    const o = wordOutput(clips, w);
    if (o) out.push({ id: w.id, text: w.text, ...o });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function lint(project: Project, timeline: Timeline, options: LintOptions = {}): LintWarning[] {
  const out: LintWarning[] = [];
  const warn = (rule: string, message: string, ids: string[] = [], severity: LintWarning["severity"] = "warning") =>
    out.push({ rule, severity, message, ids });
  const frameMs = (f: number) => Math.round((f * 1000) / timeline.fps);
  const rules = timeline.style.lint[timeline.format];
  const kept = keptWords(project);
  const { totalMs } = layoutStory(project);

  // Clips cut past the end of their take (the render would freeze or go black there)
  for (const c of project.story) {
    const dur = project.assets.find((a) => a.id === c.asset)?.meta.durationMs;
    if (dur !== undefined && c.outMs > dur + 50) warn("story.pastEnd", `clip "${c.id}" ends at ${c.outMs} ms, after the end of take "${c.asset}" (${dur} ms)`, [c.id], "error");
  }

  // The first 3 seconds
  const textStarts = [
    ...timeline.elements.filter((e) => TEXT_KINDS.has(e.kind)).map((e) => e.fromFrame),
    ...timeline.captions.map((c) => c.fromFrame),
  ];
  if (textStarts.length === 0 || frameMs(Math.min(...textStarts)) > 3000) {
    warn("hook.first3s", "No text hook appears in the first 3 seconds");
  }
  const firstWord = kept[0];
  if (firstWord && firstWord.startMs > 500) {
    warn("hook.first3s", `Speech starts at ${firstWord.startMs} ms (more than 500 ms)`, [firstWord.id]);
  }

  // Edit ruthlessly
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1]!;
    const b = kept[i]!;
    const gap = b.startMs - a.endMs;
    if (gap > rules.maxPauseMs) warn("pace.pauses", `${gap} ms pause between "${a.text}" and "${b.text}"`, [a.id, b.id]);
  }
  const fillers = new Set((rules.fillers ?? timeline.style.fillers?.[project.transcript.lang] ?? []).map(normalizeWord));
  for (let i = 0; i < kept.length; i++) {
    const one = normalizeWord(kept[i]!.text);
    if (fillers.has(one)) warn("pace.fillers", `Filler "${kept[i]!.text}" is still in the edit`, [kept[i]!.id]);
    const next = kept[i + 1];
    if (next && fillers.has(`${one} ${normalizeWord(next.text)}`)) {
      warn("pace.fillers", `Filler "${kept[i]!.text} ${next.text}" is still in the edit`, [kept[i]!.id, next.id]);
    }
  }

  // Duration
  if (totalMs < rules.minDurationMs || totalMs > rules.maxDurationMs) {
    warn("duration.range", `Duration ${totalMs} ms is outside ${rules.minDurationMs} to ${rules.maxDurationMs} ms for ${timeline.format}`);
  }

  // Structure
  if (project.structure) {
    const fw = getFramework(project.structure.framework);
    if (!fw) {
      warn("structure.beats", `Unknown framework "${project.structure.framework}"`, [], "error");
    } else {
      const roles = fw.beats.map((b) => b.role);
      const missing = roles.filter((r) => !timeline.beats.some((b) => b.role === r));
      if (missing.length) warn("structure.beats", `Missing beats for ${fw.id}: ${missing.join(", ")}`, missing);
      const ordered = [...timeline.beats].sort((a, b) => a.fromFrame - b.fromFrame);
      const inOrder = ordered.every((b, i) => {
        const prev = ordered[i - 1];
        return !prev || (roles.indexOf(prev.role) <= roles.indexOf(b.role) && prev.toFrame <= b.fromFrame);
      });
      if (!inOrder) warn("structure.beats", `Beats are not in the order of ${fw.id}`);
      for (const beat of timeline.beats) {
        const limit = fw.beats.find((b) => b.role === beat.role)?.maxMs;
        const lasts = frameMs(beat.toFrame - beat.fromFrame);
        if (limit !== undefined && lasts > limit) {
          warn("structure.beats", `Beat ${beat.role} lasts ${lasts} ms (limit ${limit} ms)`, [beat.role]);
        }
      }
    }
  }

  // Orphans
  if (timeline.orphans.length) {
    warn("elements.orphans", `${timeline.orphans.length} item(s) anchored to cut words are hidden`, timeline.orphans);
  }

  // Files
  if (options.fileExists && options.projectDir !== undefined) {
    const exists = options.fileExists;
    const dir = options.projectDir;
    const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p);
    const assets = new Map(project.assets.map((a) => [a.id, a]));
    for (const a of project.assets) {
      const path = isAbsolute(a.path) ? a.path : `${dir}/${a.path}`;
      if (!exists(path)) warn("assets.missing", `Asset "${a.id}" not found at ${a.path}`, [a.id], "error");
    }
    const need = (asset: string, file: string, step: string) => {
      if (!exists(`${dir}/cache/${asset}/${file}`)) {
        warn("assets.missing", `Missing ${file} for asset "${asset}": run the ${step} analysis step`, [asset], "error");
      }
    };
    const inStory = [...new Set(project.story.map((c) => c.asset))].filter((id) => assets.get(id)?.kind === "video");
    for (const id of inStory) need(id, "edit.mp4", "variants");
    const slide = new Set<string>();
    project.story.forEach((c, i) => {
      if (c.transitionOut.kind !== "subjectSlide") return;
      slide.add(c.asset);
      const next = project.story[i + 1];
      if (next) slide.add(next.asset);
    });
    const behind = new Set<string>();
    for (const el of timeline.elements.filter((e) => e.layer === "behind-subject")) {
      for (const c of timeline.clips) {
        if (c.fromFrame < el.fromFrame + el.durationFrames && el.fromFrame < c.fromFrame + c.durationFrames) behind.add(c.asset);
      }
    }
    for (const id of new Set([...slide, ...behind])) need(id, "subject.webm", "matting");
    for (const id of slide) need(id, "plate.png", "clean plate");
  }

  // Proposals
  const pending = project.proposals.filter((p) => p.status === "pending");
  if (pending.length) {
    warn("proposals.pending", `${pending.length} proposal(s) still pending`, pending.map((p) => p.id), "error");
  }

  return out;
}
