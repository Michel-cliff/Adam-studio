import { z } from "zod";
import { FormatSchema } from "./project";

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected a #RRGGBB color");
const Signed = z.number().min(-1).max(1);
const Point = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const FR_FILLERS = ["euh", "heu", "bah", "ben", "du coup", "en fait"];

export const FontSchema = z.strictObject({
  family: z.string().min(1),
  file: z.string().min(1),
  capcutResourceId: z.string().optional(),
});

export const StyleSchema = z.strictObject({
  name: z.string().min(1),
  fonts: z.strictObject({ caption: FontSchema, title: FontSchema }),
  colors: z.strictObject({ text: Hex, highlight: Hex, accent: Hex, ink: Hex }),
  grade: z
    .strictObject({
      warmth: Signed.default(0),
      contrast: Signed.default(0),
      saturation: Signed.default(0),
      brightness: Signed.default(0),
      vignette: z.number().min(0).max(1).default(0),
    })
    .default({ warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 }),
  caption: z.strictObject({
    size: z.number().positive(),
    stroke: z.number().min(0).default(0.08),
    shadow: z.boolean().default(true),
    maxCharsPerLine: z.number().int().positive().default(22),
    intro: z.string().default("miniZoom"),
  }),
  slots: z.record(FormatSchema, z.record(z.string(), Point)),
  lint: z.record(
    FormatSchema,
    z.strictObject({
      minDurationMs: z.number().int().nonnegative(),
      maxDurationMs: z.number().int().positive(),
      maxPauseMs: z.number().int().positive().default(350),
      fillers: z.array(z.string()).default(FR_FILLERS),
    }),
  ),
});

export type Style = z.output<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;
