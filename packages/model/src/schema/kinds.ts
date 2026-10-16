import { z } from "zod";

const Ms = z.number().int().nonnegative();

export const TitlePropsSchema = z.object({
  kicker: z.string().optional(),
  phases: z
    .array(
      z
        .object({
          startMs: Ms,
          endMs: Ms,
          lines: z
            .array(z.object({ text: z.string().min(1), box: z.boolean().default(false), sizeScale: z.number().positive().default(1) }))
            .min(1),
        })
        .refine((p) => p.endMs > p.startMs, { message: "endMs must be greater than startMs", path: ["endMs"] }),
    )
    .min(1),
});

export const BehindSubjectTextPropsSchema = z.object({
  text: z.string().min(1),
  color: z.string().default("accent"),
  sizeScale: z.number().positive().default(1),
});

export const ImagePropsSchema = z.object({
  asset: z.string().min(1),
  fit: z.enum(["full", "contain", "cover"]).default("full"),
  intro: z.string().optional(),
  outro: z.string().optional(),
});

export const SfxPropsSchema = z.object({
  asset: z.string().min(1),
  volume: z.number().min(0).default(1),
  fadeInMs: Ms.default(0),
  fadeOutMs: Ms.default(0),
});

export const KIND_SCHEMAS = {
  title: TitlePropsSchema,
  "text.behindSubject": BehindSubjectTextPropsSchema,
  image: ImagePropsSchema,
  sfx: SfxPropsSchema,
} as const;

export type KindName = keyof typeof KIND_SCHEMAS;
export const KIND_NAMES = Object.keys(KIND_SCHEMAS) as KindName[];
/** Kinds whose props.asset must name an asset of the project. */
export const ASSET_PROP_KINDS: ReadonlySet<string> = new Set(["image", "sfx"]);

export function isKind(kind: string): kind is KindName {
  return Object.prototype.hasOwnProperty.call(KIND_SCHEMAS, kind);
}

export type TitleProps = z.output<typeof TitlePropsSchema>;
export type BehindSubjectTextProps = z.output<typeof BehindSubjectTextPropsSchema>;
export type ImageProps = z.output<typeof ImagePropsSchema>;
export type SfxProps = z.output<typeof SfxPropsSchema>;
