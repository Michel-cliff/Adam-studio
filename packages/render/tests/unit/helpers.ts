import { parseProject, parseStyle, resolve, type ProjectInput, type StyleInput, type Timeline } from "@adam-studio/model";

export const styleInput: StyleInput = {
  name: "Test",
  fonts: { caption: { family: "Caption", file: "caption.ttf" }, title: { family: "Title", file: "title.ttf" } },
  colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" },
  caption: { size: 0.052 },
  slots: {
    "9:16": { caption: { x: 0.5, y: 0.76 }, title: { x: 0.5, y: 0.3 }, center: { x: 0.5, y: 0.5 } },
    "16:9": { caption: { x: 0.5, y: 0.86 }, title: { x: 0.5, y: 0.22 }, center: { x: 0.5, y: 0.5 } },
  },
  lint: {
    "9:16": { minDurationMs: 0, maxDurationMs: 60000 },
    "16:9": { minDurationMs: 0, maxDurationMs: 1200000 },
  },
};

/** 4 s synthetic take "s"; c1 [0,2000] slides out (600 ms) into c2 [2000,4000]. */
export function projectInput(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    version: 1,
    name: "synthetic",
    canvas: { format: "9:16", fps: 30 },
    style: "style.json",
    assets: [
      { id: "s", kind: "video", path: "cache/s/edit.mp4", meta: { durationMs: 4000, width: 1080, height: 1920, hasAudio: true } },
      { id: "m", kind: "image", path: "assets-src/magenta.png" },
      { id: "b", kind: "audio", path: "assets-src/beep.wav" },
    ],
    transcript: {
      lang: "fr",
      words: {
        s: [
          { id: "s.w0", text: "red", startMs: 200, endMs: 600 },
          { id: "s.w1", text: "blue", startMs: 1000, endMs: 1400 },
          { id: "s.w2", text: "green", startMs: 2200, endMs: 2600 },
          { id: "s.w3", text: "gray", startMs: 3000, endMs: 3400 },
        ],
      },
    },
    story: [
      { id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: { kind: "subjectSlide", durationMs: 600 } },
      { id: "c2", asset: "s", inMs: 2000, outMs: 4000 },
    ],
    elements: [
      { id: "behind", kind: "image", layer: "behind-subject", anchor: { atMs: 300 }, durationMs: 600, props: { asset: "m" } },
      { id: "beep", kind: "sfx", anchor: { word: "s.w1" }, durationMs: 300, props: { asset: "b", volume: 0.5 } },
    ],
    captions: [{ words: ["s.w0", "s.w1"], text: "red blue", highlight: ["blue"] }],
    ...over,
  };
}

export function timelineOf(over: Partial<ProjectInput> = {}): Timeline {
  const p = parseProject(projectInput(over));
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  const s = parseStyle(styleInput);
  if (!s.ok) throw new Error(JSON.stringify(s.errors));
  return resolve(p.value, s.value);
}
