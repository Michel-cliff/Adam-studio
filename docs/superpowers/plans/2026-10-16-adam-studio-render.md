# Adam Studio Renderer Implementation Plan (sub-project 1, plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@adam-studio/render`: a Remotion composition that turns a resolved timeline into video (preview equals export), plus the `adam` CLI commands `render`, `review`, `decide` and `studio`.

**Architecture:** Pure helpers (framing, grade, subject and slide windows, text, audio, presets) are unit-tested without a browser. `planMedia` decides which files a timeline needs and `prepareMedia` hard-links them into `<project>/renders/.public`, which Remotion bundles as its public dir and the components read with `staticFile()`. The composition stacks: graded clips (plate during person-only slides), behind-subject elements, the graded transparent subject video, vignette, front elements, captions, audio. A synthetic project generated with ffmpeg drives pixel-probe end-to-end tests. The CLI wires `parseProject`, `resolve`, `lint`, `decide` from `@adam-studio/model` to Remotion's `bundle`, `renderMedia` and `renderStill`.

**Tech Stack:** Node 24, TypeScript 7, React 19.3.1, Remotion 4.0.536 (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/cli`, `@remotion/fonts`), vitest 5, pngjs 7, ffmpeg on PATH.

**Spec:** `docs/superpowers/specs/2026-10-16-adam-studio-core-design.md` (sections 8, 9, 12, 14.5; decision `docs/decisions/0001-capcut-alpha-video.md` only matters for plan 3).

## Global Constraints

- All `remotion` and `@remotion/*` packages pinned to exactly `4.0.536`; `react` and `react-dom` `19.3.1`.
- Media trimming uses `trimBefore` (source frames) on `OffthreadVideo` and `Html5Audio`; never the deprecated `startFrom`.
- Components read files only through `staticFile(path)` where `path` is relative to the render public dir `<projectDir>/renders/.public`; `prepareMedia` fills it with hard links (copy fallback).
- Composition id `AdamEdit`; input props `{ timeline, media, fonts }` (JSON only).
- Components import `@adam-studio/model` types with `import type`; runtime imports from the model are limited to pure helpers (`msToFrame`).
- A person-only slide splits the clip's `transitionOut.durationMs` into 40% slide-out at the end of the clip and 60% slide-in at the start of the next clip; slide distance is 1.1 x canvas width.
- Crop keyframe `atMs` is source (asset) time, consistent with `cutWords` copying keyframes to both pieces; the crop rect is normalized to the source frame (source size from the asset's `meta.width`/`meta.height`, canvas shape assumed when unknown).
- A crossfade keeps the story magnetic: the incoming clip's lead-in (its source just before the in point) fades in over the last frames of the outgoing clip; audio stays cut at the boundary.
- `adam studio` previews from `cache/<id>/proxy.mp4` when present; `adam render` and `adam review` always read `edit.mp4`.
- Unit tests: `npm test -w @adam-studio/render` (fast, no browser). End-to-end: `npm run test:e2e -w @adam-studio/render` (bundles and renders; minutes).
- Docs and messages use no em dash characters. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A project folder whose path contains spaces (Windows `User Data`, `C:\Users\...\My Projects`): every file path goes through spawn argument arrays or `staticFile` names without spaces (Task 6 end-to-end fixture lives in a temp dir with a space in its name).
- A 16:9 screen recording cropped in a 9:16 project: the crop rect is read in the source frame, not in the canvas-shaped center of it (Task 1 `cropBox` landscape test; Task 5 passes the source size from the asset's `meta`).
- Missing `subject.webm` or `plate.png` when a behind-subject element or a slide needs it: `MediaError` names the file and the analysis step, before any bundling (Task 5 test).
- Accented and punctuated text (`é`, `'`, `:`) in captions and in review labels: rendered, and labels sanitized for ffmpeg `drawtext` (Task 8 `sheetLabel` test).
- A cuts-step proposal whose variants change timing: each variant's review window is computed from its own applied project (Task 8 `reviewWindow` test).

---

### Task 1: Render package and framing math

**Files:**
- Create: `packages/render/package.json`, `packages/render/tsconfig.json`
- Create: `packages/render/src/props.ts`, `packages/render/src/lib/framing.ts`
- Modify: `package.json` (root scripts)
- Test: `packages/render/tests/unit/framing.test.ts`

**Interfaces:**
- Consumes: `Framing`, `Zoom`, `Timeline` types from `@adam-studio/model`.
- Produces: `src/props.ts`: `type MediaFiles = { video?; subject?; plate?; file?; width?; height? }` (width and height: the source's pixel size, when known), `type RenderProps = { timeline: Timeline; media: Record<string, MediaFiles>; fonts: { caption: string; title: string } }`, `COMPOSITION_ID = "AdamEdit"`, `CAPTION_FONT = "AdamCaption"`, `TITLE_FONT = "AdamTitle"`. `src/lib/framing.ts`: `type Rect`, `type Size = { width; height }`, `type Box = { left; top; width; height }`, `zoomAt(zoom, elapsedMs)`, `cropRectAt(framing, sourceMs)`, `cropBox(rect, source: Size, canvas: Size): Box`.

- [ ] **Step 1: Create the package files**

`packages/render/package.json`:
```json
{
  "name": "@adam-studio/render",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run tests/unit",
    "test:e2e": "vitest run tests/e2e --testTimeout=900000 --hookTimeout=900000",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@adam-studio/model": "0.1.0",
    "@remotion/bundler": "4.0.536",
    "@remotion/cli": "4.0.536",
    "@remotion/fonts": "4.0.536",
    "@remotion/renderer": "4.0.536",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "remotion": "4.0.536",
    "tsx": "^4.23.15"
  },
  "devDependencies": {
    "@types/node": "^26.6.5",
    "@types/pngjs": "^6.0.5",
    "@types/react": "^19.3.0",
    "pngjs": "^7.0.0",
    "typescript": "^7.0.2",
    "vitest": "^5.0.5"
  }
}
```

`packages/render/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM"], "types": ["node"] },
  "include": ["src", "tests"]
}
```

In the root `package.json`, replace the `"scripts"` object with:
```json
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "adam": "tsx packages/render/src/cli.ts"
  }
```

`packages/render/src/props.ts`:
```ts
import type { Timeline } from "@adam-studio/model";

/**
 * Files of one asset, as paths relative to the render public dir (passed to staticFile()),
 * plus the source's pixel size when the project knows it (crop rects are relative to the source frame).
 */
export type MediaFiles = { video?: string; subject?: string; plate?: string; file?: string; width?: number; height?: number };

export type RenderProps = {
  timeline: Timeline;
  media: Record<string, MediaFiles>;
  fonts: { caption: string; title: string };
};

export const COMPOSITION_ID = "AdamEdit";
export const CAPTION_FONT = "AdamCaption";
export const TITLE_FONT = "AdamTitle";
```

- [ ] **Step 2: Install**

Run: `npm install` (repo root)
Expected: exit code 0; `node_modules/remotion/package.json` has `"version": "4.0.536"`.

- [ ] **Step 3: Write the failing test**

`packages/render/tests/unit/framing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cropBox, cropRectAt, zoomAt } from "../../src/lib/framing";

const crop = (keyframes: { atMs: number; rect: { x: number; y: number; w: number; h: number } }[] = []) => ({
  mode: "crop" as const,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  keyframes,
});

describe("zoomAt", () => {
  it("adds the drift per second to the base zoom", () => {
    expect(zoomAt({ base: 1.08, driftPerSec: 0.004 }, 2500)).toBeCloseTo(1.09, 6);
  });
});

describe("cropRectAt", () => {
  it("returns the base rect without keyframes", () => {
    expect(cropRectAt(crop(), 5000)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it("interpolates linearly in source time and holds after the last keyframe", () => {
    const f = crop([{ atMs: 1000, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }]);
    expect(cropRectAt(f, 500)).toEqual({ x: 0.125, y: 0.125, w: 0.75, h: 0.75 });
    expect(cropRectAt(f, 2000)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });
});

describe("cropBox", () => {
  const portrait = { width: 1080, height: 1920 };
  it("fills the canvas with the full frame of a same-shaped source", () => {
    expect(cropBox({ x: 0, y: 0, w: 1, h: 1 }, portrait, portrait)).toEqual({ left: 0, top: 0, width: 1080, height: 1920 });
  });
  it("scales and centers a rect so it covers the canvas", () => {
    expect(cropBox({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, portrait, portrait)).toEqual({ left: -540, top: -960, width: 2160, height: 3840 });
  });
  it("reads the rect in the source frame when the source is landscape", () => {
    // Right part of a 16:9 screen recording (480x1080 px) shown in a 9:16 canvas: scale 2.25, the rect's center lands mid-canvas.
    expect(cropBox({ x: 0.5, y: 0, w: 0.25, h: 1 }, { width: 1920, height: 1080 }, portrait)).toEqual({ left: -2160, top: -255, width: 4320, height: 2430 });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/framing`.

- [ ] **Step 5: Implement**

`packages/render/src/lib/framing.ts`:
```ts
import type { Framing, Zoom } from "@adam-studio/model";

export type Rect = { x: number; y: number; w: number; h: number };
type CropFraming = Extract<Framing, { mode: "crop" }>;

export function zoomAt(zoom: Zoom, elapsedMs: number): number {
  return zoom.base + zoom.driftPerSec * (elapsedMs / 1000);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Crop rect at a source (asset) time: `rect` is the value at time 0, keyframes are source times, linear in between, held after the last. */
export function cropRectAt(framing: CropFraming, sourceMs: number): Rect {
  const points = [{ atMs: 0, rect: framing.rect }, ...framing.keyframes].sort((a, b) => a.atMs - b.atMs);
  let prev = points[0]!;
  for (const p of points.slice(1)) {
    if (sourceMs < p.atMs) {
      const t = Math.min(1, Math.max(0, (sourceMs - prev.atMs) / Math.max(1, p.atMs - prev.atMs)));
      return {
        x: lerp(prev.rect.x, p.rect.x, t),
        y: lerp(prev.rect.y, p.rect.y, t),
        w: lerp(prev.rect.w, p.rect.w, t),
        h: lerp(prev.rect.h, p.rect.h, t),
      };
    }
    prev = p;
  }
  return prev.rect;
}

export type Size = { width: number; height: number };
export type Box = { left: number; top: number; width: number; height: number };

/**
 * Where to draw the whole source (canvas pixels, no aspect distortion) so that `rect`, normalized to the
 * source frame, covers the canvas and is centered on it.
 */
export function cropBox(rect: Rect, source: Size, canvas: Size): Box {
  const scale = Math.max(canvas.width / (rect.w * source.width), canvas.height / (rect.h * source.height));
  const cx = (rect.x + rect.w / 2) * source.width * scale;
  const cy = (rect.y + rect.h / 2) * source.height * scale;
  return { left: canvas.width / 2 - cx, top: canvas.height / 2 - cy, width: source.width * scale, height: source.height * scale };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: 6 tests PASS; typecheck exit code 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json packages/render
git commit -m "feat(render): package scaffold, render props and framing math

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Grade, vignette and audio levels

**Files:**
- Create: `packages/render/src/lib/grade.ts`, `packages/render/src/lib/audio.ts`
- Test: `packages/render/tests/unit/grade.test.ts`

**Interfaces:**
- Consumes: `Style`, `TimelineAudio` types from `@adam-studio/model`.
- Produces: `GRADE_FILTER_ID = "adam-grade"`, `warmthMatrix(warmth): number[]`, `gradeFilter(grade, svgId): string`, `vignetteBackground(amount): string`; `audioVolume(item, frame, fps): number`.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/unit/grade.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { audioVolume } from "../../src/lib/audio";
import { gradeFilter, vignetteBackground, warmthMatrix } from "../../src/lib/grade";

const neutral = { warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 };

describe("gradeFilter", () => {
  it("is none for a neutral grade", () => {
    expect(gradeFilter(neutral, "g")).toBe("none");
  });
  it("chains warmth, contrast, saturation and brightness", () => {
    expect(gradeFilter({ ...neutral, warmth: 0.35, contrast: 0.1, saturation: 0.12, brightness: -0.02 }, "g"))
      .toBe("url(#g) contrast(1.1) saturate(1.12) brightness(0.98)");
  });
});

describe("warmthMatrix", () => {
  it("is the identity at 0", () => {
    expect(warmthMatrix(0)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  });
  it("boosts red and cuts blue when warm", () => {
    const m = warmthMatrix(1);
    expect(m[0]).toBeCloseTo(1.12, 6);
    expect(m[6]).toBeCloseTo(1.02, 6);
    expect(m[12]).toBeCloseTo(0.86, 6);
  });
});

describe("vignetteBackground", () => {
  it("is none at 0 and a radial gradient otherwise", () => {
    expect(vignetteBackground(0)).toBe("none");
    expect(vignetteBackground(0.5)).toBe("radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.325) 100%)");
  });
});

describe("audioVolume", () => {
  const item = { id: "s", asset: "b", fromFrame: 0, durationFrames: 30, sourceInMs: 0, volume: 0.5, fadeInMs: 200, fadeOutMs: 200 };
  it("ramps in and out", () => {
    expect(audioVolume(item, 0, 30)).toBe(0);
    expect(audioVolume(item, 3, 30)).toBeCloseTo(0.25, 6);
    expect(audioVolume(item, 15, 30)).toBe(0.5);
    expect(audioVolume(item, 27, 30)).toBeCloseTo(0.25, 6);
  });
  it("never exceeds 1", () => {
    expect(audioVolume({ ...item, volume: 3, fadeInMs: 0, fadeOutMs: 0 }, 10, 30)).toBe(1);
  });
});
```

Expected values: frame 3 at 30 fps is 100 ms, half of the 200 ms fade in. Frame 27 is 900 ms, 100 ms before the 1000 ms end.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/audio`.

- [ ] **Step 3: Implement**

`packages/render/src/lib/grade.ts`:
```ts
import type { Style } from "@adam-studio/model";

type Grade = Style["grade"];

export const GRADE_FILTER_ID = "adam-grade";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** feColorMatrix values: warm boosts red, slightly green, and cuts blue. */
export function warmthMatrix(warmth: number): number[] {
  const r = 1 + 0.12 * warmth;
  const g = 1 + 0.02 * warmth;
  const b = 1 - 0.14 * warmth;
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/** CSS filter for the grade; warmth goes through the SVG filter `svgId`. */
export function gradeFilter(grade: Grade, svgId: string): string {
  const parts: string[] = [];
  if (grade.warmth !== 0) parts.push(`url(#${svgId})`);
  if (grade.contrast !== 0) parts.push(`contrast(${round(1 + grade.contrast)})`);
  if (grade.saturation !== 0) parts.push(`saturate(${round(1 + grade.saturation)})`);
  if (grade.brightness !== 0) parts.push(`brightness(${round(1 + grade.brightness)})`);
  return parts.length ? parts.join(" ") : "none";
}

export function vignetteBackground(amount: number): string {
  if (amount <= 0) return "none";
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${round(0.65 * amount)}) 100%)`;
}
```

`packages/render/src/lib/audio.ts`:
```ts
import type { TimelineAudio } from "@adam-studio/model";

/** Volume at `frame` (relative to the item start), with linear fades, capped at 1 for HTML5 audio. */
export function audioVolume(item: TimelineAudio, frame: number, fps: number): number {
  const ms = (frame * 1000) / fps;
  const totalMs = (item.durationFrames * 1000) / fps;
  let v = item.volume;
  if (item.fadeInMs > 0) v *= Math.min(1, ms / item.fadeInMs);
  if (item.fadeOutMs > 0) v *= Math.min(1, Math.max(0, totalMs - ms) / item.fadeOutMs);
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): grade filter, vignette and audio fades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Subject windows, person-only slides and crossfades

**Files:**
- Create: `packages/render/src/lib/subject.ts`, `packages/render/src/lib/crossfade.ts`
- Create: `packages/render/tests/unit/helpers.ts`
- Test: `packages/render/tests/unit/subject.test.ts`, `packages/render/tests/unit/crossfade.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `msToFrame` from `@adam-studio/model`; for tests `parseProject`, `parseStyle`, `resolve`.
- Produces: `SLIDE_OUT_SHARE = 0.4`, `type SlideWindow = { clipId; kind: "out" | "in"; fromFrame; toFrame }`, `type SubjectWindow = { clipId; asset; fromFrame; toFrame }` (half-open), `slideWindows(timeline)`, `subjectWindows(timeline)`, `slideOffset(window, frame, width): { dx; blurPx }`. `src/lib/crossfade.ts`: `type CrossfadeWindow = { clipId; fromFrame; toFrame }` (clipId: the incoming clip; the window covers the last frames of the outgoing one), `crossfadeWindows(timeline)`, `crossfadeOpacity(window, frame)`. Test helpers: `styleInput`, `projectInput(over?)`, `timelineOf(over?)`.

- [ ] **Step 1: Write the test helpers**

`packages/render/tests/unit/helpers.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing test**

`packages/render/tests/unit/subject.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { slideOffset, slideWindows, subjectWindows } from "../../src/lib/subject";
import { timelineOf } from "./helpers";

describe("slideWindows", () => {
  it("splits the slide 40/60 between the end of a clip and the start of the next", () => {
    expect(slideWindows(timelineOf())).toEqual([
      { clipId: "c1", kind: "out", fromFrame: 53, toFrame: 60 },
      { clipId: "c2", kind: "in", fromFrame: 60, toFrame: 71 },
    ]);
  });
  it("has no window without a subjectSlide", () => {
    expect(slideWindows(timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 4000 }] }))).toEqual([]);
  });
});

describe("subjectWindows", () => {
  it("covers behind-subject elements and slides, per clip", () => {
    expect(subjectWindows(timelineOf())).toEqual([
      { clipId: "c1", asset: "s", fromFrame: 9, toFrame: 27 },
      { clipId: "c1", asset: "s", fromFrame: 53, toFrame: 60 },
      { clipId: "c2", asset: "s", fromFrame: 60, toFrame: 71 },
    ]);
  });
  it("merges overlapping windows", () => {
    const tl = timelineOf({
      elements: [{ id: "late", kind: "image", layer: "behind-subject", anchor: { atMs: 1700 }, durationMs: 200, props: { asset: "m" } }],
    });
    expect(subjectWindows(tl).filter((w) => w.clipId === "c1")).toEqual([{ clipId: "c1", asset: "s", fromFrame: 51, toFrame: 60 }]);
  });
});

describe("slideOffset", () => {
  const out = { clipId: "c1", kind: "out" as const, fromFrame: 53, toFrame: 60 };
  const into = { clipId: "c2", kind: "in" as const, fromFrame: 60, toFrame: 71 };
  it("leaves the frame completely at the end of the slide-out", () => {
    expect(slideOffset(out, 59, 1080).dx).toBeCloseTo(-1188, 6);
  });
  it("starts the slide-in outside the frame on the right and lands near 0", () => {
    expect(slideOffset(into, 60, 1080).dx).toBeCloseTo(1188, 6);
    expect(slideOffset(into, 70, 1080).dx).toBeCloseTo(1188 / 1331, 6);
  });
  it("blurs in proportion to speed, capped at 90 px", () => {
    expect(slideOffset(out, 59, 1080).blurPx).toBe(90);
    expect(slideOffset(into, 70, 1080).blurPx).toBeCloseTo(0.55 * 1188 * 3 * (1 / 121) / 11, 6);
  });
});
```

Expected values: 600 ms at 30 fps is 18 frames, 40% rounds to 7 (slide-out frames 53 to 59), 11 frames of slide-in (60 to 70). The behind element runs 300 to 900 ms, frames 9 to 27. The late element runs 1700 to 1900 ms (frames 51 to 57) and merges with the slide-out window into 51 to 60. Distance 1.1 x 1080 = 1188.

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/subject`.

- [ ] **Step 4: Implement**

`packages/render/src/lib/subject.ts`:
```ts
import { msToFrame, type Timeline } from "@adam-studio/model";

export const SLIDE_OUT_SHARE = 0.4;
const SLIDE_DISTANCE = 1.1; // x canvas width
const MAX_BLUR_PX = 90;

export type SlideWindow = { clipId: string; kind: "out" | "in"; fromFrame: number; toFrame: number };
export type SubjectWindow = { clipId: string; asset: string; fromFrame: number; toFrame: number };

/** Person-only slide windows: the end of a clip with transitionOut subjectSlide, then the start of the next clip. */
export function slideWindows(timeline: Timeline): SlideWindow[] {
  const out: SlideWindow[] = [];
  timeline.clips.forEach((c, i) => {
    if (c.transitionOut.kind !== "subjectSlide") return;
    const total = msToFrame(c.transitionOut.durationMs, timeline.fps);
    const outFrames = Math.min(c.durationFrames, Math.round(total * SLIDE_OUT_SHARE));
    const end = c.fromFrame + c.durationFrames;
    out.push({ clipId: c.id, kind: "out", fromFrame: end - outFrames, toFrame: end });
    const next = timeline.clips[i + 1];
    if (next) {
      const inFrames = Math.min(next.durationFrames, total - outFrames);
      out.push({ clipId: next.id, kind: "in", fromFrame: next.fromFrame, toFrame: next.fromFrame + inFrames });
    }
  });
  return out.filter((w) => w.toFrame > w.fromFrame);
}

/** Frames where the transparent subject must be drawn on top: behind-subject elements and slides, merged per clip. */
export function subjectWindows(timeline: Timeline): SubjectWindow[] {
  const slides = slideWindows(timeline);
  const behind = timeline.elements.filter((e) => e.layer === "behind-subject");
  const out: SubjectWindow[] = [];
  for (const c of timeline.clips) {
    const start = c.fromFrame;
    const end = c.fromFrame + c.durationFrames;
    const ranges: [number, number][] = [];
    for (const e of behind) {
      const a = Math.max(start, e.fromFrame);
      const b = Math.min(end, e.fromFrame + e.durationFrames);
      if (b > a) ranges.push([a, b]);
    }
    for (const s of slides) if (s.clipId === c.id) ranges.push([s.fromFrame, s.toFrame]);
    ranges.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    for (const [a, b] of merged) out.push({ clipId: c.id, asset: c.asset, fromFrame: a, toFrame: b });
  }
  return out;
}

/** Horizontal offset and directional blur of the subject during a slide, at an absolute frame. */
export function slideOffset(w: SlideWindow, frame: number, width: number): { dx: number; blurPx: number } {
  const n = w.toFrame - w.fromFrame;
  const dist = width * SLIDE_DISTANCE;
  if (w.kind === "out") {
    const p = Math.min(1, Math.max(0, (frame - w.fromFrame + 1) / n));
    const speed = (dist * 3 * p * p) / n;
    return { dx: -dist * p ** 3, blurPx: Math.min(MAX_BLUR_PX, 0.55 * speed) };
  }
  const p = Math.min(1, Math.max(0, (frame - w.fromFrame) / n));
  const speed = (dist * 3 * (1 - p) ** 2) / n;
  return { dx: dist * (1 - p) ** 3, blurPx: Math.min(MAX_BLUR_PX, 0.55 * speed) };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 6: Write the failing crossfade test**

A crossfade keeps the story magnetic: the incoming clip's lead-in (source frames just before its in point) is drawn over the last frames of the outgoing clip with rising opacity. Timing and audio stay cut at the boundary.

`packages/render/tests/unit/crossfade.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { crossfadeOpacity, crossfadeWindows } from "../../src/lib/crossfade";
import { timelineOf } from "./helpers";

const fade = { kind: "crossfade" as const, durationMs: 300 };

describe("crossfadeWindows", () => {
  it("lays the incoming clip's lead-in over the end of the outgoing clip", () => {
    const tl = timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: fade }, { id: "c2", asset: "s", inMs: 2000, outMs: 4000 }] });
    expect(crossfadeWindows(tl)).toEqual([{ clipId: "c2", fromFrame: 51, toFrame: 60 }]);
  });
  it("is limited by the source available before the incoming clip's in point", () => {
    const tl = timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: fade }, { id: "c2", asset: "s", inMs: 100, outMs: 4000 }] });
    expect(crossfadeWindows(tl)).toEqual([{ clipId: "c2", fromFrame: 57, toFrame: 60 }]);
  });
  it("has nothing to fade into after the last clip", () => {
    const tl = timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 4000, transitionOut: fade }] });
    expect(crossfadeWindows(tl)).toEqual([]);
  });
});

describe("crossfadeOpacity", () => {
  it("rises linearly and reaches 1 at the cut", () => {
    const w = { clipId: "c2", fromFrame: 51, toFrame: 60 };
    expect(crossfadeOpacity(w, 51)).toBeCloseTo(0.1, 6);
    expect(crossfadeOpacity(w, 59)).toBeCloseTo(0.9, 6);
    expect(crossfadeOpacity(w, 60)).toBe(1);
  });
});
```

Expected values: 300 ms at 30 fps is 9 frames before the cut at frame 60. With c2 starting at 100 ms in its source, only 3 frames of lead-in exist.

- [ ] **Step 7: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/crossfade`.

- [ ] **Step 8: Implement**

`packages/render/src/lib/crossfade.ts`:
```ts
import { msToFrame, type Timeline } from "@adam-studio/model";

/** Frames where the incoming clip `clipId` is drawn, ahead of its start, over the outgoing clip (half-open). */
export type CrossfadeWindow = { clipId: string; fromFrame: number; toFrame: number };

export function crossfadeWindows(timeline: Timeline): CrossfadeWindow[] {
  const out: CrossfadeWindow[] = [];
  timeline.clips.forEach((c, i) => {
    const next = timeline.clips[i + 1];
    if (c.transitionOut.kind !== "crossfade" || !next) return;
    // The lead-in reads the source before the next clip's in point: never more than exists.
    const leadIn = msToFrame(next.sourceInMs, timeline.fps);
    const n = Math.min(msToFrame(c.transitionOut.durationMs, timeline.fps), c.durationFrames, leadIn);
    if (n >= 1) out.push({ clipId: next.id, fromFrame: next.fromFrame - n, toFrame: next.fromFrame });
  });
  return out;
}

/** Opacity of the incoming clip at an absolute frame: linear, 1 from the cut on. */
export function crossfadeOpacity(w: CrossfadeWindow, frame: number): number {
  return Math.min(1, Math.max(0, (frame - w.fromFrame + 1) / (w.toFrame - w.fromFrame + 1)));
}
```

- [ ] **Step 9: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 10: Commit**

```bash
git add packages/render
git commit -m "feat(render): subject windows, person-only slide motion and crossfade windows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Text helpers and entrance presets

**Files:**
- Create: `packages/render/src/lib/text.ts`, `packages/render/src/lib/presets.ts`
- Test: `packages/render/tests/unit/text.test.ts`

**Interfaces:**
- Consumes: `Style` type from `@adam-studio/model`.
- Produces: `type Span = { text; highlight }`, `captionLines(text, ranges): Span[][]`, `fitFontSize(text, maxWidth, maxSize, glyphEm?)`, `clamp01`, `easeOutCubic`, `lineReveal(localMs, index, staggerMs?, durationMs?, delayMs?)`, `glitchAmount(localMs, phaseMs, lineCount, staggerMs?, delayMs?)`, `exitOpacity(localMs, phaseMs, fadeMs?)`, `colorOf(name, style)`; `presetStyle(name, msFromEdge, frame): { opacity?: number; transform?: string; filter?: string }`.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/unit/text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { presetStyle } from "../../src/lib/presets";
import { captionLines, colorOf, exitOpacity, fitFontSize, glitchAmount, lineReveal } from "../../src/lib/text";

describe("captionLines", () => {
  it("splits lines and highlighted spans, accents included", () => {
    expect(captionLines("on a créé\nma boîte", [[5, 9], [13, 18]])).toEqual([
      [{ text: "on a ", highlight: false }, { text: "créé", highlight: true }],
      [{ text: "ma ", highlight: false }, { text: "boîte", highlight: true }],
    ]);
  });
  it("returns one plain line without highlights", () => {
    expect(captionLines("red blue", [])).toEqual([[{ text: "red blue", highlight: false }]]);
  });
});

describe("fitFontSize", () => {
  it("caps at the max size for short text and shrinks long text to the width", () => {
    expect(fitFontSize("VEUT", 972, 151)).toBe(151);
    expect(fitFontSize("M'EMBAUCHER ?", 972, 151)).toBe(124);
  });
});

describe("title timing", () => {
  it("reveals lines one after the other", () => {
    expect(lineReveal(0, 0)).toBe(0);
    expect(lineReveal(320, 0)).toBe(1);
    expect(lineReveal(320, 1)).toBeCloseTo(1 - (1 - 80 / 240) ** 3, 6);
  });
  it("glitches as each line lands and at the exit", () => {
    expect(glitchAmount(80, 1800, 3)).toBe(1);
    expect(glitchAmount(130, 1800, 3)).toBeCloseTo(0.5, 6);
    expect(glitchAmount(1000, 1800, 3)).toBe(0);
    expect(glitchAmount(1760, 1800, 3)).toBeCloseTo(0.75, 6);
  });
  it("fades out over the last 160 ms", () => {
    expect(exitOpacity(1000, 1800)).toBe(1);
    expect(exitOpacity(1720, 1800)).toBeCloseTo(0.5, 6);
  });
});

describe("colorOf", () => {
  const style = { colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" } };
  it("maps a style color name, and passes a literal color through", () => {
    expect(colorOf("accent", style)).toBe("#FF6B35");
    expect(colorOf("#00FF00", style)).toBe("#00FF00");
  });
});

describe("presetStyle", () => {
  it("fades in over 250 ms", () => {
    expect(presetStyle("fade", 125, 0)).toEqual({ opacity: 0.5 });
  });
  it("pops from 90% scale", () => {
    expect(presetStyle("pop", 0, 0)).toEqual({ opacity: 0, transform: "scale(0.9)" });
    expect(presetStyle("pop", 400, 0)).toEqual({ opacity: 1, transform: "scale(1)" });
  });
  it("glitches for 200 ms then settles", () => {
    expect(presetStyle("glitch", 0, 3).filter).toContain("drop-shadow");
    expect(presetStyle("glitch", 250, 3)).toEqual({});
  });
  it("ignores unknown or missing presets", () => {
    expect(presetStyle(undefined, 0, 0)).toEqual({});
    expect(presetStyle("laser", 0, 0)).toEqual({});
  });
});
```

Expected values: "M'EMBAUCHER ?" has 13 characters, 972 / (13 x 0.6) = 124.6, floored to 124. Line 1 starts revealing at 80 + 160 = 240 ms, so at 320 ms it is 80 / 240 into its reveal. Line 0 lands at 80 ms (glitch 1, half gone 50 ms later); at 1760 ms, 40 ms are left of the phase: 1 - 40 / 160 = 0.75.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/presets`.

- [ ] **Step 3: Implement**

`packages/render/src/lib/text.ts`:
```ts
import type { Style } from "@adam-studio/model";

export type Span = { text: string; highlight: boolean };

/** Lines of spans from the wrapped caption text; ranges are character offsets into the whole text. */
export function captionLines(text: string, ranges: [number, number][]): Span[][] {
  const isHighlight = (i: number) => ranges.some(([a, b]) => i >= a && i < b);
  const lines: Span[][] = [];
  let line: Span[] = [];
  let cur: Span | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (cur) line.push(cur);
      lines.push(line);
      line = [];
      cur = null;
      continue;
    }
    const h = isHighlight(i);
    if (cur && cur.highlight === h) cur.text += ch;
    else {
      if (cur) line.push(cur);
      cur = { text: ch, highlight: h };
    }
  }
  if (cur) line.push(cur);
  lines.push(line);
  return lines;
}

/** Font size so the longest line fits maxWidth, from an average glyph width in em, capped at maxSize. */
export function fitFontSize(text: string, maxWidth: number, maxSize: number, glyphEm = 0.6): number {
  const longest = Math.max(1, ...text.split("\n").map((l) => l.length));
  return Math.min(maxSize, Math.floor(maxWidth / (longest * glyphEm)));
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function easeOutCubic(p: number): number {
  return 1 - (1 - clamp01(p)) ** 3;
}

/** Reveal progress (0 to 1) of line `index`, lines staggered after an initial delay. */
export function lineReveal(localMs: number, index: number, staggerMs = 160, durationMs = 240, delayMs = 80): number {
  return easeOutCubic((localMs - delayMs - index * staggerMs) / durationMs);
}

/** Glitch burst: 100 ms decaying from each line's start, and rising over the last 160 ms of the phase. */
export function glitchAmount(localMs: number, phaseMs: number, lineCount: number, staggerMs = 160, delayMs = 80): number {
  let g = 0;
  for (let i = 0; i < lineCount; i++) {
    const d = localMs - delayMs - i * staggerMs;
    if (d >= 0 && d < 100) g = Math.max(g, 1 - d / 100);
  }
  const left = phaseMs - localMs;
  if (left < 160) g = Math.max(g, 1 - Math.max(0, left) / 160);
  return g;
}

export function exitOpacity(localMs: number, phaseMs: number, fadeMs = 160): number {
  const left = phaseMs - localMs;
  return left >= fadeMs ? 1 : Math.max(0, left / fadeMs);
}

/** A style color by name ("accent", "ink", "text", "highlight"), or the value itself (a hex color). */
export function colorOf(name: string, style: Pick<Style, "colors">): string {
  const colors = style.colors as Record<string, string>;
  return colors[name] ?? name;
}
```

`packages/render/src/lib/presets.ts`:
```ts
import { clamp01, easeOutCubic } from "./text";

export type PresetStyle = { opacity?: number; transform?: string; filter?: string };

/** Style of an entrance (or exit, with msFromEdge counted from the end) preset at msFromEdge. */
export function presetStyle(name: string | undefined, msFromEdge: number, frame: number): PresetStyle {
  switch (name) {
    case "fade":
      return { opacity: clamp01(msFromEdge / 250) };
    case "pop":
      return { opacity: clamp01(msFromEdge / 120), transform: `scale(${0.9 + 0.1 * easeOutCubic(msFromEdge / 200)})` };
    case "glitch": {
      if (msFromEdge >= 200) return {};
      const g = 1 - msFromEdge / 200;
      const shift = Math.round(6 * g);
      const jitter = ((frame * 37) % 11) - 5;
      return {
        opacity: frame % 2 === 0 && g > 0.5 ? 0.6 : 1,
        transform: `translateX(${Math.round(jitter * g)}px)`,
        filter: `drop-shadow(${-shift}px 0 rgba(255,0,60,0.8)) drop-shadow(${shift}px 0 rgba(0,220,255,0.8))`,
      };
    }
    default:
      return {};
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): caption spans, title timing, colors and entrance presets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Media plan and public dir

**Files:**
- Create: `packages/render/src/media.ts`
- Test: `packages/render/tests/unit/media.test.ts`

**Interfaces:**
- Consumes: `Project`, `Timeline` (model); `slideWindows`, `subjectWindows` (Task 3); `MediaFiles`, `RenderProps` (Task 1).
- Produces: `class MediaError extends Error`, `type MediaPlan = { files: { from; to }[]; media: Record<string, MediaFiles>; fonts: RenderProps["fonts"] }`, `expandEnv(path)`, `planMedia(projectDir, project, timeline, opts?: { preview?: boolean }): MediaPlan` (preview: use `proxy.mp4` when present), `prepareMedia(plan, publicDir): void`, `mergePlans(plans): MediaPlan`.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/unit/media.test.ts`:
```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { MediaError, expandEnv, mergePlans, planMedia, prepareMedia } from "../../src/media";
import { projectInput, styleInput } from "./helpers";

let dir: string;
const touch = (rel: string, content = rel) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

function setup() {
  const p = parseProject(projectInput());
  const s = parseStyle({ ...styleInput, fonts: { caption: { family: "C", file: "fonts-src/c.ttf" }, title: { family: "T", file: "fonts-src/t.otf" } } });
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, timeline: resolve(p.value, s.value) };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adam media-"));
  for (const f of ["cache/s/edit.mp4", "cache/s/subject.webm", "cache/s/plate.png", "assets-src/magenta.png", "assets-src/beep.wav", "fonts-src/c.ttf", "fonts-src/t.otf"]) touch(f);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("planMedia", () => {
  it("lists every file the timeline needs, with public paths per asset", () => {
    const { project, timeline } = setup();
    const plan = planMedia(dir, project, timeline);
    expect(plan.media).toEqual({
      s: { video: "cache/s/edit.mp4", subject: "cache/s/subject.webm", plate: "cache/s/plate.png", width: 1080, height: 1920 },
      m: { file: "assets/m.png" },
      b: { file: "assets/b.wav" },
    });
    expect(plan.fonts).toEqual({ caption: "fonts/caption.ttf", title: "fonts/title.otf" });
    expect(plan.files.map((f) => f.to).sort()).toEqual([
      "assets/b.wav", "assets/m.png", "cache/s/edit.mp4", "cache/s/plate.png", "cache/s/subject.webm", "fonts/caption.ttf", "fonts/title.otf",
    ]);
  });

  it("prefers proxy.mp4 for previews, and falls back to edit.mp4", () => {
    const { project, timeline } = setup();
    expect(planMedia(dir, project, timeline, { preview: true }).media.s!.video).toBe("cache/s/edit.mp4");
    touch("cache/s/proxy.mp4");
    expect(planMedia(dir, project, timeline, { preview: true }).media.s!.video).toBe("cache/s/proxy.mp4");
    expect(planMedia(dir, project, timeline).media.s!.video).toBe("cache/s/edit.mp4");
  });

  it("names missing files and the analysis step to run", () => {
    rmSync(join(dir, "cache/s/plate.png"));
    rmSync(join(dir, "cache/s/subject.webm"));
    const { project, timeline } = setup();
    expect(() => planMedia(dir, project, timeline)).toThrow(MediaError);
    try {
      planMedia(dir, project, timeline);
    } catch (e) {
      expect((e as Error).message).toContain('cache/s/subject.webm for asset "s" (run the matting analysis step)');
      expect((e as Error).message).toContain('cache/s/plate.png for asset "s" (run the clean plate analysis step)');
    }
  });
});

describe("prepareMedia", () => {
  it("fills the public dir with the planned files", () => {
    const { project, timeline } = setup();
    const plan = planMedia(dir, project, timeline);
    const pub = join(dir, "renders", ".public");
    prepareMedia(plan, pub);
    expect(readFileSync(join(pub, "cache/s/edit.mp4"), "utf8")).toBe("cache/s/edit.mp4");
    expect(readFileSync(join(pub, "fonts/title.otf"), "utf8")).toBe("fonts-src/t.otf");
  });
});

describe("mergePlans", () => {
  it("unions files and media of several plans", () => {
    const a = { files: [{ from: "x", to: "cache/s/edit.mp4" }], media: { s: { video: "cache/s/edit.mp4" } }, fonts: { caption: "c", title: "t" } };
    const b = { files: [{ from: "y", to: "assets/m.png" }], media: { m: { file: "assets/m.png" } }, fonts: { caption: "c", title: "t" } };
    const m = mergePlans([a, b]);
    expect(m.files.map((f) => f.to)).toEqual(["cache/s/edit.mp4", "assets/m.png"]);
    expect(m.media).toEqual({ s: { video: "cache/s/edit.mp4" }, m: { file: "assets/m.png" } });
  });
});

describe("expandEnv", () => {
  it("expands Windows-style %VARS%", () => {
    process.env.ADAM_TEST_DIR = "C:/x";
    expect(expandEnv("%ADAM_TEST_DIR%/fonts/a.ttf")).toBe("C:/x/fonts/a.ttf");
    expect(expandEnv("%ADAM_NOPE%/a")).toBe("%ADAM_NOPE%/a");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/media`.

- [ ] **Step 3: Implement**

`packages/render/src/media.ts`:
```ts
import { copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import type { Project, Timeline } from "@adam-studio/model";
import { slideWindows, subjectWindows } from "./lib/subject";
import type { MediaFiles, RenderProps } from "./props";

export class MediaError extends Error {}

export type MediaPlan = {
  files: { from: string; to: string }[];
  media: Record<string, MediaFiles>;
  fonts: RenderProps["fonts"];
};

/** %LOCALAPPDATA%-style variables, as written in styles (e.g. CapCut's font cache). Unknown ones are kept. */
export function expandEnv(path: string): string {
  return path.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

export function planMedia(projectDir: string, project: Project, timeline: Timeline, opts: { preview?: boolean } = {}): MediaPlan {
  const files = new Map<string, string>(); // public path -> source path
  const media: Record<string, MediaFiles> = {};
  const missing: string[] = [];
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const at = (p: string) => {
    const expanded = expandEnv(p);
    return isAbsolute(expanded) ? expanded : join(projectDir, expanded);
  };
  const add = (asset: string, key: keyof MediaFiles, from: string, to: string, step: string) => {
    if (!existsSync(from)) {
      missing.push(`${to} for asset "${asset}" (${step})`);
      return;
    }
    files.set(to, from);
    media[asset] = { ...media[asset], [key]: to };
  };
  const cache = (asset: string, file: string) => join(projectDir, "cache", asset, file);

  const videoAssets = new Set<string>();
  for (const c of timeline.clips) {
    videoAssets.add(c.asset);
    if (c.framing.mode === "split") videoAssets.add(c.framing.asset);
  }
  for (const id of videoAssets) {
    // Previews read the half-resolution proxy when the analysis made one; exports always read edit.mp4.
    const proxy = cache(id, "proxy.mp4");
    if (opts.preview && existsSync(proxy)) add(id, "video", proxy, `cache/${id}/proxy.mp4`, "run the variants analysis step");
    else add(id, "video", cache(id, "edit.mp4"), `cache/${id}/edit.mp4`, "run the variants analysis step");
    const meta = assets.get(id)?.meta;
    if (meta?.width && meta.height) media[id] = { ...media[id], width: meta.width, height: meta.height };
  }

  for (const id of new Set(subjectWindows(timeline).map((w) => w.asset))) {
    add(id, "subject", cache(id, "subject.webm"), `cache/${id}/subject.webm`, "run the matting analysis step");
  }
  const clipAsset = new Map(timeline.clips.map((c) => [c.id, c.asset]));
  for (const id of new Set(slideWindows(timeline).map((w) => clipAsset.get(w.clipId)!))) {
    add(id, "plate", cache(id, "plate.png"), `cache/${id}/plate.png`, "run the clean plate analysis step");
  }

  const fileAssets = new Set<string>();
  for (const e of timeline.elements) if (e.kind === "image") fileAssets.add(String(e.props.asset));
  for (const a of timeline.audio) if (!videoAssets.has(a.asset)) fileAssets.add(a.asset);
  for (const id of fileAssets) {
    const asset = assets.get(id);
    if (!asset) {
      missing.push(`asset "${id}" is not declared in the project`);
      continue;
    }
    add(id, "file", at(asset.path), `assets/${id}${extname(asset.path)}`, "check the asset path");
  }

  const fonts = {
    caption: `fonts/caption${extname(timeline.style.fonts.caption.file)}`,
    title: `fonts/title${extname(timeline.style.fonts.title.file)}`,
  };
  for (const key of ["caption", "title"] as const) {
    const from = at(timeline.style.fonts[key].file);
    if (existsSync(from)) files.set(fonts[key], from);
    else missing.push(`font file ${timeline.style.fonts[key].file} (${key} font of the style)`);
  }

  if (missing.length) throw new MediaError(`Missing files:\n- ${missing.join("\n- ")}`);
  return { files: [...files].map(([to, from]) => ({ from, to })), media, fonts };
}

/** Recreates the public dir with hard links to the planned files (copies when linking is not possible). */
export function prepareMedia(plan: MediaPlan, publicDir: string): void {
  rmSync(publicDir, { recursive: true, force: true });
  for (const { from, to } of plan.files) {
    const dest = join(publicDir, to);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      linkSync(from, dest);
    } catch {
      copyFileSync(from, dest);
    }
  }
}

export function mergePlans(plans: MediaPlan[]): MediaPlan {
  const files = new Map<string, string>();
  const media: Record<string, MediaFiles> = {};
  for (const p of plans) {
    for (const f of p.files) files.set(f.to, f.from);
    for (const [id, m] of Object.entries(p.media)) media[id] = { ...media[id], ...m };
  }
  return { files: [...files].map(([to, from]) => ({ from, to })), media, fonts: plans[0]!.fonts };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): media plan with analysis-step errors and the render public dir

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Remotion composition, proven by pixel probes

**Files:**
- Create: `packages/render/src/index.ts`, `packages/render/src/Root.tsx`, `packages/render/src/Edit.tsx`, `packages/render/src/empty.ts`, `packages/render/src/fonts.ts`, `packages/render/src/engine.ts`
- Create: `packages/render/src/components/Framed.tsx`, `ClipLayer.tsx`, `SubjectLayer.tsx`, `ElementLayer.tsx`, `Title.tsx`, `BigWord.tsx`, `ImageElement.tsx`, `Captions.tsx`, `AudioLayer.tsx`
- Create: `packages/render/tests/e2e/synthetic.ts`
- Test: `packages/render/tests/e2e/stills.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 5; `parseProject`, `parseStyle`, `resolve` from the model.
- Produces: entry point `src/index.ts` (registers composition `AdamEdit`); `src/engine.ts`: `ENTRY`, `bundleFor(publicDir): Promise<string>`, `renderVideo(serveUrl, props, outFile, frameRange?)`, `renderFrame(serveUrl, props, frame, outFile)`; `tests/e2e/synthetic.ts`: `makeSynthetic(dir, opts?: { withProposal?: boolean }): void`, `findSystemFont(): string`.

- [ ] **Step 1: Write the synthetic project generator**

`packages/render/tests/e2e/synthetic.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectInput, styleInput } from "../unit/helpers";

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

export function findSystemFont(): string {
  const f = FONT_CANDIDATES.find((p) => existsSync(p));
  if (!f) throw new Error(`no system font found among ${FONT_CANDIDATES.join(", ")}`);
  return f;
}

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

/**
 * A 4 s 1080x1920 project: left half red, right half blue, 440 Hz tone; a transparent green 400x400 square as
 * the subject matte; a gray plate; a magenta full-frame image; a beep.
 */
export function makeSynthetic(dir: string, opts: { withProposal?: boolean } = {}): void {
  const cache = join(dir, "cache", "s");
  const src = join(dir, "assets-src");
  mkdirSync(cache, { recursive: true });
  mkdirSync(src, { recursive: true });
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=red:s=540x1920:r=30:d=4",
    "-f", "lavfi", "-i", "color=c=blue:s=540x1920:r=30:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(cache, "edit.mp4"),
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=4",
    "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(between(X,340,740)*between(Y,760,1160),255,0)'",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1M", join(cache, "subject.webm"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", join(cache, "plate.png")]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=magenta:s=1080x1920", "-frames:v", "1", join(src, "magenta.png")]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", join(src, "beep.wav")]);

  const font = findSystemFont();
  const style = { ...styleInput, fonts: { caption: { family: "Caption", file: font }, title: { family: "Title", file: font } } };
  writeFileSync(join(dir, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  const proposals = opts.withProposal
    ? [{
        id: "p1", step: "visuals", anchor: { word: "s.w2" }, reason: "test proposal",
        variants: [
          { key: "A", label: "magenta in front, élan: oui", patch: { addElements: [{ id: "pA", kind: "image", anchor: { word: "s.w2" }, durationMs: 500, props: { asset: "m" } }] } },
          { key: "B", label: "nothing", patch: {} },
        ],
      }]
    : [];
  writeFileSync(join(dir, "project.json"), `${JSON.stringify({ ...projectInput(), proposals }, null, 2)}\n`);
}
```

- [ ] **Step 2: Write the failing end-to-end test**

`packages/render/tests/e2e/stills.test.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve, type Style } from "@adam-studio/model";
import { bundleFor, renderFrame } from "../../src/engine";
import { planMedia, prepareMedia } from "../../src/media";
import type { RenderProps } from "../../src/props";
import { projectInput } from "../unit/helpers";
import { makeSynthetic } from "./synthetic";

let dir: string;
let serveUrl: string;
let props: RenderProps;
let style: Style;
let shots = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "adam e2e-"));
  makeSynthetic(dir);
  const p = parseProject(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")));
  const s = parseStyle(JSON.parse(readFileSync(join(dir, "style.json"), "utf8")));
  if (!p.ok || !s.ok) throw new Error("synthetic project is invalid");
  style = s.value;
  const timeline = resolve(p.value, style);
  const plan = planMedia(dir, p.value, timeline);
  const pub = join(dir, "renders", ".public");
  prepareMedia(plan, pub);
  serveUrl = await bundleFor(pub);
  props = { timeline, media: plan.media, fonts: plan.fonts };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function pixels(frame: number, points: [number, number][], p: RenderProps = props): Promise<number[][]> {
  const out = join(dir, `frame-${frame}-${++shots}.png`);
  await renderFrame(serveUrl, p, frame, out);
  const png = PNG.sync.read(readFileSync(out));
  return points.map(([x, y]) => {
    const i = (png.width * y + x) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  });
}

function near(actual: number[], expected: number[], tol = 40) {
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]!), `channel ${i}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol));
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];
const MAGENTA = [255, 0, 255];
const GRAY = [128, 128, 128];

describe("composition", () => {
  it("draws the clip with the subject in front of a behind-subject element", async () => {
    const [corner, center] = await pixels(15, [[50, 50], [540, 960]]);
    near(corner!, MAGENTA);
    near(center!, GREEN);
  });

  it("draws the clip alone when nothing else is active", async () => {
    const [left, right] = await pixels(40, [[50, 50], [1030, 50]]);
    near(left!, RED);
    near(right!, BLUE);
  });

  it("shows the plate behind a subject that slides in from the right", async () => {
    const [corner, center] = await pixels(61, [[50, 50], [540, 960]]);
    near(corner!, GRAY);
    near(center!, GRAY);
  });

  it("returns to the plain clip after the slide", async () => {
    const [left] = await pixels(75, [[300, 960]]);
    near(left!, RED);
  });

  it("fades the incoming clip in over the end of the outgoing one", async () => {
    // c2 is cropped to the blue half; the same public files serve this second timeline.
    const p = parseProject({
      ...projectInput(),
      story: [
        { id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: { kind: "crossfade", durationMs: 300 } },
        { id: "c2", asset: "s", inMs: 2000, outMs: 4000, framing: { mode: "crop", rect: { x: 0.5, y: 0, w: 0.5, h: 1 } } },
      ],
    });
    if (!p.ok) throw new Error("crossfade project is invalid");
    const faded = { ...props, timeline: resolve(p.value, style) };
    const [mid] = await pixels(55, [[50, 960]], faded);
    near(mid!, [128, 0, 128], 45);
    const [after] = await pixels(61, [[50, 960]], faded);
    near(after!, BLUE);
  });
});
```

- [ ] **Step 3: Write the engine and run the test to see it fail**

`packages/render/src/engine.ts`:
```ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { COMPOSITION_ID, type RenderProps } from "./props";

export const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

export async function bundleFor(publicDir: string): Promise<string> {
  return bundle({ entryPoint: ENTRY, publicDir });
}

export async function renderVideo(
  serveUrl: string,
  props: RenderProps,
  outFile: string,
  frameRange: number | [number, number] | [number, number][] | null = null,
): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outFile, inputProps: props, frameRange, concurrency: "50%" });
}

export async function renderFrame(serveUrl: string, props: RenderProps, frame: number, outFile: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  await renderStill({ composition, serveUrl, output: outFile, frame, inputProps: props, imageFormat: "png" });
}
```

Run: `npm run test:e2e -w @adam-studio/render`
Expected: FAIL in `beforeAll`: bundling cannot find the entry point `src/index.ts`.

- [ ] **Step 4: Implement the composition**

`packages/render/src/index.ts`:
```ts
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

`packages/render/src/empty.ts`:
```ts
import type { RenderProps } from "./props";

const lintRules = { minDurationMs: 0, maxDurationMs: 60000, maxPauseMs: 350, fillers: [] as string[] };

/** Default props so the composition can be listed before a project is loaded. */
export const EMPTY_PROPS: RenderProps = {
  timeline: {
    format: "9:16", width: 1080, height: 1920, fps: 30, durationFrames: 1,
    clips: [], elements: [], captions: [], beats: [], audio: [], orphans: [], warnings: [],
    style: {
      name: "empty",
      fonts: { caption: { family: "sans-serif", file: "none" }, title: { family: "sans-serif", file: "none" } },
      colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" },
      grade: { warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 },
      caption: { size: 0.05, stroke: 0.08, shadow: true, maxCharsPerLine: 22, intro: "miniZoom" },
      slots: { "9:16": {}, "16:9": {} },
      lint: { "9:16": lintRules, "16:9": lintRules },
    },
  },
  media: {},
  fonts: { caption: "", title: "" },
};
```

`packages/render/src/Root.tsx`:
```tsx
import type { FC } from "react";
import { Composition } from "remotion";
import { Edit } from "./Edit";
import { EMPTY_PROPS } from "./empty";
import { COMPOSITION_ID } from "./props";

export const Root: FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Edit}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={EMPTY_PROPS}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, props.timeline.durationFrames),
      fps: props.timeline.fps,
      width: props.timeline.width,
      height: props.timeline.height,
    })}
  />
);
```

`packages/render/src/fonts.ts`:
```ts
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import { CAPTION_FONT, TITLE_FONT, type RenderProps } from "./props";

const requested = new Set<string>();

/** Loads the style fonts once; loadFont blocks the render until they are ready. */
export function ensureFonts(fonts: RenderProps["fonts"]): void {
  for (const [family, path] of [[CAPTION_FONT, fonts.caption], [TITLE_FONT, fonts.title]] as const) {
    const key = `${family}:${path}`;
    if (!path || requested.has(key)) continue;
    requested.add(key);
    void loadFont({ family, url: staticFile(path) });
  }
}
```

`packages/render/src/Edit.tsx`:
```tsx
import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { AudioLayer } from "./components/AudioLayer";
import { Captions } from "./components/Captions";
import { ClipLayer } from "./components/ClipLayer";
import { ElementLayer } from "./components/ElementLayer";
import { SubjectLayer } from "./components/SubjectLayer";
import { ensureFonts } from "./fonts";
import { crossfadeWindows } from "./lib/crossfade";
import { GRADE_FILTER_ID, gradeFilter, vignetteBackground, warmthMatrix } from "./lib/grade";
import { slideWindows, subjectWindows } from "./lib/subject";
import type { RenderProps } from "./props";

export const Edit: FC<RenderProps> = (props) => {
  ensureFonts(props.fonts);
  const { timeline, media } = props;
  const grade = timeline.style.grade;
  const filter = gradeFilter(grade, GRADE_FILTER_ID);
  const slides = slideWindows(timeline);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={GRADE_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={warmthMatrix(grade.warmth).join(" ")} />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter }}>
        <ClipLayer timeline={timeline} media={media} slides={slides} crossfades={crossfadeWindows(timeline)} />
      </AbsoluteFill>
      <ElementLayer timeline={timeline} media={media} layer="behind-subject" />
      <AbsoluteFill style={{ filter }}>
        <SubjectLayer timeline={timeline} media={media} windows={subjectWindows(timeline)} slides={slides} />
      </AbsoluteFill>
      {grade.vignette > 0 ? <AbsoluteFill style={{ background: vignetteBackground(grade.vignette) }} /> : null}
      <ElementLayer timeline={timeline} media={media} layer="front" />
      <Captions timeline={timeline} />
      <AudioLayer timeline={timeline} media={media} />
    </AbsoluteFill>
  );
};
```

`packages/render/src/components/Framed.tsx`:
```tsx
import type { CSSProperties, FC, ReactNode } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Framing } from "@adam-studio/model";
import { cropBox, cropRectAt, type Size } from "../lib/framing";

type Render = (style: CSSProperties) => ReactNode;

/**
 * Draws media with a clip's framing and zoom; `render` returns the media element filling the given style.
 * `source` is the media's pixel size; unknown, it is assumed to have the canvas's shape.
 */
export const Framed: FC<{ framing: Framing; zoom: number; sourceMs: number; source?: Size; render: Render; renderSecond?: Render }> = ({
  framing, zoom, sourceMs, source, render, renderSecond,
}) => {
  const { width, height } = useVideoConfig();
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const zoomed = (node: ReactNode) => <AbsoluteFill style={{ transform: `scale(${zoom})` }}>{node}</AbsoluteFill>;
  switch (framing.mode) {
    case "cover":
      return zoomed(render(fill));
    case "fit":
      return (
        <AbsoluteFill>
          {framing.background === "blur" ? (
            <AbsoluteFill style={{ filter: "blur(40px)", transform: "scale(1.15)" }}>{render(fill)}</AbsoluteFill>
          ) : (
            <AbsoluteFill style={{ backgroundColor: framing.color ?? "black" }} />
          )}
          {zoomed(render({ ...fill, objectFit: "contain" }))}
        </AbsoluteFill>
      );
    case "crop": {
      const canvas = { width, height };
      const box = cropBox(cropRectAt(framing, sourceMs), source ?? canvas, canvas);
      return zoomed(render({ position: "absolute", ...box, objectFit: "fill" }));
    }
    case "split": {
      const sideBySide = framing.layout === "left-right";
      const half: CSSProperties = sideBySide
        ? { width: "50%", height: "100%", position: "relative", overflow: "hidden" }
        : { width: "100%", height: "50%", position: "relative", overflow: "hidden" };
      return (
        <AbsoluteFill style={{ display: "flex", flexDirection: sideBySide ? "row" : "column" }}>
          <div style={half}>{zoomed(render(fill))}</div>
          <div style={half}>{renderSecond ? renderSecond(fill) : null}</div>
        </AbsoluteFill>
      );
    }
  }
};
```

`packages/render/src/components/ClipLayer.tsx`:
```tsx
import type { FC } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Timeline, TimelineClip } from "@adam-studio/model";
import { crossfadeOpacity, type CrossfadeWindow } from "../lib/crossfade";
import { zoomAt } from "../lib/framing";
import type { SlideWindow } from "../lib/subject";
import type { MediaFiles } from "../props";
import { Framed } from "./Framed";

type Media = Record<string, MediaFiles>;

export const ClipLayer: FC<{ timeline: Timeline; media: Media; slides: SlideWindow[]; crossfades: CrossfadeWindow[] }> = ({
  timeline, media, slides, crossfades,
}) => {
  const clips = new Map(timeline.clips.map((c) => [c.id, c]));
  return (
    <>
      {timeline.clips.map((clip) => (
        <Sequence key={clip.id} from={clip.fromFrame} durationInFrames={clip.durationFrames} layout="none">
          <ClipFrame clip={clip} media={media} startFrame={clip.fromFrame} slides={slides.filter((s) => s.clipId === clip.id)} />
        </Sequence>
      ))}
      {crossfades.map((w) => (
        <Sequence key={`xf:${w.clipId}`} from={w.fromFrame} durationInFrames={w.toFrame - w.fromFrame} layout="none">
          <ClipFrame clip={clips.get(w.clipId)!} media={media} startFrame={w.fromFrame} slides={[]} fade={w} />
        </Sequence>
      ))}
    </>
  );
};

/** A clip drawn from the absolute frame `startFrame`: before the clip's own start, it is a crossfade lead-in read from the source before the in point. */
const ClipFrame: FC<{ clip: TimelineClip; media: Media; startFrame: number; slides: SlideWindow[]; fade?: CrossfadeWindow }> = ({
  clip, media, startFrame, slides, fade,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const abs = startFrame + frame;
  const elapsedMs = ((abs - clip.fromFrame) * 1000) / fps;
  const sourceMs = clip.sourceInMs + elapsedMs;
  const files = media[clip.asset] ?? {};
  const second = clip.framing.mode === "split" ? media[clip.framing.asset] ?? {} : undefined;
  const trimBefore = Math.round((clip.sourceInMs * fps) / 1000) + (startFrame - clip.fromFrame);
  const zoom = zoomAt(clip.zoom, elapsedMs);
  const source = files.width && files.height ? { width: files.width, height: files.height } : undefined;
  // During a person-only slide the room without the person replaces the take.
  const inSlide = slides.some((s) => abs >= s.fromFrame && abs < s.toFrame);
  return (
    <AbsoluteFill style={{ opacity: fade ? crossfadeOpacity(fade, abs) : 1 }}>
      <Framed
        framing={clip.framing}
        zoom={zoom}
        sourceMs={sourceMs}
        source={source}
        render={(style) => (files.video ? <OffthreadVideo src={staticFile(files.video)} trimBefore={trimBefore} muted style={style} /> : null)}
        renderSecond={second?.video ? (style) => <OffthreadVideo src={staticFile(second.video!)} trimBefore={trimBefore} muted style={style} /> : undefined}
      />
      {inSlide && files.plate ? (
        <Framed framing={clip.framing} zoom={zoom} sourceMs={sourceMs} source={source} render={(style) => <Img src={staticFile(files.plate!)} style={style} />} />
      ) : null}
    </AbsoluteFill>
  );
};
```

`packages/render/src/components/SubjectLayer.tsx`:
```tsx
import type { FC } from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Timeline, TimelineClip } from "@adam-studio/model";
import { zoomAt } from "../lib/framing";
import { slideOffset, type SlideWindow, type SubjectWindow } from "../lib/subject";
import type { MediaFiles } from "../props";
import { Framed } from "./Framed";

export const SubjectLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; windows: SubjectWindow[]; slides: SlideWindow[] }> = ({
  timeline, media, windows, slides,
}) => {
  const clips = new Map(timeline.clips.map((c) => [c.id, c]));
  return (
    <>
      {windows.map((w) => {
        const clip = clips.get(w.clipId)!;
        return (
          <Sequence key={`${w.clipId}:${w.fromFrame}`} from={w.fromFrame} durationInFrames={w.toFrame - w.fromFrame} layout="none">
            <SubjectFrame clip={clip} files={media[clip.asset] ?? {}} startFrame={w.fromFrame} slides={slides.filter((s) => s.clipId === clip.id)} />
          </Sequence>
        );
      })}
    </>
  );
};

const SubjectFrame: FC<{ clip: TimelineClip; files: MediaFiles; startFrame: number; slides: SlideWindow[] }> = ({ clip, files, startFrame, slides }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  if (!files.subject) return null;
  const abs = startFrame + frame;
  const elapsedMs = ((abs - clip.fromFrame) * 1000) / fps;
  // The window can start after the clip: skip the source frames already played.
  const trimBefore = Math.round((clip.sourceInMs * fps) / 1000) + (startFrame - clip.fromFrame);
  const slide = slides.find((s) => abs >= s.fromFrame && abs < s.toFrame);
  const { dx, blurPx } = slide ? slideOffset(slide, abs, width) : { dx: 0, blurPx: 0 };
  const blurId = `adam-slide-${clip.id}-${abs}`;
  return (
    <AbsoluteFill style={{ transform: `translateX(${dx}px)`, filter: blurPx > 0.5 ? `url(#${blurId})` : undefined }}>
      {blurPx > 0.5 ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={blurId} x="-50%" width="200%">
            <feGaussianBlur stdDeviation={`${blurPx / 2} 0`} />
          </filter>
        </svg>
      ) : null}
      <Framed
        framing={clip.framing}
        zoom={zoomAt(clip.zoom, elapsedMs)}
        sourceMs={clip.sourceInMs + elapsedMs}
        source={files.width && files.height ? { width: files.width, height: files.height } : undefined}
        render={(style) => <OffthreadVideo src={staticFile(files.subject!)} trimBefore={trimBefore} muted transparent style={style} />}
      />
    </AbsoluteFill>
  );
};
```

`packages/render/src/components/ElementLayer.tsx`:
```tsx
import type { FC } from "react";
import { Sequence } from "remotion";
import type { Timeline, TimelineElement } from "@adam-studio/model";
import type { MediaFiles } from "../props";
import { BigWord } from "./BigWord";
import { ImageElement } from "./ImageElement";
import { Title } from "./Title";

export const ElementLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; layer: "front" | "behind-subject" }> = ({ timeline, media, layer }) => (
  <>
    {timeline.elements
      .filter((e) => e.layer === layer)
      .map((el) => (
        <Sequence key={el.id} from={el.fromFrame} durationInFrames={el.durationFrames} layout="none">
          <ElementView el={el} timeline={timeline} media={media} />
        </Sequence>
      ))}
  </>
);

const ElementView: FC<{ el: TimelineElement; timeline: Timeline; media: Record<string, MediaFiles> }> = ({ el, timeline, media }) => {
  switch (el.kind) {
    case "title":
      return <Title el={el} style={timeline.style} />;
    case "text.behindSubject":
      return <BigWord el={el} style={timeline.style} />;
    case "image":
      return <ImageElement el={el} media={media} />;
    default:
      return null;
  }
};
```

`packages/render/src/components/Title.tsx`:
```tsx
import type { FC } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style, TimelineElement, TitleProps } from "@adam-studio/model";
import { exitOpacity, fitFontSize, glitchAmount, lineReveal } from "../lib/text";
import { TITLE_FONT } from "../props";

export const Title: FC<{ el: TimelineElement; style: Style }> = ({ el, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as TitleProps;
  const ms = (frame * 1000) / fps + el.trimStartMs;
  const phase = props.phases.find((p) => ms >= p.startMs && ms < p.endMs);
  if (!phase) return null;
  const local = ms - phase.startMs;
  const phaseMs = phase.endMs - phase.startMs;
  const g = glitchAmount(local, phaseMs, phase.lines.length);
  const jitter = g > 0 ? (((frame * 37) % 11) - 5) * g : 0;
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(local, phaseMs) }}>
      <div
        style={{
          position: "absolute", left: (el.x - 0.5) * width, width, top: el.y * height,
          display: "flex", flexDirection: "column", alignItems: "center", transform: `translate(${jitter}px, -50%)`,
        }}
      >
        {props.kicker && phase === props.phases[0] ? (
          <div style={{ fontFamily: TITLE_FONT, fontSize: width * 0.03, color: style.colors.accent, letterSpacing: "0.2em", marginBottom: width * 0.01 }}>
            {props.kicker}
          </div>
        ) : null}
        {phase.lines.map((line, i) => {
          const r = lineReveal(local, i);
          const size = fitFontSize(line.text, width * 0.9, width * 0.14 * line.sizeScale);
          return (
            <div
              key={i}
              style={{
                fontFamily: TITLE_FONT, fontSize: size, lineHeight: 1, letterSpacing: "-0.035em", whiteSpace: "nowrap",
                color: style.colors.ink,
                backgroundColor: line.box ? style.colors.accent : undefined,
                padding: line.box ? `0 ${size * 0.15}px` : undefined,
                transform: `translateY(${(1 - r) * size * 0.3}px)`,
                clipPath: `inset(${(1 - r) * 100}% 0 0 0)`,
                textShadow: g > 0 ? `${-6 * g}px 0 rgba(255,0,60,0.8), ${6 * g}px 0 rgba(0,220,255,0.8)` : undefined,
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

`packages/render/src/components/BigWord.tsx`:
```tsx
import type { FC } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { BehindSubjectTextProps, Style, TimelineElement } from "@adam-studio/model";
import { colorOf, exitOpacity, fitFontSize, glitchAmount, lineReveal } from "../lib/text";
import { TITLE_FONT } from "../props";

export const BigWord: FC<{ el: TimelineElement; style: Style }> = ({ el, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as BehindSubjectTextProps;
  const ms = (frame * 1000) / fps + el.trimStartMs;
  const totalMs = (el.durationFrames * 1000) / fps + el.trimStartMs;
  const r = lineReveal(ms, 0, 0, 250, 0);
  const g = glitchAmount(ms, totalMs, 1, 0, 0);
  const size = fitFontSize(props.text, width * 0.92, width * 0.21 * props.sizeScale);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(ms, totalMs) }}>
      <div
        style={{
          position: "absolute", left: (el.x - 0.5) * width, width, top: el.y * height, transform: "translateY(-50%)",
          textAlign: "center", fontFamily: TITLE_FONT, fontSize: size, lineHeight: 1, letterSpacing: "-0.035em", whiteSpace: "nowrap",
          color: colorOf(props.color, style),
          clipPath: `inset(${(1 - r) * 100}% 0 0 0)`,
          textShadow: g > 0 ? `${-6 * g}px 0 rgba(255,0,60,0.8), ${6 * g}px 0 rgba(0,220,255,0.8)` : undefined,
        }}
      >
        {props.text}
      </div>
    </AbsoluteFill>
  );
};
```

`packages/render/src/components/ImageElement.tsx`:
```tsx
import type { CSSProperties, FC } from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ImageProps, TimelineElement } from "@adam-studio/model";
import { presetStyle } from "../lib/presets";
import type { MediaFiles } from "../props";

export const ImageElement: FC<{ el: TimelineElement; media: Record<string, MediaFiles> }> = ({ el, media }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as ImageProps;
  const file = media[props.asset]?.file;
  if (!file) return null;
  const ms = (frame * 1000) / fps + el.trimStartMs;
  const totalMs = (el.durationFrames * 1000) / fps + el.trimStartMs;
  const intro = presetStyle(props.intro, ms, frame);
  const outro = presetStyle(props.outro, totalMs - ms, frame);
  const box: CSSProperties =
    props.fit === "full"
      ? { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "fill" }
      : { position: "absolute", left: el.x * width, top: el.y * height, maxWidth: "90%", maxHeight: "90%", objectFit: props.fit, translate: "-50% -50%" };
  return (
    <Img
      src={staticFile(file)}
      style={{
        ...box,
        opacity: Math.min(intro.opacity ?? 1, outro.opacity ?? 1),
        transform: [intro.transform, outro.transform].filter(Boolean).join(" ") || undefined,
        filter: [intro.filter, outro.filter].filter(Boolean).join(" ") || undefined,
      }}
    />
  );
};
```

`packages/render/src/components/Captions.tsx`:
```tsx
import type { FC } from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style, Timeline, TimelineCaption } from "@adam-studio/model";
import { captionLines, easeOutCubic } from "../lib/text";
import { CAPTION_FONT } from "../props";

export const Captions: FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {timeline.captions.map((c) => (
      <Sequence key={c.id} from={c.fromFrame} durationInFrames={c.durationFrames} layout="none">
        <CaptionView c={c} style={timeline.style} />
      </Sequence>
    ))}
  </>
);

const CaptionView: FC<{ c: TimelineCaption; style: Style }> = ({ c, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const size = style.caption.size * width;
  const introFrames = Math.max(1, Math.min(Math.round(0.15 * fps), Math.floor(c.durationFrames / 3)));
  const scale = style.caption.intro === "miniZoom" ? 0.85 + 0.15 * easeOutCubic(frame / introFrames) : 1;
  return (
    <div
      style={{
        position: "absolute", left: c.x * width - width * 0.45, width: width * 0.9, top: c.y * height,
        transform: `translateY(-50%) scale(${scale})`, textAlign: "center",
        fontFamily: CAPTION_FONT, fontSize: size, lineHeight: 1.15, color: style.colors.text,
        WebkitTextStroke: `${size * style.caption.stroke * 0.5}px black`, paintOrder: "stroke fill",
        textShadow: style.caption.shadow ? "0 4px 12px rgba(0,0,0,0.55)" : undefined,
      }}
    >
      {captionLines(c.text, c.highlightRanges).map((line, i) => (
        <div key={i}>
          {line.map((s, k) => (
            <span key={k} style={{ color: s.highlight ? style.colors.highlight : undefined }}>
              {s.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
```

`packages/render/src/components/AudioLayer.tsx`:
```tsx
import type { FC } from "react";
import { Html5Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Timeline, TimelineAudio } from "@adam-studio/model";
import { audioVolume } from "../lib/audio";
import type { MediaFiles } from "../props";

export const AudioLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles> }> = ({ timeline, media }) => (
  <>
    {timeline.audio.map((a) => {
      const files = media[a.asset] ?? {};
      const src = files.video ?? files.file;
      if (!src || a.durationFrames < 1) return null;
      return (
        <Sequence key={a.id} from={a.fromFrame} durationInFrames={a.durationFrames} layout="none">
          <AudioItem src={src} item={a} />
        </Sequence>
      );
    })}
  </>
);

const AudioItem: FC<{ src: string; item: TimelineAudio }> = ({ src, item }) => {
  const { fps } = useVideoConfig();
  // The volume callback receives the frame counted from the start of this audio, as audioVolume expects.
  return <Html5Audio src={staticFile(src)} trimBefore={Math.round((item.sourceInMs * fps) / 1000)} volume={(f) => audioVolume(item, f, fps)} />;
};
```

- [ ] **Step 5: Run the end-to-end test and the typecheck**

Run: `npm run test:e2e -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: 5 tests PASS (the first run downloads Chrome Headless Shell, then bundling and the stills take a few minutes); typecheck exit code 0. Frame 55 of the crossfade is at opacity 0.5 (5th of 9 lead-in frames, (55 - 51 + 1) / 10), so red and blue mix to about (128, 0, 128).

- [ ] **Step 6: Run the unit suite**

Run: `npm test -w @adam-studio/render`
Expected: all unit tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/render
git commit -m "feat(render): Remotion composition with subject layer, person-only slides, titles, captions and audio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `adam render`

**Files:**
- Create: `packages/render/src/project-io.ts`, `packages/render/src/commands/render.ts`, `packages/render/src/cli.ts`
- Test: `packages/render/tests/unit/render-command.test.ts`, `packages/render/tests/e2e/render.test.ts`

**Interfaces:**
- Consumes: `parseProject`, `parseStyle`, `resolve`, `lint` (model); `planMedia`, `prepareMedia` (Task 5); `bundleFor`, `renderVideo` (Task 6); `makeSynthetic` (Task 6).
- Produces: `src/project-io.ts`: `class CliError extends Error`, `loadProject(projectDir): { dir; project; style }`, `saveProject(dir, project)`, `formatErrors(file, errors)`. `src/commands/render.ts`: `parseFrames(s?)`, `renderCommand(projectDir, { out?, frames?, force }): Promise<string>`. `src/cli.ts`: the `adam` entry (`npm run adam -- <command> ...`); Task 8 adds `review`, `decide`, `studio` to its switch.

- [ ] **Step 1: Write the failing unit test**

`packages/render/tests/unit/render-command.test.ts`:
```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrames } from "../../src/commands/render";
import { CliError, loadProject } from "../../src/project-io";
import { projectInput, styleInput } from "./helpers";

describe("parseFrames", () => {
  it("reads a-b and rejects anything else", () => {
    expect(parseFrames("10-40")).toEqual([10, 40]);
    expect(parseFrames(undefined)).toBeNull();
    expect(() => parseFrames("ten")).toThrow(CliError);
  });
});

describe("loadProject", () => {
  it("loads the project and its style relative to the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam io-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify(projectInput()));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    const { project, style } = loadProject(dir);
    expect(project.name).toBe("synthetic");
    expect(style.name).toBe("Test");
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists every invalid field", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam io-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...projectInput(), story: [{ id: "c1", asset: "s", inMs: 5, outMs: 5 }] }));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    expect(() => loadProject(dir)).toThrow("project.json is invalid:\n- story[0].outMs: outMs must be greater than inMs");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/commands/render`.

- [ ] **Step 3: Implement project IO, the render command and the CLI**

`packages/render/src/project-io.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseProject, parseStyle, type FieldError, type Project, type Style } from "@adam-studio/model";

export class CliError extends Error {}

export function formatErrors(file: string, errors: FieldError[]): string {
  return `${file} is invalid:\n${errors.map((e) => `- ${e.path}: ${e.message}`).join("\n")}`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new CliError(`cannot read ${path}: ${(e as Error).message}`);
  }
}

export function loadProject(projectDir: string): { dir: string; project: Project; style: Style } {
  const dir = resolve(projectDir);
  const p = parseProject(readJson(join(dir, "project.json")));
  if (!p.ok) throw new CliError(formatErrors("project.json", p.errors));
  const stylePath = isAbsolute(p.value.style) ? p.value.style : join(dir, p.value.style);
  const s = parseStyle(readJson(stylePath));
  if (!s.ok) throw new CliError(formatErrors(p.value.style, s.errors));
  return { dir, project: p.value, style: s.value };
}

export function saveProject(dir: string, project: Project): void {
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
}
```

`packages/render/src/commands/render.ts`:
```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { lint, resolve } from "@adam-studio/model";
import { bundleFor, renderVideo } from "../engine";
import { planMedia, prepareMedia } from "../media";
import { CliError, loadProject } from "../project-io";

export function parseFrames(s?: string): [number, number] | null {
  if (!s) return null;
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (!m) throw new CliError(`--frames expects a-b (e.g. 0-90), got "${s}"`);
  return [Number(m[1]), Number(m[2])];
}

export async function renderCommand(projectDir: string, opts: { out?: string; frames?: string; force: boolean }): Promise<string> {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  const warnings = lint(project, timeline, { projectDir: dir, fileExists: existsSync });
  for (const w of warnings) console.log(`${w.severity === "error" ? "ERROR" : "warn "} ${w.rule}: ${w.message}`);
  if (warnings.some((w) => w.severity === "error") && !opts.force) {
    throw new CliError("Refusing to render: fix the errors above, or pass --force.");
  }
  const plan = planMedia(dir, project, timeline);
  const publicDir = join(dir, "renders", ".public");
  prepareMedia(plan, publicDir);
  const serveUrl = await bundleFor(publicDir);
  const out = opts.out ? resolvePath(opts.out) : join(dir, "renders", `${project.name}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(join(dir, "renders", `${project.name}.timeline.json`), `${JSON.stringify(timeline, null, 2)}\n`);
  await renderVideo(serveUrl, { timeline, media: plan.media, fonts: plan.fonts }, out, parseFrames(opts.frames));
  console.log(`wrote ${out}`);
  return out;
}
```

`packages/render/src/cli.ts`:
```ts
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderCommand } from "./commands/render";
import { CliError } from "./project-io";

// `npm run adam` runs from the repo root; relative paths are meant from where the command was typed.
const base = process.env.INIT_CWD ?? process.cwd();

const USAGE = `usage: npm run adam -- <command> <projectDir> [options]
  render <dir> [--out file.mp4] [--frames a-b] [--force]`;

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      frames: { type: "string" },
      force: { type: "boolean" },
      step: { type: "string" },
      note: { type: "string" },
    },
  });
  const [cmd, dirArg] = positionals;
  if (!cmd || !dirArg) throw new CliError(USAGE);
  const dir = resolve(base, dirArg);
  switch (cmd) {
    case "render":
      await renderCommand(dir, { out: values.out ? resolve(base, values.out) : undefined, frames: values.frames, force: values.force ?? false });
      return;
    default:
      throw new CliError(USAGE);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test -w @adam-studio/render`
Expected: all PASS.

- [ ] **Step 5: Write the end-to-end render test**

`packages/render/tests/e2e/render.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCommand } from "../../src/commands/render";
import { makeSynthetic } from "./synthetic";

function probe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
}

describe("adam render", () => {
  it("renders the synthetic project to a 1080x1920 MP4 with sound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam render-"));
    makeSynthetic(dir);
    const out = await renderCommand(dir, { force: false });
    expect(existsSync(join(dir, "renders", "synthetic.timeline.json"))).toBe(true);
    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(Math.abs(Number(info.format.duration) - 4)).toBeLessThan(0.15);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to render while proposals are pending, unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam render-"));
    makeSynthetic(dir, { withProposal: true });
    await expect(renderCommand(dir, { force: false })).rejects.toThrow("Refusing to render");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run the end-to-end tests and the typecheck**

Run: `npm run test:e2e -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS (7 end-to-end tests); typecheck exit code 0.

- [ ] **Step 7: Try the CLI by hand**

Run: `npm run adam -- render` (no folder)
Expected: prints the usage line and exits with code 1.

- [ ] **Step 8: Commit**

```bash
git add packages/render
git commit -m "feat(render): adam render with lint gate, timeline snapshot and MP4 export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `adam review`, `adam decide`, `adam studio`

**Files:**
- Create: `packages/render/src/commands/review.ts`, `packages/render/src/commands/decide.ts`, `packages/render/src/commands/studio.ts`
- Modify: `packages/render/src/cli.ts`
- Test: `packages/render/tests/unit/review.test.ts`, `packages/render/tests/e2e/review.test.ts`

**Interfaces:**
- Consumes: `resolve`, `decide`, `applyPatch`, `indexWords`, `layoutStory`, `wordOutput`, `msToFrame`, `Decision` (model); `planMedia`, `prepareMedia`, `mergePlans`, `expandEnv` (Task 5); `bundleFor`, `renderVideo`, `renderFrame`, `ENTRY` (Task 6); `loadProject`, `saveProject`, `CliError` (Task 7).
- Produces: `src/commands/review.ts`: `reviewTargets(project, step?)`, `reviewWindow(project, timeline, proposal): { ranges: [number, number][]; still: number }`, `sheetLabel(key, label)`, `reviewCommand(projectDir, { step? }): Promise<string[]>` (returns the review folders). `src/commands/decide.ts`: `decideCommand(projectDir, proposalId, decision, note?): Project`. `src/commands/studio.ts`: `studioCommand(projectDir)`.

- [ ] **Step 1: Write the failing unit tests**

`packages/render/tests/unit/review.test.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatch, newWorkflow, parseProject, parseStyle, resolve, type Project } from "@adam-studio/model";
import { decideCommand } from "../../src/commands/decide";
import { reviewTargets, reviewWindow, sheetLabel } from "../../src/commands/review";
import { projectInput, styleInput } from "./helpers";

function load(over: Parameters<typeof projectInput>[0] = {}) {
  const p = parseProject(projectInput(over));
  const s = parseStyle(styleInput);
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, style: s.value };
}

const proposal = (id: string, step: "cuts" | "visuals", anchor?: { word: string }) => ({
  id, step, reason: "r", ...(anchor ? { anchor } : {}),
  variants: [{ key: "A" as const, label: "a", patch: {} }, { key: "B" as const, label: "b", patch: {} }],
});

describe("reviewTargets", () => {
  it("takes the pending proposals of the current step", () => {
    const { project } = load({ workflow: newWorkflow(), proposals: [proposal("p1", "cuts"), proposal("p2", "visuals")] });
    expect(reviewTargets(project).map((p) => p.id)).toEqual(["p1"]);
    expect(reviewTargets(project, "visuals").map((p) => p.id)).toEqual(["p2"]);
  });
  it("takes every pending proposal without a workflow", () => {
    const { project } = load({ proposals: [proposal("p1", "cuts"), proposal("p2", "visuals")] });
    expect(reviewTargets(project).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("reviewWindow", () => {
  it("centers 3 seconds on the anchor word, still just after it", () => {
    const { project, style } = load({ proposals: [proposal("p1", "visuals", { word: "s.w2" })] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[21, 111]], still: 71 });
  });
  it("uses three 1-second samples for a proposal without anchor", () => {
    const { project, style } = load({ proposals: [proposal("p1", "cuts")] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[15, 44], [45, 74], [75, 104]], still: 60 });
  });
  it("merges samples that overlap in a short edit", () => {
    const { project, style } = load({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 1000 }], proposals: [proposal("p1", "cuts")] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[0, 29]], still: 15 });
  });
  it("follows the timing of the variant being previewed", () => {
    const { project, style } = load({
      proposals: [{
        id: "p1", step: "cuts", anchor: { word: "s.w2" }, reason: "r",
        variants: [{ key: "A", label: "trim the start", patch: { setStory: [{ id: "c1", asset: "s", inMs: 1000, outMs: 4000 }] } }],
      }],
    });
    const p = project.proposals[0]!;
    const tl = resolve(project, style, { apply: { proposal: "p1", variant: "A" } });
    expect(reviewWindow(applyPatch(project, p.variants[0]!.patch), tl, p)).toEqual({ ranges: [[0, 81]], still: 41 });
  });
});

describe("sheetLabel", () => {
  it("keeps letters, accents, digits and spaces only", () => {
    expect(sheetLabel("A", "magenta in front, élan: oui")).toBe("A  magenta in front, élan oui");
  });
});

describe("decideCommand", () => {
  it("records the decision in project.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam decide-"));
    const variants = [{ key: "A", label: "add", patch: { addElements: [{ id: "x", kind: "image", anchor: { atMs: 0 }, durationMs: 300, props: { asset: "m" } }] } }];
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...projectInput(), proposals: [{ id: "p1", step: "visuals", variants }] }));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    decideCommand(dir, "p1", "A", "nice");
    const saved = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as Project;
    expect(saved.elements.map((e) => e.id)).toContain("x");
    expect(saved.proposals[0]!.status).toEqual({ accepted: "A" });
    expect(saved.proposals[0]!.history[0]).toMatchObject({ decision: "A", note: "nice" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an unknown decision word", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam decide-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify(projectInput()));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    expect(() => decideCommand(dir, "p1", "maybe")).toThrow('decision must be A, B, C, reject or more, got "maybe"');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

Expected values: s.w2 starts at 2200 ms in source, kept in c2 at output 2200 ms, frame 66; plus or minus 45 frames gives 21 to 111; the still is 5 frames later (71). Without anchor, the 4 s video (120 frames) is sampled at 25%, 50%, 75% (frames 30, 60, 90), each sample 30 frames long and ending one frame before the next starts. A 1 s edit (30 frames, last frame 29) gives samples around frames 8, 15 and 23 that overlap and merge into 0 to 29. With variant A the story starts at 1000 ms, so s.w2 plays at 1200 ms (frame 36): 36 - 45 clamps to 0, 36 + 45 = 81, still 41.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/commands/decide`.

- [ ] **Step 3: Implement the commands**

`packages/render/src/commands/decide.ts`:
```ts
import { decide, type Decision, type Project } from "@adam-studio/model";
import { CliError, loadProject, saveProject } from "../project-io";

const DECISIONS = ["A", "B", "C", "reject", "more"];

export function decideCommand(projectDir: string, proposalId: string, decision: string, note?: string): Project {
  if (!DECISIONS.includes(decision)) {
    throw new CliError(`decision must be A, B, C, reject or more, got "${decision}"`);
  }
  const { dir, project } = loadProject(projectDir);
  const next = decide(project, proposalId, decision as Decision, note);
  saveProject(dir, next);
  console.log(`${proposalId}: ${decision}${note ? ` (${note})` : ""}; current step: ${next.workflow?.current ?? "none"}`);
  return next;
}
```

`packages/render/src/commands/review.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyPatch, indexWords, layoutStory, msToFrame, resolve, wordOutput,
  type Project, type Proposal, type StepId, type Timeline,
} from "@adam-studio/model";
import { bundleFor, renderFrame, renderVideo } from "../engine";
import { expandEnv, mergePlans, planMedia, prepareMedia, type MediaPlan } from "../media";
import { loadProject } from "../project-io";

export function reviewTargets(project: Project, step?: string): Proposal[] {
  const pending = project.proposals.filter((p) => p.status === "pending" && p.variants.length > 0);
  const current = step ?? project.workflow?.current;
  return current ? pending.filter((p) => p.step === (current as StepId)) : pending;
}

/** Frames to preview for a proposal, computed on the project as the variant leaves it. */
export function reviewWindow(project: Project, timeline: Timeline, proposal: Proposal): { ranges: [number, number][]; still: number } {
  const fps = timeline.fps;
  const last = Math.max(0, timeline.durationFrames - 1);
  let anchorMs: number | null = null;
  if (proposal.anchor) {
    if ("atMs" in proposal.anchor) anchorMs = proposal.anchor.atMs;
    else {
      const w = indexWords(project).get(proposal.anchor.word);
      const out = w ? wordOutput(layoutStory(project).clips, w) : null;
      anchorMs = out ? out.startMs + proposal.anchor.offsetMs : null;
    }
  }
  if (anchorMs !== null) {
    const center = msToFrame(anchorMs, fps);
    const half = Math.round(1.5 * fps);
    return {
      ranges: [[Math.max(0, center - half), Math.min(last, center + half)]],
      still: Math.min(last, center + Math.round(0.15 * fps)),
    };
  }
  const half = Math.round(0.5 * fps);
  const ranges: [number, number][] = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const c = Math.min(last, Math.round(timeline.durationFrames * f));
    const r: [number, number] = [Math.max(0, c - half), Math.min(last, c + half - 1)];
    const prev = ranges[ranges.length - 1];
    // Overlapping samples (short edits) merge, so no frame is rendered twice.
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else ranges.push(r);
  }
  return { ranges, still: Math.min(last, Math.round(timeline.durationFrames * 0.5)) };
}

/** Text safe for ffmpeg drawtext: letters (accents included), digits, spaces, commas, dots, dashes. */
export function sheetLabel(key: string, label: string): string {
  return `${key}  ${label.replace(/[^\p{L}\p{N} ,.\-]/gu, "")}`;
}

function drawtextPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function makeSheet(stills: { file: string; text: string }[], fontFile: string, out: string): void {
  const inputs = stills.flatMap((s) => ["-i", s.file]);
  const font = existsSync(fontFile) ? `fontfile='${drawtextPath(fontFile)}':` : "";
  const labelled = stills
    .map((s, i) => `[${i}:v]scale=360:-1,drawtext=${font}text='${s.text}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:boxborderw=8:x=12:y=12[v${i}]`)
    .join(";");
  const join_ = stills.length > 1 ? `;${stills.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${stills.length}[out]` : "";
  const map = stills.length > 1 ? "[out]" : "[v0]";
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${labelled}${join_}`, "-map", map, "-frames:v", "1", out]);
}

export async function reviewCommand(projectDir: string, opts: { step?: string } = {}): Promise<string[]> {
  const { dir, project, style } = loadProject(projectDir);
  const targets = reviewTargets(project, opts.step);
  if (targets.length === 0) {
    console.log("Nothing to review: no pending proposal with variants in this step.");
    return [];
  }
  type Job = { proposal: Proposal; key: string; label: string; applied: Project; timeline: Timeline; plan: MediaPlan };
  const jobs: Job[] = [];
  for (const p of targets) {
    for (const v of p.variants) {
      const timeline = resolve(project, style, { apply: { proposal: p.id, variant: v.key } });
      const applied = applyPatch(project, v.patch);
      jobs.push({ proposal: p, key: v.key, label: v.label, applied, timeline, plan: planMedia(dir, applied, timeline) });
    }
  }
  const merged = mergePlans(jobs.map((j) => j.plan));
  const publicDir = join(dir, "renders", ".public");
  prepareMedia(merged, publicDir);
  const serveUrl = await bundleFor(publicDir);
  const folders: string[] = [];
  for (const p of targets) {
    const folder = join(dir, "renders", "review", p.id);
    mkdirSync(folder, { recursive: true });
    const entries: { key: string; label: string; preview: string; still: string; ranges: [number, number][] }[] = [];
    for (const j of jobs.filter((x) => x.proposal.id === p.id)) {
      const win = reviewWindow(j.applied, j.timeline, p);
      const props = { timeline: j.timeline, media: merged.media, fonts: merged.fonts };
      await renderVideo(serveUrl, props, join(folder, `${j.key}.mp4`), win.ranges.length === 1 ? win.ranges[0]! : win.ranges);
      await renderFrame(serveUrl, props, win.still, join(folder, `${j.key}.png`));
      entries.push({ key: j.key, label: j.label, preview: `${j.key}.mp4`, still: `${j.key}.png`, ranges: win.ranges });
    }
    makeSheet(
      entries.map((e) => ({ file: join(folder, e.still), text: sheetLabel(e.key, e.label) })),
      expandEnv(style.fonts.caption.file),
      join(folder, "sheet.jpg"),
    );
    writeFileSync(join(folder, "index.json"), `${JSON.stringify({ proposal: p.id, step: p.step, reason: p.reason, variants: entries }, null, 2)}\n`);
    console.log(`review ready: ${folder}`);
    folders.push(folder);
  }
  return folders;
}
```

`packages/render/src/commands/studio.ts`:
```ts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { resolve } from "@adam-studio/model";
import { ENTRY } from "../engine";
import { planMedia, prepareMedia } from "../media";
import { loadProject } from "../project-io";

/** The Remotion CLI script, run with node directly: no shell, so paths with spaces stay intact. */
function remotionCli(): string {
  const pkgPath = createRequire(import.meta.url).resolve("@remotion/cli/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: Record<string, string> };
  return join(dirname(pkgPath), pkg.bin.remotion!);
}

/** Opens Remotion Studio on the project: the preview until the web app exists. */
export function studioCommand(projectDir: string): void {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  const plan = planMedia(dir, project, timeline, { preview: true });
  const publicDir = join(dir, "renders", ".public");
  prepareMedia(plan, publicDir);
  const propsFile = join(dir, "renders", "studio-props.json");
  writeFileSync(propsFile, JSON.stringify({ timeline, media: plan.media, fonts: plan.fonts }));
  spawnSync(process.execPath, [remotionCli(), "studio", ENTRY, "--public-dir", publicDir, "--props", propsFile], {
    cwd: join(dirname(ENTRY), ".."),
    stdio: "inherit",
  });
}
```

In `packages/render/src/cli.ts`, add the imports:
```ts
import { decideCommand } from "./commands/decide";
import { reviewCommand } from "./commands/review";
import { studioCommand } from "./commands/studio";
```
replace the `USAGE` constant with:
```ts
const USAGE = `usage: npm run adam -- <command> <projectDir> [options]
  render <dir> [--out file.mp4] [--frames a-b] [--force]
  review <dir> [--step <step>]
  decide <dir> <proposalId> <A|B|C|reject|more> [--note "..."]
  studio <dir>`;
```
replace `const [cmd, dirArg] = positionals;` with `const [cmd, dirArg, ...rest] = positionals;`, and add these cases before `default:`:
```ts
    case "review":
      await reviewCommand(dir, { step: values.step });
      return;
    case "decide": {
      const [id, decision] = rest;
      if (!id || !decision) throw new CliError(USAGE);
      decideCommand(dir, id, decision, values.note);
      return;
    }
    case "studio":
      studioCommand(dir);
      return;
```

- [ ] **Step 4: Run the unit tests and the typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Write the end-to-end review test**

`packages/render/tests/e2e/review.test.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { reviewCommand } from "../../src/commands/review";
import { makeSynthetic } from "./synthetic";

function pixel(file: string, x: number, y: number): number[] {
  const png = PNG.sync.read(readFileSync(file));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe("adam review", () => {
  it("renders a preview, a still, a labelled sheet and an index per variant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam review-"));
    makeSynthetic(dir, { withProposal: true });
    const [folder] = await reviewCommand(dir);
    for (const f of ["A.mp4", "B.mp4", "A.png", "B.png", "sheet.jpg", "index.json"]) expect(existsSync(join(folder!, f)), f).toBe(true);
    const a = pixel(join(folder!, "A.png"), 50, 50);
    const b = pixel(join(folder!, "B.png"), 50, 50);
    expect(a[0]! > 200 && a[1]! < 60 && a[2]! > 200, `A should show the magenta element, got ${a}`).toBe(true);
    expect(b[0]! > 200 && b[1]! < 60 && b[2]! < 60, `B should show the red take, got ${b}`).toBe(true);
    const index = JSON.parse(readFileSync(join(folder!, "index.json"), "utf8"));
    expect(index.variants.map((v: { key: string }) => v.key)).toEqual(["A", "B"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run the end-to-end suite**

Run: `npm run test:e2e -w @adam-studio/render`
Expected: all PASS (8 end-to-end tests).

- [ ] **Step 7: Check the studio by hand**

Run: `npm run adam -- studio <a synthetic project folder>` (create one with `npx tsx -e "import('./packages/render/tests/e2e/synthetic.ts').then(m => m.makeSynthetic('<folder>'))"`)
Expected: Remotion Studio opens in the browser on composition `AdamEdit` and plays the 4 s synthetic edit (red and blue halves, magenta flash, green square, slide). Close it with Ctrl+C.

- [ ] **Step 8: Run everything from the root and commit**

Run: `npm test` then `npm run typecheck`
Expected: model and render unit suites PASS; typecheck exit code 0.

```bash
git add packages/render
git commit -m "feat(render): adam review previews and sheets, adam decide, adam studio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
