import { z } from "zod";
import { FormatSchema, FramingSchema, TransitionOutSchema, ZoomSchema } from "./project";
import { StyleSchema } from "./style";

const Frame = z.number().int().nonnegative();
const Frames = z.number().int().positive();
const Ms = z.number().int().nonnegative();

export const TimelineClipSchema = z.object({
  id: z.string(),
  asset: z.string(),
  fromFrame: Frame,
  durationFrames: Frames,
  sourceInMs: Ms,
  sourceOutMs: Ms,
  framing: FramingSchema,
  zoom: ZoomSchema,
  transitionOut: TransitionOutSchema,
  volume: z.number().min(0),
});

export const TimelineElementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  layer: z.enum(["front", "behind-subject"]),
  fromFrame: Frame,
  durationFrames: Frames,
  /** Milliseconds cut off the element's own start when it was clamped at 0; the renderer starts that far in. */
  trimStartMs: Ms,
  x: z.number(),
  y: z.number(),
  props: z.record(z.string(), z.unknown()),
});

export const TimelineCaptionSchema = z.object({
  id: z.string(),
  fromFrame: Frame,
  durationFrames: Frames,
  text: z.string(),
  highlightRanges: z.array(z.tuple([Frame, Frame])),
  x: z.number(),
  y: z.number(),
});

export const TimelineBeatSchema = z.object({ role: z.string(), fromFrame: Frame, toFrame: Frame });

export const TimelineAudioSchema = z.object({
  id: z.string(),
  asset: z.string(),
  fromFrame: Frame,
  durationFrames: Frame,
  sourceInMs: Ms,
  volume: z.number().min(0),
  fadeInMs: Ms,
  fadeOutMs: Ms,
});

export const TimelineSchema = z.object({
  format: FormatSchema,
  width: Frames,
  height: Frames,
  fps: Frames,
  durationFrames: Frame,
  clips: z.array(TimelineClipSchema),
  elements: z.array(TimelineElementSchema),
  captions: z.array(TimelineCaptionSchema),
  beats: z.array(TimelineBeatSchema),
  audio: z.array(TimelineAudioSchema),
  orphans: z.array(z.string()),
  warnings: z.array(z.string()),
  style: StyleSchema,
});

export type TimelineClip = z.output<typeof TimelineClipSchema>;
export type TimelineElement = z.output<typeof TimelineElementSchema>;
export type TimelineCaption = z.output<typeof TimelineCaptionSchema>;
export type TimelineBeat = z.output<typeof TimelineBeatSchema>;
export type TimelineAudio = z.output<typeof TimelineAudioSchema>;
export type Timeline = z.output<typeof TimelineSchema>;
