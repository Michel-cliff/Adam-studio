import { canvasSize } from "./time";
import type { Project } from "./schema/project";
import type { Style } from "./schema/style";
import type { Timeline, TimelineBeat, TimelineCaption } from "./schema/timeline";
import { createContext, mergeStyle } from "./context";
import { resolveClipAudio, resolveElements } from "./elements";

export { ResolveError } from "./context";

export function resolve(projectIn: Project, styleIn: Style): Timeline {
  const project = projectIn;
  const style = mergeStyle(styleIn, project.styleOverrides);
  const ctx = createContext(project, style);
  const { width, height } = canvasSize(project.canvas.format);
  const clips = ctx.clips.map((l) => ({
    id: l.clip.id,
    asset: l.clip.asset,
    fromFrame: ctx.frame(l.outStartMs),
    durationFrames: ctx.frame(l.outEndMs) - ctx.frame(l.outStartMs),
    sourceInMs: l.clip.inMs,
    sourceOutMs: l.clip.outMs,
    framing: l.clip.framing,
    zoom: l.clip.zoom,
    transitionOut: l.clip.transitionOut,
    volume: l.clip.volume,
  }));
  const { elements, sfx } = resolveElements(ctx);
  const captions: TimelineCaption[] = [];
  const beats: TimelineBeat[] = [];
  return {
    format: project.canvas.format,
    width,
    height,
    fps: ctx.fps,
    durationFrames: ctx.frame(ctx.totalMs),
    clips,
    elements,
    captions,
    beats,
    audio: [...resolveClipAudio(ctx), ...sfx],
    orphans: ctx.orphans,
    warnings: ctx.warnings,
    style,
  };
}
