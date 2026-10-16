import { anchorMs, type ResolveContext } from "./context";
import { SfxPropsSchema } from "./schema/kinds";
import type { TimelineAudio, TimelineElement } from "./schema/timeline";

export function resolveElements(ctx: ResolveContext): { elements: TimelineElement[]; sfx: TimelineAudio[] } {
  const elements: TimelineElement[] = [];
  const sfx: TimelineAudio[] = [];
  for (const el of ctx.project.elements) {
    const start = anchorMs(ctx, el.anchor);
    if (start === null) {
      ctx.orphans.push(el.id);
      continue;
    }
    let end: number | null;
    if (el.durationMs !== undefined) end = start + el.durationMs;
    else if (el.untilWord !== undefined) {
      const out = ctx.wordOut(el.untilWord);
      end = out === null ? null : out.endMs;
    } else end = ctx.totalMs;
    if (end === null) {
      ctx.orphans.push(el.id);
      continue;
    }
    const fromFrame = ctx.frame(Math.max(0, start));
    const toFrame = ctx.frame(Math.min(ctx.totalMs, end));
    if (toFrame - fromFrame < 1) {
      ctx.warnings.push(`element "${el.id}" has no visible duration and was dropped`);
      continue;
    }
    if (el.kind === "sfx") {
      const p = SfxPropsSchema.parse(el.props);
      sfx.push({
        id: el.id,
        asset: p.asset,
        fromFrame,
        durationFrames: toFrame - fromFrame,
        sourceInMs: 0,
        volume: p.volume,
        fadeInMs: p.fadeInMs,
        fadeOutMs: p.fadeOutMs,
      });
      continue;
    }
    const { x, y } = ctx.place(el.slot, el.position);
    elements.push({ id: el.id, kind: el.kind, layer: el.layer, fromFrame, durationFrames: toFrame - fromFrame, x, y, props: el.props });
  }
  return { elements, sfx };
}

export function resolveClipAudio(ctx: ResolveContext): TimelineAudio[] {
  const assets = new Map(ctx.project.assets.map((a) => [a.id, a]));
  return ctx.clips
    .filter((l) => {
      const a = assets.get(l.clip.asset);
      return a !== undefined && (a.kind === "audio" || (a.kind === "video" && a.meta.hasAudio !== false));
    })
    .map((l) => ({
      id: `clip:${l.clip.id}`,
      asset: l.clip.asset,
      fromFrame: ctx.frame(l.outStartMs),
      durationFrames: ctx.frame(l.outEndMs) - ctx.frame(l.outStartMs),
      sourceInMs: l.clip.inMs,
      volume: l.clip.volume,
      fadeInMs: 0,
      fadeOutMs: 0,
    }));
}
