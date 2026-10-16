import type { Clip, Project } from "./schema/project";
import { indexWords, type WordRef } from "./words";

export class EditError extends Error {}

function refsOf(project: Project, wordIds: string[]): WordRef[] {
  const words = indexWords(project);
  return wordIds.map((id) => {
    const w = words.get(id);
    if (!w) throw new EditError(`unknown word "${id}"`);
    return w;
  });
}

/** Groups words into runs of consecutive words of the same asset. */
function runs(refs: WordRef[]): WordRef[][] {
  const sorted = [...refs].sort((a, b) => (a.asset === b.asset ? a.index - b.index : a.asset < b.asset ? -1 : 1));
  const out: WordRef[][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && prev.asset === w.asset && w.index === prev.index + 1) last.push(w);
    else if (!(prev && prev.id === w.id)) out.push([w]);
  }
  return out;
}

function uniqueId(base: string, ids: Set<string>): string {
  let n = 2;
  while (ids.has(`${base}~${n}`)) n++;
  const id = `${base}~${n}`;
  ids.add(id);
  return id;
}

export function cutWords(project: Project, wordIds: string[]): Project {
  let story = project.story;
  const ids = new Set(story.map((c) => c.id));
  for (const run of runs(refsOf(project, wordIds))) {
    const first = run[0]!;
    const s = first.startMs;
    const e = run[run.length - 1]!.endMs;
    story = story.flatMap((c): Clip[] => {
      if (c.asset !== first.asset || e <= c.inMs || s >= c.outMs) return [c];
      const parts: Clip[] = [];
      if (s > c.inMs) parts.push({ ...c, outMs: s, transitionOut: e < c.outMs ? { kind: "cut" } : c.transitionOut });
      if (e < c.outMs) parts.push({ ...c, id: parts.length ? uniqueId(c.id, ids) : c.id, inMs: e });
      return parts;
    });
  }
  return { ...project, story };
}

export function restoreWords(project: Project, wordIds: string[]): Project {
  const story = [...project.story];
  const ids = new Set(story.map((c) => c.id));
  for (const run of runs(refsOf(project, wordIds))) {
    const asset = run[0]!.asset;
    const s = run[0]!.startMs;
    const e = run[run.length - 1]!.endMs;
    if (story.some((c) => c.asset === asset && s >= c.inMs && e <= c.outMs)) continue;
    let at = -1;
    story.forEach((c, k) => {
      if (c.asset === asset && c.outMs <= s) at = k;
    });
    let neighbour: Clip | undefined = story[at];
    let insertAt = at + 1;
    if (at < 0) {
      insertAt = story.findIndex((c) => c.asset === asset && c.inMs >= e);
      if (insertAt < 0) throw new EditError(`cannot restore: asset "${asset}" is not in the story`);
      neighbour = story[insertAt];
    }
    const template = neighbour!;
    story.splice(insertAt, 0, { ...template, id: uniqueId(template.id, ids), inMs: s, outMs: e, transitionOut: { kind: "cut" } });
    // Merge with the clips it touches, so a cut followed by a restore gives back the original clip.
    const i = insertAt;
    const next = story[i + 1];
    if (next && next.asset === asset && next.inMs === e) {
      story.splice(i, 2, { ...story[i]!, outMs: next.outMs, transitionOut: next.transitionOut, id: next.id });
    }
    const prev = story[i - 1];
    if (prev && prev.asset === asset && prev.outMs === s) {
      const cur = story[i]!;
      story.splice(i - 1, 2, { ...prev, outMs: cur.outMs, transitionOut: cur.transitionOut });
    }
  }
  return { ...project, story };
}

export function trimToWords(
  project: Project,
  clipId: string,
  firstWordId: string,
  lastWordId: string,
  pad: { beforeMs: number; afterMs: number } = { beforeMs: 80, afterMs: 60 },
): Project {
  const idx = project.story.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new EditError(`unknown clip "${clipId}"`);
  const clip = project.story[idx]!;
  const [first, last] = refsOf(project, [firstWordId, lastWordId]);
  if (first!.asset !== clip.asset || last!.asset !== clip.asset) {
    throw new EditError(`words must belong to the clip's asset "${clip.asset}"`);
  }
  const duration = project.assets.find((a) => a.id === clip.asset)?.meta.durationMs ?? Number.POSITIVE_INFINITY;
  const inMs = Math.max(0, first!.startMs - pad.beforeMs);
  const outMs = Math.min(duration, last!.endMs + pad.afterMs);
  if (outMs <= inMs) throw new EditError(`trimming "${clipId}" would leave nothing`);
  const story = project.story.map((c, k) => (k === idx ? { ...c, inMs, outMs } : c));
  return { ...project, story };
}
