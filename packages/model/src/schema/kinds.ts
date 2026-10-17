import { z } from "zod";

const Ms = z.number().int().nonnegative();

export const TitlePropsSchema = z.strictObject({
  kicker: z.string().optional(),
  phases: z
    .array(
      z
        .strictObject({
          startMs: Ms,
          endMs: Ms,
          lines: z
            .array(z.strictObject({ text: z.string().min(1), box: z.boolean().default(false), sizeScale: z.number().positive().default(1) }))
            .min(1),
        })
        .refine((p) => p.endMs > p.startMs, { message: "endMs must be greater than startMs", path: ["endMs"] }),
    )
    .min(1),
});

export const BehindSubjectTextPropsSchema = z.strictObject({
  text: z.string().min(1),
  color: z.string().default("accent"),
  sizeScale: z.number().positive().default(1),
});

export const ImagePropsSchema = z.strictObject({
  asset: z.string().min(1),
  fit: z.enum(["full", "contain", "cover"]).default("full"),
  intro: z.string().optional(),
  outro: z.string().optional(),
});

export const SfxPropsSchema = z.strictObject({
  asset: z.string().min(1),
  volume: z.number().min(0).default(1),
  fadeInMs: Ms.default(0),
  fadeOutMs: Ms.default(0),
});

export const HudPanelPropsSchema = z.strictObject({
  title: z.string().default(""),
  lines: z.array(z.string()).default([]),
  asset: z.string().optional(),
  color: z.string().default("accent"),
  typing: z.boolean().default(true),
  width: z.number().min(0.2).max(1).default(0.8),
});

export const HudStatPropsSchema = z.strictObject({
  label: z.string(),
  value: z.number(),
  from: z.number().default(0),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
  decimals: z.number().int().min(0).max(4).default(0),
  color: z.string().default("accent"),
  countMs: Ms.default(900),
});

export const LottiePropsSchema = z.strictObject({
  asset: z.string().min(1),
  loop: z.boolean().default(false),
  playbackRate: z.number().positive().default(1),
  width: z.number().min(0.05).max(1).default(0.5),
});

/** A punch-in on the main track (take, behind-subject elements and cut-out together); not drawn itself. */
export const CameraZoomPropsSchema = z.strictObject({
  scale: z.number().min(1).max(4).default(1.3),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.4),
  easeMs: Ms.default(300),
});

export const KIND_SCHEMAS = {
  title: TitlePropsSchema,
  "text.behindSubject": BehindSubjectTextPropsSchema,
  image: ImagePropsSchema,
  sfx: SfxPropsSchema,
  "hud.panel": HudPanelPropsSchema,
  "hud.stat": HudStatPropsSchema,
  lottie: LottiePropsSchema,
  "camera.zoom": CameraZoomPropsSchema,
} as const;

export type KindName = keyof typeof KIND_SCHEMAS;
export const KIND_NAMES = Object.keys(KIND_SCHEMAS) as KindName[];
/** Kinds whose props.asset must name an asset of the project. */
export const ASSET_PROP_KINDS: ReadonlySet<string> = new Set(["image", "sfx", "lottie", "hud.panel"]);

export function isKind(kind: string): kind is KindName {
  return Object.prototype.hasOwnProperty.call(KIND_SCHEMAS, kind);
}

export type TitleProps = z.output<typeof TitlePropsSchema>;
export type BehindSubjectTextProps = z.output<typeof BehindSubjectTextPropsSchema>;
export type ImageProps = z.output<typeof ImagePropsSchema>;
export type HudPanelProps = z.output<typeof HudPanelPropsSchema>;
export type HudStatProps = z.output<typeof HudStatPropsSchema>;
export type LottieProps = z.output<typeof LottiePropsSchema>;
export type CameraZoomProps = z.output<typeof CameraZoomPropsSchema>;
export type SfxProps = z.output<typeof SfxPropsSchema>;
