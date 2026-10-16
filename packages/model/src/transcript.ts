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

/** Story pieces shorter than this are absorbed into the cut instead of leaving a sub-frame clip. */
const MIN_CLIP_MS = 50;

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
      const keepRight = c.outMs - e >= MIN_CLIP_MS;
      if (s - c.inMs >= MIN_CLIP_MS) parts.push({ ...c, outMs: s, transitionOut: keepRight ? { kind: "cut" } : c.transitionOut });
      if (keepRight) parts.push({ ...c, id: parts.length ? uniqueId(c.id, ids) : c.id, inMs: e });
      return parts;
    });
  }
  return { ...project, story };
}

/** Same asset and same look: two such clips that touch in source time can become one. */
function sameLook(a: Clip, b: Clip): boolean {
  return (
    a.asset === b.asset &&
    a.volume === b.volume &&
    JSON.stringify(a.framing) === JSON.stringify(b.framing) &&
    JSON.stringify(a.zoom) === JSON.stringify(b.zoom)
  );
}

/** Parts of [s, e] not covered by any clip of the asset (clips may overlap or touch). */
function missingRanges(story: Clip[], asset: string, s: number, e: number): [number, number][] {
  const kept = story
    .filter((c) => c.asset === asset)
    .map((c) => [c.inMs, c.outMs] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const missing: [number, number][] = [];
  let cursor = s;
  for (const [a, b] of kept) {
    if (b <= cursor) continue;
    if (a >= e) break;
    if (a > cursor) missing.push([cursor, Math.min(a, e)]);
    cursor = Math.max(cursor, b);
    if (cursor >= e) break;
  }
  if (cursor < e) missing.push([cursor, e]);
  return missing;
}

/** Inserts [s, e] right after the clip that precedes it in source time (or before the one that follows). */
function insertPiece(story: Clip[], asset: string, s: number, e: number, ids: Set<string>): Clip[] {
  let before = -1;
  story.forEach((c, k) => {
    if (c.asset === asset && c.outMs <= s && (before < 0 || c.outMs > story[before]!.outMs)) before = k;
  });
  let after = -1;
  if (before < 0) {
    story.forEach((c, k) => {
      if (c.asset === asset && c.inMs >= e && (after < 0 || c.inMs < story[after]!.inMs)) after = k;
    });
  }
  const neighbour = before >= 0 ? story[before]! : story[after]!;
  const at = before >= 0 ? before + 1 : after;
  const out = [...story];
  out.splice(at, 0, { ...neighbour, id: uniqueId(neighbour.id, ids), inMs: s, outMs: e, transitionOut: { kind: "cut" } });
  const next = out[at + 1];
  if (next && sameLook(out[at]!, next) && next.inMs === e) {
    out.splice(at, 2, { ...out[at]!, outMs: next.outMs, transitionOut: next.transitionOut, id: next.id });
  }
  const prev = out[at - 1];
  const cur = out[at]!;
  if (prev && sameLook(prev, cur) && prev.outMs === cur.inMs) {
    out.splice(at - 1, 2, { ...prev, outMs: cur.outMs, transitionOut: cur.transitionOut });
  }
  return out;
}

export function restoreWords(project: Project, wordIds: string[]): Project {
  let story = [...project.story];
  const ids = new Set(story.map((c) => c.id));
  for (const run of runs(refsOf(project, wordIds))) {
    const asset = run[0]!.asset;
    if (!story.some((c) => c.asset === asset)) {
      throw new EditError(`cannot restore: asset "${asset}" is not in the story`);
    }
    // Only the parts not already kept come back, each next to its source-time neighbour, so nothing plays twice.
    for (const [s, e] of missingRanges(story, asset, run[0]!.startMs, run[run.length - 1]!.endMs)) {
      story = insertPiece(story, asset, s, e, ids);
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
