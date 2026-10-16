import { msToFrame } from "./time";
import type { Anchor, Project } from "./schema/project";
import { StyleSchema, type Style } from "./schema/style";
import { layoutStory, wordOutput, type ClipLayout } from "./layout";
import { indexWords, type WordRef } from "./words";
import { deepMerge, type Plain } from "./merge";

export class ResolveError extends Error {}

export interface ResolveContext {
  project: Project;
  style: Style;
  fps: number;
  clips: ClipLayout[];
  totalMs: number;
  words: Map<string, WordRef>;
  orphans: string[];
  warnings: string[];
  frame: (ms: number) => number;
  place: (slot: string, position?: { x: number; y: number }) => { x: number; y: number };
  wordOut: (id: string) => { startMs: number; endMs: number } | null;
}

export function mergeStyle(style: Style, overrides: Plain): Style {
  if (Object.keys(overrides).length === 0) return style;
  const r = StyleSchema.safeParse(deepMerge(style as unknown as Plain, overrides));
  if (!r.success) {
    throw new ResolveError(`style overrides are invalid: ${r.error.issues.map((i) => i.message).join("; ")}`);
  }
  return r.data;
}

export function createContext(project: Project, style: Style): ResolveContext {
  const fps = project.canvas.fps;
  const { clips, totalMs } = layoutStory(project);
  const words = indexWords(project);
  const warnings: string[] = [];
  const slots = style.slots[project.canvas.format];
  return {
    project,
    style,
    fps,
    clips,
    totalMs,
    words,
    orphans: [],
    warnings,
    frame: (ms) => msToFrame(ms, fps),
    place: (slot, position) => {
      if (position) return position;
      const p = slots[slot];
      if (p) return p;
      warnings.push(`unknown slot "${slot}", placed at the center`);
      return { x: 0.5, y: 0.5 };
    },
    wordOut: (id) => {
      const w = words.get(id);
      if (!w) throw new ResolveError(`unknown word "${id}"`);
      return wordOutput(clips, w);
    },
  };
}

export function anchorMs(ctx: ResolveContext, anchor: Anchor): number | null {
  if ("atMs" in anchor) return anchor.atMs;
  const out = ctx.wordOut(anchor.word);
  return out === null ? null : out.startMs + anchor.offsetMs;
}
