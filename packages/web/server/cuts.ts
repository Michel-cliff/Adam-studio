import type { Clip, Project, Word } from "@adam-studio/model";

const MIN_PIECE_MS = 100;

/** Removes [from, to) source ranges of one take from every story clip of that take, splitting clips as needed. */
function subtract(project: Project, asset: string, ranges: [number, number][]): Project {
  const ids = new Set(project.story.map((c) => c.id));
  const fresh = (id: string) => {
    for (const s of "bcdefghijklmnopqrstuvwxyz") if (!ids.has(`${id}${s}`)) { ids.add(`${id}${s}`); return `${id}${s}`; }
    throw new Error(`too many pieces for clip ${id}`);
  };
  const story: Clip[] = [];
  for (const clip of project.story) {
    if (clip.asset !== asset) { story.push(clip); continue; }
    let pieces: [number, number][] = [[clip.inMs, clip.outMs]];
    for (const [from, to] of ranges) {
      pieces = pieces.flatMap(([a, b]): [number, number][] => (to <= a || from >= b ? [[a, b]] : [[a, Math.max(a, from)], [Math.min(b, to), b]]));
    }
    pieces = pieces.filter(([a, b]) => b - a >= MIN_PIECE_MS);
    pieces.forEach(([a, b], i) => {
      const last = i === pieces.length - 1;
      story.push({ ...clip, id: i === 0 ? clip.id : fresh(clip.id), inMs: a, outMs: b, transitionOut: last ? clip.transitionOut : { kind: "cut" } });
    });
  }
  if (story.length === 0) throw new Error("nothing left in the story after this cut");
  return { ...project, story };
}

function wordsOf(project: Project, asset: string): Word[] {
  return [...(project.transcript.words[asset] ?? [])].sort((a, b) => a.startMs - b.startMs);
}

/** Cuts the words (and the pause after each run of them, or the tail of the clip after the last word). */
export function cutWords(project: Project, wordIds: string[]): Project {
  const byAsset = new Map<string, Set<string>>();
  for (const id of wordIds) {
    const asset = id.slice(0, id.lastIndexOf(".w"));
    if (!wordsOf(project, asset).some((w) => w.id === id)) throw new Error(`unknown word "${id}"`);
    byAsset.set(asset, (byAsset.get(asset) ?? new Set()).add(id));
  }
  let next = project;
  for (const [asset, chosen] of byAsset) {
    const words = wordsOf(project, asset);
    const ranges: [number, number][] = [];
    for (let i = 0; i < words.length; i++) {
      if (!chosen.has(words[i]!.id)) continue;
      let j = i;
      while (j + 1 < words.length && chosen.has(words[j + 1]!.id)) j++;
      // The run ends where the next word starts, or at the end of the clip holding its last word.
      const clip = project.story.find((c) => c.asset === asset && words[j]!.startMs < c.outMs && words[j]!.endMs > c.inMs);
      const after = words[j + 1];
      const end = after && (!clip || after.startMs < clip.outMs) ? after.startMs : clip?.outMs ?? words[j]!.endMs;
      ranges.push([words[i]!.startMs, end]);
      i = j;
    }
    next = subtract(next, asset, ranges);
  }
  return next;
}

/** Shortens every pause between words longer than minPauseMs to keepMs (half kept on each side). */
export function tightenPauses(project: Project, minPauseMs: number, keepMs: number): Project {
  let next = project;
  for (const asset of new Set(project.story.map((c) => c.asset))) {
    const words = wordsOf(project, asset);
    const ranges: [number, number][] = [];
    for (let i = 0; i + 1 < words.length; i++) {
      const gap = words[i + 1]!.startMs - words[i]!.endMs;
      if (gap > minPauseMs) ranges.push([words[i]!.endMs + keepMs / 2, words[i + 1]!.startMs - keepMs / 2]);
    }
    if (ranges.length) next = subtract(next, asset, ranges);
  }
  return next;
}
