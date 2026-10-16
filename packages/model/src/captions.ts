import { ResolveError, type ResolveContext } from "./context";
import type { TimelineBeat, TimelineCaption } from "./schema/timeline";
import { findHighlights, wrapCaption } from "./text";

/** Pieces shorter than this after a cut are dropped. */
const MIN_PIECE_MS = 50;

export function resolveCaptions(ctx: ResolveContext): TimelineCaption[] {
  const out: TimelineCaption[] = [];
  const pos = ctx.place("caption");
  ctx.project.captions.forEach((c, i) => {
    const first = ctx.words.get(c.words[0]);
    const last = ctx.words.get(c.words[1]);
    if (!first || !last) throw new ResolveError(`caption ${i} references unknown words`);
    const pieces: [number, number][] = [];
    for (const l of ctx.clips) {
      if (l.clip.asset !== first.asset) continue;
      const s = Math.max(first.startMs, l.clip.inMs);
      const e = Math.min(last.endMs, l.clip.outMs);
      if (e - s > MIN_PIECE_MS) pieces.push([l.outStartMs + s - l.clip.inMs, l.outStartMs + e - l.clip.inMs]);
    }
    if (pieces.length === 0) {
      ctx.orphans.push(`caption:${i}`);
      return;
    }
    const text = wrapCaption(c.text, ctx.style.caption.maxCharsPerLine);
    const { ranges, missing } = findHighlights(text, c.highlight);
    for (const m of missing) ctx.warnings.push(`caption ${i}: highlight "${m}" not found in "${c.text}"`);
    pieces.forEach(([s, e], k) => {
      const fromFrame = ctx.frame(s);
      out.push({
        id: pieces.length > 1 ? `cap${i}.${k}` : `cap${i}`,
        fromFrame,
        durationFrames: Math.max(1, ctx.frame(e) - fromFrame),
        text,
        highlightRanges: ranges,
        x: pos.x,
        y: pos.y,
      });
    });
  });
  return out.sort((a, b) => a.fromFrame - b.fromFrame);
}

export function resolveBeats(ctx: ResolveContext): TimelineBeat[] {
  const beats: TimelineBeat[] = [];
  for (const b of ctx.project.structure?.beats ?? []) {
    const from = ctx.wordOut(b.from);
    const to = ctx.wordOut(b.to);
    if (from === null || to === null) {
      ctx.orphans.push(`beat:${b.role}`);
      continue;
    }
    beats.push({ role: b.role, fromFrame: ctx.frame(from.startMs), toFrame: ctx.frame(to.endMs) });
  }
  return beats;
}
