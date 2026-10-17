import type { RenderProps } from "./props";

const lintRules = { minDurationMs: 0, maxDurationMs: 60000, maxPauseMs: 350 };

/** Default props so the composition can be listed before a project is loaded. */
export const EMPTY_PROPS: RenderProps = {
  timeline: {
    format: "9:16", width: 1080, height: 1920, fps: 30, durationFrames: 1,
    clips: [], elements: [], captions: [], beats: [], audio: [], orphans: [], warnings: [],
    style: {
      name: "empty",
      fonts: { caption: { family: "sans-serif", file: "none" }, title: { family: "sans-serif", file: "none" } },
      colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" },
      motion: { speed: 1 },
    fillers: {},
    grade: { warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 },
      caption: { size: 0.05, stroke: 0.08, shadow: true, maxCharsPerLine: 22, intro: "miniZoom" },
      slots: { "9:16": {}, "16:9": {} },
      lint: { "9:16": lintRules, "16:9": lintRules },
    },
  },
  media: {},
  fonts: { caption: "", title: "" },
};
