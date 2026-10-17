import { z } from "zod";
import { AssetSchema, ElementSchema, type Anchor, type Element, type Project, type Word } from "./schema/project";

/** An element without its anchor: the treatment places it, offsetMs shifts it from that point. */
const TemplateSchema = z.record(z.string(), z.unknown()).superRefine((t, ctx) => {
  const { offsetMs, ...rest } = t;
  if (offsetMs !== undefined && typeof offsetMs !== "number") ctx.addIssue({ code: "custom", message: "offsetMs must be a number", path: ["offsetMs"] });
  const r = ElementSchema.safeParse({ ...rest, anchor: { atMs: 0 } });
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", message: i.message, path: i.path });
});

export const SeriesSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  /** Relative to the series folder, or absolute. */
  style: z.string().min(1),
  assets: z.array(AssetSchema).default([]),
  vars: z.record(z.string(), z.string()).default({}),
  treatments: z
    .strictObject({
      start: z.array(TemplateSchema).default([]),
      transition: z.array(TemplateSchema).default([]),
      beat: z.array(TemplateSchema).default([]),
      end: z.array(TemplateSchema).default([]),
    })
    .default({ start: [], transition: [], beat: [], end: [] }),
});

export type Series = z.output<typeof SeriesSchema>;
export type SeriesInput = z.input<typeof SeriesSchema>;
export const SERIES_PREFIX = "series.";

export function parseSeries(input: unknown): { ok: true; value: Series } | { ok: false; errors: { path: string; message: string }[] } {
  const r = SeriesSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

const isAbsolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p) || p.startsWith("%");
const inDir = (dir: string, p: string) => (isAbsolute(p) ? p : `${dir.replace(/[\\/]+$/, "")}/${p}`);

function fill(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, k: string) => vars[k] ?? whole);
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

/**
 * Points the project at the series style, adds the series assets and (re)generates the treatment elements:
 * start (at 0), transition (at each story clip after the first), beat (at each structure beat), end. Points
 * inside the story are word anchors, so the elements follow later cuts. Elements from an earlier application
 * (ids starting with "series.") are replaced; the project's own elements are kept.
 */
export function applySeries(project: Project, series: Series, seriesDir: string): Project {
  const words = (asset: string): Word[] => [...(project.transcript.words[asset] ?? [])].sort((a, b) => a.startMs - b.startMs);
  const wordText = new Map(Object.values(project.transcript.words).flat().map((w) => [w.id, w.text]));
  const base = { ...series.vars, "project.name": project.name, "series.name": series.name };
  const out: Element[] = [];
  const place = (treatment: string, i: number, at: Anchor | null, vars: Record<string, string>) => {
    if (!at) return;
    for (const tpl of series.treatments[treatment as keyof Series["treatments"]]) {
      const { offsetMs, ...rest } = fill(tpl, { ...base, ...vars }) as Record<string, unknown>;
      const shift = typeof offsetMs === "number" ? offsetMs : 0;
      const anchor: Anchor = "word" in at ? { word: at.word, offsetMs: at.offsetMs + shift } : { atMs: Math.max(0, at.atMs + shift) };
      out.push(ElementSchema.parse({ ...rest, id: `${SERIES_PREFIX}${treatment}.${i}.${String(rest.id)}`, anchor }));
    }
  };
  /** The start of a story clip as a word anchor: its first word, shifted back to the clip's in point. */
  const clipStart = (c: Project["story"][number]): Anchor | null => {
    const w = words(c.asset).find((x) => x.startMs >= c.inMs && x.startMs < c.outMs);
    return w ? { word: w.id, offsetMs: c.inMs - w.startMs } : null;
  };
  const last = project.story.at(-1);
  const lastWord = last ? words(last.asset).filter((x) => x.startMs >= last.inMs && x.startMs < last.outMs).at(-1) : undefined;

  place("start", 0, { atMs: 0 }, {});
  project.story.slice(1).forEach((c, i) => place("transition", i, clipStart(c), { "clip.id": c.id }));
  (project.structure?.beats ?? []).forEach((b, i) => place("beat", i, { word: b.from, offsetMs: 0 }, { "beat.role": b.role, "beat.word": wordText.get(b.from) ?? "" }));
  if (last && lastWord) place("end", 0, { word: lastWord.id, offsetMs: last.outMs - lastWord.startMs }, {});

  const seriesAssets = series.assets.map((a) => ({ ...a, path: inDir(seriesDir, a.path) }));
  const ids = new Set(seriesAssets.map((a) => a.id));
  return {
    ...project,
    style: inDir(seriesDir, series.style),
    assets: [...project.assets.filter((a) => !ids.has(a.id)), ...seriesAssets],
    elements: [...project.elements.filter((e) => !e.id.startsWith(SERIES_PREFIX)), ...out],
  };
}
