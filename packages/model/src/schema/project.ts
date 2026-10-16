import { z } from "zod";

export const FormatSchema = z.enum(["9:16", "16:9"]);
const Ms = z.number().int().nonnegative();
const Unit = z.number().min(0).max(1);

export const CanvasSchema = z.object({ format: FormatSchema, fps: z.number().int().positive() });

export const AssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio", "image", "lottie"]),
  path: z.string().min(1),
  meta: z
    .object({
      durationMs: Ms.optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      hasAudio: z.boolean().optional(),
    })
    .default({}),
});

export const WordSchema = z
  .object({ id: z.string().min(1), text: z.string(), startMs: Ms, endMs: Ms })
  .refine((w) => w.endMs >= w.startMs, { message: "endMs must be >= startMs", path: ["endMs"] });

export const TranscriptSchema = z.object({
  lang: z.string().default("fr"),
  words: z.record(z.string(), z.array(WordSchema)).default({}),
});

const RectSchema = z.object({ x: Unit, y: Unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) });

export const FramingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cover") }),
  z.object({ mode: z.literal("fit"), background: z.enum(["blur", "color"]).default("blur"), color: z.string().optional() }),
  z.object({
    mode: z.literal("crop"),
    rect: RectSchema,
    keyframes: z.array(z.object({ atMs: Ms, rect: RectSchema })).default([]),
  }),
  z.object({ mode: z.literal("split"), asset: z.string().min(1), layout: z.string().default("top-bottom") }),
]);

export const ZoomSchema = z.object({ base: z.number().positive().default(1), driftPerSec: z.number().default(0) });

export const TransitionOutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cut") }),
  z.object({ kind: z.literal("crossfade"), durationMs: Ms }),
  z.object({ kind: z.literal("subjectSlide"), durationMs: Ms, word: z.string().optional() }),
]);

export const ClipSchema = z
  .object({
    id: z.string().min(1),
    asset: z.string().min(1),
    inMs: Ms,
    outMs: Ms,
    framing: FramingSchema.default({ mode: "cover" }),
    zoom: ZoomSchema.default({ base: 1, driftPerSec: 0 }),
    transitionOut: TransitionOutSchema.default({ kind: "cut" }),
    volume: z.number().min(0).default(1),
  })
  .refine((c) => c.outMs > c.inMs, { message: "outMs must be greater than inMs", path: ["outMs"] });

export const AnchorSchema = z.union([
  z.object({ word: z.string().min(1), offsetMs: z.number().int().default(0) }),
  z.object({ atMs: Ms }),
]);

export const ElementSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    layer: z.enum(["front", "behind-subject"]).default("front"),
    anchor: AnchorSchema,
    durationMs: Ms.optional(),
    untilWord: z.string().min(1).optional(),
    untilEnd: z.boolean().optional(),
    slot: z.string().default("center"),
    position: z.object({ x: Unit, y: Unit }).optional(),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (e) => [e.durationMs !== undefined, e.untilWord !== undefined, e.untilEnd === true].filter(Boolean).length === 1,
    { message: "set exactly one of durationMs, untilWord, untilEnd", path: ["durationMs"] },
  );

export const CaptionSchema = z.object({
  words: z.tuple([z.string().min(1), z.string().min(1)]),
  text: z.string().min(1),
  highlight: z.array(z.string().min(1)).default([]),
  lang: z.string().optional(),
});

export const BeatSchema = z.object({ role: z.string().min(1), from: z.string().min(1), to: z.string().min(1) });
export const StructureSchema = z.object({ framework: z.string().min(1), beats: z.array(BeatSchema).default([]) });

export const STEP_IDS = ["cuts", "structure", "captions", "hook", "beats", "visuals", "sound", "look"] as const;
export const StepIdSchema = z.enum(STEP_IDS);
export const StepStateSchema = z.enum(["locked", "open", "done"]);
export const WorkflowSchema = z.object({ current: StepIdSchema, steps: z.record(StepIdSchema, StepStateSchema) });

export const PatchSchema = z.object({
  addElements: z.array(ElementSchema).optional(),
  addCaptions: z.array(CaptionSchema).optional(),
  setStory: z.array(ClipSchema).min(1).optional(),
  setStructure: StructureSchema.optional(),
  setStyle: z.record(z.string(), z.unknown()).optional(),
  removeElements: z.array(z.string()).optional(),
});

export const VariantKeySchema = z.enum(["A", "B", "C"]);
export const VariantSchema = z.object({ key: VariantKeySchema, label: z.string().min(1), patch: PatchSchema });
export const ProposalStatusSchema = z.union([
  z.literal("pending"),
  z.literal("rejected"),
  z.object({ accepted: VariantKeySchema }),
]);
export const ProposalSchema = z.object({
  id: z.string().min(1),
  step: StepIdSchema,
  anchor: AnchorSchema.optional(),
  reason: z.string().default(""),
  variants: z.array(VariantSchema).max(3),
  status: ProposalStatusSchema.default("pending"),
  history: z
    .array(z.object({ variants: z.array(VariantSchema), decision: z.literal("more"), note: z.string().optional() }))
    .default([]),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  canvas: CanvasSchema,
  style: z.string().min(1),
  styleOverrides: z.record(z.string(), z.unknown()).default({}),
  assets: z.array(AssetSchema),
  transcript: TranscriptSchema.default({ lang: "fr", words: {} }),
  story: z.array(ClipSchema).min(1),
  elements: z.array(ElementSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  structure: StructureSchema.optional(),
  workflow: WorkflowSchema.optional(),
  proposals: z.array(ProposalSchema).default([]),
});

export type Asset = z.output<typeof AssetSchema>;
export type Word = z.output<typeof WordSchema>;
export type Framing = z.output<typeof FramingSchema>;
export type Zoom = z.output<typeof ZoomSchema>;
export type TransitionOut = z.output<typeof TransitionOutSchema>;
export type Clip = z.output<typeof ClipSchema>;
export type Anchor = z.output<typeof AnchorSchema>;
export type Element = z.output<typeof ElementSchema>;
export type ElementInput = z.input<typeof ElementSchema>;
export type Caption = z.output<typeof CaptionSchema>;
export type Beat = z.output<typeof BeatSchema>;
export type Structure = z.output<typeof StructureSchema>;
export type StepId = z.output<typeof StepIdSchema>;
export type StepState = z.output<typeof StepStateSchema>;
export type Workflow = z.output<typeof WorkflowSchema>;
export type Patch = z.output<typeof PatchSchema>;
export type VariantKey = z.output<typeof VariantKeySchema>;
export type Variant = z.output<typeof VariantSchema>;
export type ProposalStatus = z.output<typeof ProposalStatusSchema>;
export type Proposal = z.output<typeof ProposalSchema>;
export type Project = z.output<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
