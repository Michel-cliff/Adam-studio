import { parseProject, parseStyle } from "../src/parse";
import type { Project, ProjectInput } from "../src/schema/project";
import type { Style, StyleInput } from "../src/schema/style";

export const NUMBERS = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];

/** Word i starts at startMs + i * stepMs and lasts lenMs: by default w0 = 1000-1500, w5 = 5000-5500, w9 = 8200-8700. */
export function words(asset: string, texts: string[], startMs = 1000, stepMs = 800, lenMs = 500) {
  return texts.map((text, i) => ({
    id: `${asset}.w${i}`,
    text,
    startMs: startMs + i * stepMs,
    endMs: startMs + i * stepMs + lenMs,
  }));
}

export function projectInput(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    version: 1,
    name: "test",
    canvas: { format: "9:16", fps: 30 },
    style: "style.json",
    assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 30000, hasAudio: true } }],
    transcript: { lang: "fr", words: { a: words("a", NUMBERS) } },
    story: [{ id: "c1", asset: "a", inMs: 0, outMs: 10000 }],
    ...over,
  };
}

export function makeProject(over: Partial<ProjectInput> = {}): Project {
  const r = parseProject(projectInput(over));
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 1));
  return r.value;
}

export const styleInput: StyleInput = {
  name: "Test",
  fonts: {
    caption: { family: "Indivisible", file: "indivisible.ttf", capcutResourceId: "7181740482383319553" },
    title: { family: "Segoe UI Black", file: "seguibl.ttf" },
  },
  colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" },
  grade: {},
  caption: { size: 0.052 },
  slots: {
    "9:16": { caption: { x: 0.5, y: 0.76 }, title: { x: 0.5, y: 0.3 }, center: { x: 0.5, y: 0.5 } },
    "16:9": { caption: { x: 0.5, y: 0.86 }, title: { x: 0.5, y: 0.22 }, center: { x: 0.5, y: 0.5 } },
  },
  lint: {
    "9:16": { minDurationMs: 15000, maxDurationMs: 60000 },
    "16:9": { minDurationMs: 30000, maxDurationMs: 1200000 },
  },
};

export function makeStyle(over: Partial<StyleInput> = {}): Style {
  const r = parseStyle({ ...styleInput, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 1));
  return r.value;
}
