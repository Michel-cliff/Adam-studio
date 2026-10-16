# Adam Studio CapCut Exporter Implementation Plan (sub-project 1, plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `python -m adam_capcut export <projectDir> [--name "1015 edit"]` writes a self-contained CapCut project from an Adam Studio project: native CapCut items wherever possible, Remotion renders for the rest, and a report saying which is which.

**Architecture:** Two steps. A TypeScript prepare step (`npm run adam -- capcut-prep <dir>`, in `packages/render`) resolves the timeline, decides what cannot be native (`planCapcut`), renders it with Remotion (baked stretches of the main track as H.264, front elements without a native equivalent as transparent MOV ProRes 4444), and writes `renders/capcut/{timeline.json, capcut-plan.json, bake/, overlay/}`. A Python package (`py/capcut`, `adam_capcut`) runs that step, then builds the CapCut project with the lab's pyJianYingDraft: main track (native clip parts around the baked stretches), front photos and overlays, native captions with the style font, sound effects, grade keyframes and vignette, with every media file copied inside the CapCut project, and writes `renders/<name>.capcut-report.json`.

**Tech Stack:** TypeScript and Remotion 4.0.536 (existing `packages/render`), Python 3.12, pytest 9.0.3, imageio 2.38.1 (needed by pyJianYingDraft), pyJianYingDraft and `draft_profiles` from the ClaudeCapcut lab (`ADAM_CAPCUT_LAB`, default `~/ClaudeCapcut/VectCutAPI`), ffmpeg and ffprobe on PATH.

**Spec:** `docs/superpowers/specs/2026-10-16-adam-studio-core-design.md` (sections 3, 9, 10, 11, 12, 13.4); decision `docs/decisions/0001-capcut-alpha-video.md`.

## Global Constraints

- pyJianYingDraft is an external dependency: imported from the lab folder (`ADAM_CAPCUT_LAB`, default `Path.home() / "ClaudeCapcut" / "VectCutAPI"`), never copied into the repo. The Python venv lives in `py/capcut/.venv` and is never committed.
- Python commands run from the repo root with `py/capcut/.venv/Scripts/python` (Windows; `py/capcut/.venv/bin/python` elsewhere).
- CapCut times are microseconds, computed from accumulated frame positions: `span_us(from, to, fps)`, never by adding rounded durations.
- CapCut positions are half-canvas units from the center with +Y up; scales are relative to CapCut's fit-to-canvas size.
- Safety (spec section 10): ownership marker `.adam_studio_export` written at folder creation; a folder without it is never overwritten; a folder containing `.locked` (open in CapCut) is refused. Projects made by the lab (marker `.vectcut_generated`) or by hand are therefore never touched.
- Every media file used by the CapCut project is copied into its `media/` folder.
- Transparent overlays are MOV ProRes 4444 (`prores`, profile `4444`, `yuva444p10le`), per decision 0001.
- Bake mode draws the main track only (clips, behind-subject elements, subject, clip audio), ungraded: CapCut applies the brightness, contrast and saturation keyframes and the vignette effect over the whole main track, so baked and native stretches match.
- Deliberate departures from the spec's mapping table, to confirm at review: `title` elements are exported as transparent overlays (exact look, but not editable text) instead of native text; `split` clips are baked instead of two video tracks; `grade.warmth` is reported `skipped` (set Temperature by hand in CapCut) instead of approximated; `crossfade` is reported `skipped` (done by hand, decision of 2026-10-16).
- Caption size and stroke use provisional factors calibrated on the lab edit (`CAPTION_SIZE_K = 200`, `BORDER_K = 500`); Task 9's manual check confirms or corrects them.
- Docs and messages use no em dash characters. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A project name with a colon, accents or other characters Windows forbids ("synthétique : test"): the CapCut folder and the report use the safe name ("synthétique - test") (Task 4 `safe_name` test, Task 7 folder name test).
- Exporting again while the CapCut project is open (`.locked`), or onto a project made by hand with the same name: explicit refusal, nothing deleted (Task 6 folder tests, Task 7 export tests, Task 9 CLI test).
- A 16:9 screen recording in a 9:16 project, with `cover` or `crop` framing: scale relative to CapCut's fit size, rect read in the source frame (Task 4 `cover_scale` and `crop_transform` landscape tests).
- Overlapping sound effects, captions or front elements: each overlap level gets its own CapCut track, never two segments overlapping on one track (Task 5 `allocate` test; Task 8 uses it for captions, front items and sounds).
- Accented text in a highlighted caption ("créé\nma boîte" with "boîte" highlighted): highlight ranges land on the right characters (Task 8 caption test).

---

### Task 1: Render modes for CapCut (bake and overlay) and transparent output

**Files:**
- Modify: `packages/render/src/props.ts`, `packages/render/src/Edit.tsx`, `packages/render/src/components/ElementLayer.tsx`, `packages/render/src/components/AudioLayer.tsx`, `packages/render/src/engine.ts`
- Test: `packages/render/tests/e2e/modes.test.ts`

**Interfaces:**
- Consumes: `bundleWithMedia`, `renderFrame`, `renderVideo` (engine), `planMedia` (media), `makeSynthetic` (tests/e2e/synthetic.ts), `projectInput` (tests/unit/helpers.ts).
- Produces: `type RenderMode = { kind: "full" } | { kind: "bake" } | { kind: "overlay"; elements: string[] }`; `RenderProps.mode?: RenderMode` (absent means full); `renderVideo(serveUrl, props, outFile, frameRange?, opts?: { transparent?: boolean })`, where `transparent` writes MOV ProRes 4444 with alpha and no audio.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/e2e/modes.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { bundleWithMedia, renderFrame, renderVideo } from "../../src/engine";
import { planMedia } from "../../src/media";
import type { RenderProps } from "../../src/props";
import { projectInput } from "../unit/helpers";
import { makeSynthetic } from "./synthetic";

let dir: string;
let serveUrl: string;
let props: RenderProps;
let shots = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "adam modes-"));
  makeSynthetic(dir);
  // A full-frame magenta image in front of everything, frames 39 to 47.
  const front = { id: "front", kind: "image", anchor: { atMs: 1300 }, durationMs: 300, props: { asset: "m" } };
  const p = parseProject({ ...projectInput(), elements: [...(projectInput().elements ?? []), front] });
  const s = parseStyle(JSON.parse(readFileSync(join(dir, "style.json"), "utf8")));
  if (!p.ok || !s.ok) throw new Error("modes project is invalid");
  const timeline = resolve(p.value, s.value);
  const plan = planMedia(dir, p.value, timeline);
  serveUrl = await bundleWithMedia(plan, join(dir, "renders", ".bundle"));
  props = { timeline, media: plan.media, fonts: plan.fonts };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function rgba(p: RenderProps, frame: number, x: number, y: number): Promise<number[]> {
  const out = join(dir, `mode-${++shots}.png`);
  await renderFrame(serveUrl, p, frame, out);
  const png = PNG.sync.read(readFileSync(out));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

describe("render modes", () => {
  it("bake mode keeps the take and leaves out front elements", async () => {
    const full = await rgba(props, 40, 50, 50);
    const bake = await rgba({ ...props, mode: { kind: "bake" } }, 40, 50, 50);
    expect(full[0]! > 200 && full[1]! < 60 && full[2]! > 200, `full shows the front image, got ${full}`).toBe(true);
    expect(bake[0]! > 200 && bake[1]! < 60 && bake[2]! < 60, `bake shows the red take, got ${bake}`).toBe(true);
  });

  it("overlay mode draws only the listed elements, on a transparent background", async () => {
    const listed = await rgba({ ...props, mode: { kind: "overlay", elements: ["front"] } }, 40, 50, 50);
    const none = await rgba({ ...props, mode: { kind: "overlay", elements: [] } }, 40, 50, 50);
    expect(listed[3], `the listed element is opaque, got ${listed}`).toBe(255);
    expect(listed[0]! > 200 && listed[2]! > 200, `the listed element is magenta, got ${listed}`).toBe(true);
    expect(none[3], `nothing listed leaves the frame transparent, got ${none}`).toBe(0);
  });

  it("renders a transparent overlay as ProRes 4444 with alpha", async () => {
    const out = join(dir, "overlay.mov");
    await renderVideo(serveUrl, { ...props, mode: { kind: "overlay", elements: ["front"] } }, out, [39, 47], { transparent: true });
    const info = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", out], { encoding: "utf8" }),
    ) as { streams: { codec_name: string; pix_fmt: string }[] };
    expect(info.streams[0]!.codec_name).toBe("prores");
    expect(info.streams[0]!.pix_fmt).toMatch(/^yuva444/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:e2e -w @adam-studio/render`
Expected: the 3 new tests FAIL (bake mode still shows the magenta image, overlay mode has a black opaque background, the MOV is H.264); the other 9 end-to-end tests PASS.

- [ ] **Step 3: Implement the modes**

In `packages/render/src/props.ts`, add after `MediaFiles`:
```ts
/**
 * What to draw: everything (preview and export), the main track only (stretches baked for CapCut: clips,
 * behind-subject elements, subject and clip audio, ungraded), or chosen front elements on a transparent
 * background (CapCut overlays).
 */
export type RenderMode = { kind: "full" } | { kind: "bake" } | { kind: "overlay"; elements: string[] };
```
and replace `RenderProps` with:
```ts
export type RenderProps = {
  timeline: Timeline;
  media: Record<string, MediaFiles>;
  fonts: { caption: string; title: string };
  mode?: RenderMode;
};
```

Replace `packages/render/src/Edit.tsx` with:
```tsx
import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { AudioLayer } from "./components/AudioLayer";
import { Captions } from "./components/Captions";
import { ClipLayer } from "./components/ClipLayer";
import { ElementLayer } from "./components/ElementLayer";
import { SubjectLayer } from "./components/SubjectLayer";
import { ensureFonts } from "./fonts";
import { GRADE_FILTER_ID, gradeFilter, vignetteBackground, warmthMatrix } from "./lib/grade";
import { slideWindows, subjectWindows } from "./lib/subject";
import type { RenderProps } from "./props";

export const Edit: FC<RenderProps> = (props) => {
  ensureFonts(props.fonts);
  const { timeline, media } = props;
  const mode = props.mode ?? { kind: "full" };
  if (mode.kind === "overlay") {
    // Transparent background, only the listed front elements: a CapCut overlay.
    return (
      <AbsoluteFill>
        <ElementLayer timeline={timeline} media={media} layer="front" only={mode.elements} />
      </AbsoluteFill>
    );
  }
  const full = mode.kind === "full";
  const grade = timeline.style.grade;
  // Baked stretches stay ungraded: CapCut grades the whole main track, baked or native.
  const filter = full ? gradeFilter(grade, GRADE_FILTER_ID) : "none";
  const slides = slideWindows(timeline);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={GRADE_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={warmthMatrix(grade.warmth).join(" ")} />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter }}>
        <ClipLayer timeline={timeline} media={media} slides={slides} />
      </AbsoluteFill>
      <ElementLayer timeline={timeline} media={media} layer="behind-subject" />
      <AbsoluteFill style={{ filter }}>
        <SubjectLayer timeline={timeline} media={media} windows={subjectWindows(timeline)} slides={slides} />
      </AbsoluteFill>
      {full && grade.vignette > 0 ? <AbsoluteFill style={{ background: vignetteBackground(grade.vignette) }} /> : null}
      {full ? <ElementLayer timeline={timeline} media={media} layer="front" /> : null}
      {full ? <Captions timeline={timeline} /> : null}
      <AudioLayer timeline={timeline} media={media} clipAudioOnly={!full} />
    </AbsoluteFill>
  );
};
```

Replace `packages/render/src/components/ElementLayer.tsx` with:
```tsx
import type { FC } from "react";
import { Sequence } from "remotion";
import type { Timeline, TimelineElement } from "@adam-studio/model";
import type { MediaFiles } from "../props";
import { BigWord } from "./BigWord";
import { ImageElement } from "./ImageElement";
import { Title } from "./Title";

/** The elements of one layer; `only` keeps the listed element ids (CapCut overlays). */
export const ElementLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; layer: "front" | "behind-subject"; only?: string[] }> = ({
  timeline, media, layer, only,
}) => (
  <>
    {timeline.elements
      .filter((e) => e.layer === layer && (!only || only.includes(e.id)))
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

Replace `packages/render/src/components/AudioLayer.tsx` with:
```tsx
import type { FC } from "react";
import { Html5Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Timeline, TimelineAudio } from "@adam-studio/model";
import { audioVolume } from "../lib/audio";
import type { MediaFiles } from "../props";

/** Clip audio and sound effects; `clipAudioOnly` leaves the sound effects to CapCut (baked stretches). */
export const AudioLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; clipAudioOnly?: boolean }> = ({ timeline, media, clipAudioOnly }) => (
  <>
    {timeline.audio
      .filter((a) => !clipAudioOnly || a.id.startsWith("clip:"))
      .map((a) => {
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

In `packages/render/src/engine.ts`, replace the whole `renderVideo` function with:
```ts
export async function renderVideo(
  serveUrl: string,
  props: RenderProps,
  outFile: string,
  frameRange: number | [number, number] | [number, number][] | null = null,
  opts: { transparent?: boolean } = {},
): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  const concurrency = safeConcurrency({
    freeBytes: freemem(), cores: cpus().length, width: composition.width, height: composition.height, fps: composition.fps,
    videoSources: activeVideoSources(props.timeline),
  });
  // Decision 0001: CapCut keeps the alpha of MOV ProRes 4444 (and ignores it in WebM).
  const output = opts.transparent
    ? ({ codec: "prores", proResProfile: "4444", pixelFormat: "yuva444p10le", imageFormat: "png", muted: true } as const)
    : ({ codec: "h264" } as const);
  await renderMedia({ composition, serveUrl, outputLocation: outFile, inputProps: props, frameRange, concurrency, ...output });
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test:e2e -w @adam-studio/render`, `npm test -w @adam-studio/render`, then `npm run typecheck -w @adam-studio/render`
Expected: 12 end-to-end tests PASS, 60 unit tests PASS, typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): bake and overlay render modes, transparent ProRes 4444 output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: What CapCut cannot do natively (`planCapcut`)

**Files:**
- Create: `packages/render/src/lib/capcut.ts`
- Test: `packages/render/tests/unit/capcut.test.ts`

**Interfaces:**
- Consumes: `Timeline` (model), `subjectWindows` (`src/lib/subject.ts`), `timelineOf` and `projectInput` (tests/unit/helpers.ts).
- Produces: `type ReportEntry = { id; kind; status: "native" | "baked" | "skipped"; reason }`, `type CapcutBake = { id; fromFrame; toFrame }` (half-open), `type CapcutOverlay = { elementId; fromFrame; durationFrames }`, `type CapcutPlan = { bakes; overlays; entries }`, `planCapcut(timeline): CapcutPlan`. Bake ids are `b01`, `b02`... in time order.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/unit/capcut.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { planCapcut } from "../../src/lib/capcut";
import { timelineOf } from "./helpers";

const title = {
  id: "t", kind: "title", anchor: { atMs: 2500 }, durationMs: 500,
  props: { phases: [{ startMs: 0, endMs: 500, lines: [{ text: "HELLO" }] }] },
};

describe("planCapcut", () => {
  it("bakes subject windows, merging the two halves of a slide, and reports why", () => {
    const plan = planCapcut(timelineOf());
    expect(plan.bakes).toEqual([
      { id: "b01", fromFrame: 9, toFrame: 27 },
      { id: "b02", fromFrame: 53, toFrame: 71 },
    ]);
    expect(plan.overlays).toEqual([]);
    expect(plan.entries.map((e) => [e.id, e.status])).toEqual([
      ["transition:c1", "baked"],
      ["behind", "baked"],
    ]);
  });

  it("turns front titles into transparent overlays", () => {
    const plan = planCapcut(timelineOf({ elements: [title] }));
    expect(plan.overlays).toEqual([{ elementId: "t", fromFrame: 75, durationFrames: 15 }]);
    expect(plan.bakes).toEqual([{ id: "b01", fromFrame: 53, toFrame: 71 }]);
    expect(plan.entries.find((e) => e.id === "t")).toEqual({
      id: "t", kind: "title", status: "baked", reason: "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)",
    });
  });

  it("bakes split clips and leaves crossfades to the creator", () => {
    const plan = planCapcut(timelineOf({
      story: [
        { id: "c1", asset: "s", inMs: 0, outMs: 2000, transitionOut: { kind: "crossfade", durationMs: 300 } },
        { id: "c2", asset: "s", inMs: 2000, outMs: 4000, framing: { mode: "split", asset: "s" } },
      ],
      elements: [],
    }));
    expect(plan.bakes).toEqual([{ id: "b01", fromFrame: 60, toFrame: 120 }]);
    expect(plan.entries.map((e) => [e.id, e.status])).toEqual([
      ["transition:c1", "skipped"],
      ["clip:c2", "baked"],
    ]);
  });
});
```

Expected values: the behind-subject image covers frames 9 to 27; the slide-out of c1 (53 to 60) and the slide-in of c2 (60 to 71) touch and merge into 53 to 71. The title at 2500 ms for 500 ms covers frames 75 to 90.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/lib/capcut`.

- [ ] **Step 3: Implement**

`packages/render/src/lib/capcut.ts`:
```ts
import type { Timeline } from "@adam-studio/model";
import { subjectWindows } from "./subject";

export type ReportStatus = "native" | "baked" | "skipped";
export type ReportEntry = { id: string; kind: string; status: ReportStatus; reason: string };
/** A stretch of the main track rendered by Remotion, frames [fromFrame, toFrame). */
export type CapcutBake = { id: string; fromFrame: number; toFrame: number };
export type CapcutOverlay = { elementId: string; fromFrame: number; durationFrames: number };
export type CapcutPlan = { bakes: CapcutBake[]; overlays: CapcutOverlay[]; entries: ReportEntry[] };

/** Front element kinds without a native CapCut equivalent: exported as transparent overlays. */
const OVERLAY_KINDS = new Set(["title", "text.behindSubject"]);

/** What the CapCut exporter cannot do natively, and the report entries explaining it. */
export function planCapcut(timeline: Timeline): CapcutPlan {
  const entries: ReportEntry[] = [];
  const ranges: [number, number][] = subjectWindows(timeline).map((w) => [w.fromFrame, w.toFrame]);
  for (const c of timeline.clips) {
    if (c.framing.mode === "split") {
      ranges.push([c.fromFrame, c.fromFrame + c.durationFrames]);
      entries.push({ id: `clip:${c.id}`, kind: "clip", status: "baked", reason: "split framing is rendered by Remotion" });
    }
    if (c.transitionOut.kind === "subjectSlide") {
      entries.push({ id: `transition:${c.id}`, kind: "subjectSlide", status: "baked", reason: "person-only slide, baked into the main track" });
    }
    if (c.transitionOut.kind === "crossfade") {
      entries.push({ id: `transition:${c.id}`, kind: "crossfade", status: "skipped", reason: "crossfades are added by hand in CapCut" });
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const bakes = merged.map(([fromFrame, toFrame], i) => ({ id: `b${String(i + 1).padStart(2, "0")}`, fromFrame, toFrame }));
  const overlays: CapcutOverlay[] = [];
  for (const e of timeline.elements) {
    if (e.layer === "behind-subject") {
      entries.push({ id: e.id, kind: e.kind, status: "baked", reason: "drawn behind the subject, baked into the main track" });
    } else if (OVERLAY_KINDS.has(e.kind)) {
      overlays.push({ elementId: e.id, fromFrame: e.fromFrame, durationFrames: e.durationFrames });
      entries.push({ id: e.id, kind: e.kind, status: "baked", reason: "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)" });
    }
  }
  return { bakes, overlays, entries };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS (63 unit tests); typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): plan what the CapCut export bakes or overlays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `adam capcut-prep`

**Files:**
- Create: `packages/render/src/commands/capcut.ts`
- Modify: `packages/render/src/commands/render.ts` (extract `lintGate`), `packages/render/src/cli.ts`
- Test: `packages/render/tests/e2e/capcut-prep.test.ts`

**Interfaces:**
- Consumes: `planCapcut` (Task 2), `renderVideo` with `mode` and `transparent` (Task 1), `bundleWithMedia`, `planMedia`, `loadProject`, `makeSynthetic`.
- Produces: `lintGate(project, timeline, dir, force, action: "render" | "export")` in `commands/render.ts`; `capcutPrepCommand(projectDir, { out?, force }): Promise<string>` returning the prep folder (default `<project>/renders/capcut`); CLI `npm run adam -- capcut-prep <dir> [--out folder] [--force]`. The prep folder holds `timeline.json` (resolved timeline), `capcut-plan.json`, `bake/<id>.mp4`, `overlay/oNN.mov`. `capcut-plan.json` is:
  `{ name, width, height, fps, bakes: [{ id, fromFrame, toFrame, file }], overlays: [{ elementId, fromFrame, durationFrames, file }], entries: ReportEntry[], sources: { [assetId]: { video?, file?, width?, height? } } (absolute paths), fonts: { caption: { path, family, resourceId }, title: {...} } }` (`resourceId` is `null` when the style has no `capcutResourceId`; file paths in `bakes` and `overlays` are relative to the prep folder).

- [ ] **Step 1: Write the failing test**

`packages/render/tests/e2e/capcut-prep.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { capcutPrepCommand } from "../../src/commands/capcut";
import { makeSynthetic } from "./synthetic";

const ffprobe = (args: string[]) => execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8" }).trim();
const frames = (f: string) => Number(ffprobe(["-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", f]));
const pixFmt = (f: string) => ffprobe(["-select_streams", "v", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", f]);
const hasAudio = (f: string) => ffprobe(["-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", f]) === "audio";

describe("adam capcut-prep", () => {
  it("renders baked stretches and overlays, and writes the plan for the exporter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam capcut-"));
    makeSynthetic(dir);
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    project.elements.push({
      id: "t1", kind: "title", anchor: { atMs: 2500 }, durationMs: 500,
      props: { phases: [{ startMs: 0, endMs: 500, lines: [{ text: "HELLO" }] }] },
    });
    writeFileSync(join(dir, "project.json"), JSON.stringify(project));

    const out = await capcutPrepCommand(dir, { force: false });
    expect(out).toBe(join(dir, "renders", "capcut"));
    const plan = JSON.parse(readFileSync(join(out, "capcut-plan.json"), "utf8"));
    expect(plan.bakes.map((b: { id: string; fromFrame: number; toFrame: number; file: string }) => [b.id, b.fromFrame, b.toFrame, b.file])).toEqual([
      ["b01", 9, 27, "bake/b01.mp4"],
      ["b02", 53, 71, "bake/b02.mp4"],
    ]);
    expect(plan.overlays).toEqual([{ elementId: "t1", fromFrame: 75, durationFrames: 15, file: "overlay/o01.mov" }]);
    expect(plan.entries.map((e: { id: string }) => e.id)).toEqual(["transition:c1", "behind", "t1"]);
    expect(frames(join(out, "bake", "b01.mp4"))).toBe(18);
    expect(hasAudio(join(out, "bake", "b01.mp4"))).toBe(true);
    expect(pixFmt(join(out, "overlay", "o01.mov"))).toMatch(/^yuva444/);
    expect(existsSync(plan.sources.s.video)).toBe(true);
    expect(isAbsolute(plan.sources.m.file)).toBe(true);
    expect(existsSync(plan.fonts.caption.path)).toBe(true);
    expect(plan.fonts.caption.resourceId).toBeNull();
    expect(JSON.parse(readFileSync(join(out, "timeline.json"), "utf8")).durationFrames).toBe(120);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses while proposals are pending, unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam capcut-"));
    makeSynthetic(dir, { withProposal: true });
    await expect(capcutPrepCommand(dir, { force: false })).rejects.toThrow("Refusing to export");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:e2e -w @adam-studio/render`
Expected: `capcut-prep.test.ts` FAILS (cannot resolve `../../src/commands/capcut`); the other end-to-end tests PASS.

- [ ] **Step 3: Extract the lint gate**

In `packages/render/src/commands/render.ts`, replace these lines of `renderCommand`:
```ts
  const warnings = lint(project, timeline, { projectDir: dir, fileExists: existsSync });
  for (const w of warnings) console.log(`${w.severity === "error" ? "ERROR" : "warn "} ${w.rule}: ${w.message}`);
  if (warnings.some((w) => w.severity === "error") && !opts.force) {
    throw new CliError("Refusing to render: fix the errors above, or pass --force.");
  }
```
with:
```ts
  lintGate(project, timeline, dir, opts.force, "render");
```
add this function after `fileSafeName`:
```ts
/** Prints the lint warnings and refuses to go on while any is an error, unless forced. */
export function lintGate(project: Project, timeline: Timeline, dir: string, force: boolean, action: "render" | "export"): void {
  const warnings = lint(project, timeline, { projectDir: dir, fileExists: existsSync });
  for (const w of warnings) console.log(`${w.severity === "error" ? "ERROR" : "warn "} ${w.rule}: ${w.message}`);
  if (warnings.some((w) => w.severity === "error") && !force) {
    throw new CliError(`Refusing to ${action}: fix the errors above, or pass --force.`);
  }
}
```
and change the model import to:
```ts
import { lint, resolve, type Project, type Timeline } from "@adam-studio/model";
```

- [ ] **Step 4: Implement the prepare command**

`packages/render/src/commands/capcut.ts`:
```ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { resolve } from "@adam-studio/model";
import { bundleWithMedia, renderVideo } from "../engine";
import { planCapcut } from "../lib/capcut";
import { planMedia, type MediaPlan } from "../media";
import { loadProject } from "../project-io";
import { lintGate } from "./render";

type Source = { video?: string; file?: string; width?: number; height?: number };

/** Absolute source files per asset: the CapCut exporter copies them into the CapCut project. */
export function capcutSources(plan: MediaPlan): Record<string, Source> {
  const byPublic = new Map(plan.files.map((f) => [f.to, f.from]));
  const out: Record<string, Source> = {};
  for (const [id, m] of Object.entries(plan.media)) {
    const s: Source = {};
    if (m.video) s.video = byPublic.get(m.video);
    if (m.file) s.file = byPublic.get(m.file);
    if (m.width && m.height) {
      s.width = m.width;
      s.height = m.height;
    }
    out[id] = s;
  }
  return out;
}

/** Renders what CapCut cannot do natively and writes the plan the Python exporter reads. */
export async function capcutPrepCommand(projectDir: string, opts: { out?: string; force: boolean }): Promise<string> {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  lintGate(project, timeline, dir, opts.force, "export");
  const media = planMedia(dir, project, timeline);
  const plan = planCapcut(timeline);
  const out = opts.out ? resolvePath(opts.out) : join(dir, "renders", "capcut");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "bake"), { recursive: true });
  mkdirSync(join(out, "overlay"), { recursive: true });
  const bakes = plan.bakes.map((b) => ({ ...b, file: `bake/${b.id}.mp4` }));
  const overlays = plan.overlays.map((o, i) => ({ ...o, file: `overlay/o${String(i + 1).padStart(2, "0")}.mov` }));
  if (bakes.length > 0 || overlays.length > 0) {
    const serveUrl = await bundleWithMedia(media, join(dir, "renders", ".bundle"));
    const base = { timeline, media: media.media, fonts: media.fonts };
    for (const b of bakes) {
      await renderVideo(serveUrl, { ...base, mode: { kind: "bake" } }, join(out, b.file), [b.fromFrame, b.toFrame - 1]);
      console.log(`baked ${b.file} (frames ${b.fromFrame} to ${b.toFrame - 1})`);
    }
    for (const o of overlays) {
      const range: [number, number] = [o.fromFrame, o.fromFrame + o.durationFrames - 1];
      await renderVideo(serveUrl, { ...base, mode: { kind: "overlay", elements: [o.elementId] } }, join(out, o.file), range, { transparent: true });
      console.log(`overlay ${o.file} for element "${o.elementId}"`);
    }
  }
  const byPublic = new Map(media.files.map((f) => [f.to, f.from]));
  const font = (key: "caption" | "title") => ({
    path: byPublic.get(media.fonts[key]),
    family: timeline.style.fonts[key].family,
    resourceId: timeline.style.fonts[key].capcutResourceId ?? null,
  });
  writeFileSync(join(out, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
  const capcutPlan = {
    name: project.name, width: timeline.width, height: timeline.height, fps: timeline.fps,
    bakes, overlays, entries: plan.entries, sources: capcutSources(media),
    fonts: { caption: font("caption"), title: font("title") },
  };
  writeFileSync(join(out, "capcut-plan.json"), `${JSON.stringify(capcutPlan, null, 2)}\n`);
  console.log(`CapCut material ready: ${out}`);
  return out;
}
```

In `packages/render/src/cli.ts`, add the import:
```ts
import { capcutPrepCommand } from "./commands/capcut";
```
add this line at the end of the `USAGE` string (before the closing backtick):
```
  capcut-prep <dir> [--out folder] [--force]
```
and add this case before `default:`:
```ts
    case "capcut-prep":
      await capcutPrepCommand(dir, { out: values.out ? resolve(base, values.out) : undefined, force: values.force ?? false });
      return;
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm run test:e2e -w @adam-studio/render`, `npm test -w @adam-studio/render`, then `npm run typecheck -w @adam-studio/render`
Expected: 14 end-to-end tests PASS (the render test still refuses with "Refusing to render"), 63 unit tests PASS, typecheck exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/render
git commit -m "feat(render): adam capcut-prep renders baked stretches and overlays for the CapCut exporter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Python package and unit conversions

**Files:**
- Create: `py/capcut/pyproject.toml`, `py/capcut/adam_capcut/__init__.py`, `py/capcut/adam_capcut/errors.py`, `py/capcut/adam_capcut/units.py`
- Modify: `.gitignore`
- Test: `py/capcut/tests/test_units.py`

**Interfaces:**
- Produces: `ExportError(Exception)`; in `units.py`: `US`, `frame_us(frame, fps)`, `span_us(from_frame, to_frame, fps) -> (start, duration)`, `ms_us(ms)`, `hex_rgb(color) -> (r, g, b)` in 0..1, `place(x, y) -> (tx, ty)`, `fit_factor(source, canvas)`, `cover_scale(source, canvas)`, `crop_rect_at(framing, source_ms) -> dict`, `crop_transform(rect, source, canvas, zoom=1.0) -> (scale, tx, ty)`, `image_scale(size, canvas)`, `zoom_at(zoom, elapsed_ms)`, `safe_name(name)`. Sizes are `(width, height)` tuples; rects are `{"x", "y", "w", "h"}` dicts.

- [ ] **Step 1: Create the package and the venv**

`py/capcut/pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "adam-capcut"
version = "0.1.0"
description = "Adam Studio CapCut exporter"
requires-python = ">=3.12"
dependencies = ["imageio==2.38.1"]

[project.optional-dependencies]
dev = ["pytest==9.0.3"]

[tool.setuptools]
packages = ["adam_capcut"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["e2e: runs the TypeScript prepare step and Remotion (slow)"]
addopts = "-m 'not e2e'"
```

`py/capcut/adam_capcut/__init__.py`:
```python
"""Adam Studio CapCut exporter: python -m adam_capcut export <projectDir>."""
```

`py/capcut/adam_capcut/errors.py`:
```python
class ExportError(Exception):
    """A refusal or a missing input, shown to the creator as is (no traceback)."""
```

Append to the root `.gitignore`:
```
.venv/
*.egg-info/
```

Run: `python -m venv py/capcut/.venv` then `py/capcut/.venv/Scripts/python -m pip install -e "py/capcut[dev]"`
Expected: both exit code 0; `py/capcut/.venv/Scripts/python -m pytest --version` prints `pytest 9.0.3`.

- [ ] **Step 2: Write the failing test**

`py/capcut/tests/test_units.py`:
```python
import pytest

from adam_capcut.units import (
    cover_scale, crop_rect_at, crop_transform, frame_us, hex_rgb, image_scale, ms_us, place, safe_name, span_us, zoom_at,
)

PORTRAIT = (1080, 1920)
LANDSCAPE = (1920, 1080)


def test_times_come_from_accumulated_frames():
    assert frame_us(1, 30) == 33333
    assert span_us(9, 27, 30) == (300000, 600000)
    assert span_us(27, 53, 30) == (900000, 866667)
    assert ms_us(150) == 150000


def test_colors_and_positions():
    assert hex_rgb("#FFD100") == pytest.approx((1.0, 209 / 255, 0.0))
    # The lab's captions sat at transform_y -0.52: the style's caption slot y = 0.76.
    assert place(0.5, 0.76) == pytest.approx((0.0, -0.52))
    assert place(0.0, 0.0) == pytest.approx((-1.0, 1.0))


def test_cover_scale_is_relative_to_capcut_fit():
    assert cover_scale(PORTRAIT, PORTRAIT) == 1
    assert cover_scale(LANDSCAPE, PORTRAIT) == pytest.approx((1920 / 1080) / (1080 / 1920))


def test_crop_transform_matches_the_renderer_crop_box():
    assert crop_transform({"x": 0, "y": 0, "w": 1, "h": 1}, PORTRAIT, PORTRAIT) == pytest.approx((1.0, 0.0, 0.0))
    assert crop_transform({"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}, PORTRAIT, PORTRAIT) == pytest.approx((2.0, 0.0, 0.0))
    # Right part of a 16:9 screen recording in a 9:16 canvas (renderer: box left -2160, width 4320).
    rect = {"x": 0.5, "y": 0, "w": 0.25, "h": 1}
    assert crop_transform(rect, LANDSCAPE, PORTRAIT) == pytest.approx((4.0, -1.0, 0.0))
    assert crop_transform(rect, LANDSCAPE, PORTRAIT, zoom=1.1) == pytest.approx((4.4, -1.1, 0.0))


def test_crop_rect_follows_keyframes_in_source_time():
    framing = {"mode": "crop", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}, "keyframes": [{"atMs": 1000, "rect": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]}
    assert crop_rect_at(framing, 500) == pytest.approx({"x": 0.125, "y": 0.125, "w": 0.75, "h": 0.75})
    assert crop_rect_at(framing, 2000) == {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}


def test_image_scale_matches_the_renderer_natural_size_capped_at_90_percent():
    assert image_scale(PORTRAIT, PORTRAIT) == pytest.approx(0.9)
    assert image_scale((540, 540), PORTRAIT) == pytest.approx(0.5)


def test_zoom_drift():
    assert zoom_at({"base": 1.08, "driftPerSec": 0.004}, 2500) == pytest.approx(1.09)


def test_safe_name_matches_the_renderer():
    assert safe_name("Épisode 3 : Jobless") == "Épisode 3 - Jobless"
    assert safe_name(r'a/b\c*d?e"f<g>h|i') == "a-b-c-d-e-f-g-h-i"
    assert safe_name("...") == "edit"
    assert safe_name("final. ") == "final"
```

Expected values: frame 53 at 30 fps is 1766666.7 µs, rounded to 1766667, so frames 27 to 53 last 866667 µs. A 540x540 image fits a 1080x1920 canvas at factor 2 in CapCut, while the renderer shows it at its natural size, so the CapCut scale is 0.5.

- [ ] **Step 3: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_capcut.units'`.

- [ ] **Step 4: Implement**

`py/capcut/adam_capcut/units.py`:
```python
"""Conversions from the resolved timeline (frames, normalized positions) to CapCut (microseconds,
half-canvas offsets from the center with +Y up, scales relative to CapCut's fit-to-canvas size)."""
import re

US = 1_000_000


def frame_us(frame: int, fps: int) -> int:
    return round(frame * US / fps)


def span_us(from_frame: int, to_frame: int, fps: int) -> tuple[int, int]:
    """Start and duration of frames [from_frame, to_frame), from accumulated positions (no drift)."""
    start = frame_us(from_frame, fps)
    return start, frame_us(to_frame, fps) - start


def ms_us(ms: float) -> int:
    return round(ms * 1000)


def hex_rgb(color: str) -> tuple[float, float, float]:
    c = color.lstrip("#")
    return int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255


def place(x: float, y: float) -> tuple[float, float]:
    """A normalized canvas point (0, 0 at the top left) as a CapCut transform."""
    return (x - 0.5) * 2, (0.5 - y) * 2


def fit_factor(source: tuple[int, int], canvas: tuple[int, int]) -> float:
    """How CapCut sizes media at scale 1: fitted inside the canvas."""
    return min(canvas[0] / source[0], canvas[1] / source[1])


def cover_scale(source: tuple[int, int], canvas: tuple[int, int]) -> float:
    return max(canvas[0] / source[0], canvas[1] / source[1]) / fit_factor(source, canvas)


def crop_rect_at(framing: dict, source_ms: float) -> dict:
    """Crop rect at a source time: `rect` at 0, keyframes in source time, linear, held after the last (renderer cropRectAt)."""
    points = sorted([{"atMs": 0, "rect": framing["rect"]}, *framing.get("keyframes", [])], key=lambda p: p["atMs"])
    prev = points[0]
    for p in points[1:]:
        if source_ms < p["atMs"]:
            t = min(1.0, max(0.0, (source_ms - prev["atMs"]) / max(1, p["atMs"] - prev["atMs"])))
            return {k: prev["rect"][k] + (p["rect"][k] - prev["rect"][k]) * t for k in ("x", "y", "w", "h")}
        prev = p
    return prev["rect"]


def crop_transform(rect: dict, source: tuple[int, int], canvas: tuple[int, int], zoom: float = 1.0) -> tuple[float, float, float]:
    """CapCut scale and position so the normalized source rect covers the canvas, centered (the renderer's
    cropBox), then zoomed about the canvas center."""
    sw, sh = source
    cw, ch = canvas
    s = max(cw / (rect["w"] * sw), ch / (rect["h"] * sh))
    dx = sw * s * (0.5 - (rect["x"] + rect["w"] / 2))
    dy = sh * s * (0.5 - (rect["y"] + rect["h"] / 2))
    return s / fit_factor(source, canvas) * zoom, dx * zoom / (cw / 2), -dy * zoom / (ch / 2)


def image_scale(size: tuple[int, int], canvas: tuple[int, int]) -> float:
    """CapCut scale of an image the renderer draws at its natural size, capped at 90% of the canvas."""
    w, h = size
    cw, ch = canvas
    shown = min(1.0, 0.9 * cw / w, 0.9 * ch / h)
    return shown / fit_factor(size, canvas)


def zoom_at(zoom: dict, elapsed_ms: float) -> float:
    return zoom["base"] + zoom["driftPerSec"] * elapsed_ms / 1000


_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(name: str) -> str:
    """The renderer's fileSafeName: characters Windows forbids become "-" (a ":" would write an NTFS stream)."""
    return _FORBIDDEN.sub("-", name).rstrip(". ").strip() or "edit"
```

- [ ] **Step 5: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore py/capcut
git commit -m "feat(capcut): Python package and CapCut unit conversions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Main track layout and track allocation

**Files:**
- Create: `py/capcut/adam_capcut/layout.py`, `py/capcut/adam_capcut/tracks.py`
- Test: `py/capcut/tests/test_layout.py`

**Interfaces:**
- Consumes: the timeline dict (`timeline.json` from Task 3) and the plan's `bakes`.
- Produces: `main_track(timeline, bakes) -> list[dict]`, parts in time order, each `{"kind": "clip", "clip": clip, "from": f, "to": t}` or `{"kind": "bake", "bake": bake}`; `part_frames(part) -> (from, to)`; `allocate(spans) -> list[int]` (spans sorted by start; track index per span, lowest first).

- [ ] **Step 1: Write the failing test**

`py/capcut/tests/test_layout.py`:
```python
from adam_capcut.layout import main_track, part_frames
from adam_capcut.tracks import allocate

CLIPS = {"clips": [{"id": "c1", "fromFrame": 0, "durationFrames": 60}, {"id": "c2", "fromFrame": 60, "durationFrames": 60}]}
BAKES = [{"id": "b01", "fromFrame": 9, "toFrame": 27}, {"id": "b02", "fromFrame": 53, "toFrame": 71}]


def describe(parts):
    return [(p["clip"]["id"] if p["kind"] == "clip" else p["bake"]["id"], *part_frames(p)) for p in parts]


def test_native_parts_surround_each_bake_once():
    assert describe(main_track(CLIPS, BAKES)) == [
        ("c1", 0, 9), ("b01", 9, 27), ("c1", 27, 53), ("b02", 53, 71), ("c2", 71, 120),
    ]


def test_parts_cover_the_timeline_without_gaps():
    frames = [part_frames(p) for p in main_track(CLIPS, BAKES)]
    assert frames[0][0] == 0 and frames[-1][1] == 120
    assert all(a[1] == b[0] for a, b in zip(frames, frames[1:]))


def test_a_bake_can_cover_a_whole_clip():
    assert describe(main_track(CLIPS, [{"id": "b01", "fromFrame": 60, "toFrame": 120}])) == [("c1", 0, 60), ("b01", 60, 120)]


def test_no_bakes_gives_one_part_per_clip():
    assert describe(main_track(CLIPS, [])) == [("c1", 0, 60), ("c2", 60, 120)]


def test_overlapping_spans_get_their_own_tracks():
    assert allocate([(0, 10), (5, 15), (10, 20), (12, 13)]) == [0, 1, 0, 2]
    assert allocate([]) == []
```

- [ ] **Step 2: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_capcut.layout'`.

- [ ] **Step 3: Implement**

`py/capcut/adam_capcut/layout.py`:
```python
"""The CapCut main track: native clip parts around the stretches Remotion baked."""


def main_track(timeline: dict, bakes: list[dict]) -> list[dict]:
    """Parts in time order, each bake once: {"kind": "clip", "clip", "from", "to"} or {"kind": "bake", "bake"}."""
    parts: list[dict] = []
    emitted: set[str] = set()
    ordered = sorted(bakes, key=lambda b: b["fromFrame"])
    for clip in timeline["clips"]:
        start, end = clip["fromFrame"], clip["fromFrame"] + clip["durationFrames"]
        cursor = start
        for b in ordered:
            if b["toFrame"] <= cursor or b["fromFrame"] >= end:
                continue
            if b["fromFrame"] > cursor:
                parts.append({"kind": "clip", "clip": clip, "from": cursor, "to": b["fromFrame"]})
            if b["id"] not in emitted:
                parts.append({"kind": "bake", "bake": b})
                emitted.add(b["id"])
            cursor = min(end, b["toFrame"])
        if cursor < end:
            parts.append({"kind": "clip", "clip": clip, "from": cursor, "to": end})
    return parts


def part_frames(part: dict) -> tuple[int, int]:
    if part["kind"] == "clip":
        return part["from"], part["to"]
    return part["bake"]["fromFrame"], part["bake"]["toFrame"]
```

`py/capcut/adam_capcut/tracks.py`:
```python
def allocate(spans: list[tuple[int, int]]) -> list[int]:
    """Track index for each (start, end) span, spans sorted by start: spans on one track never overlap."""
    ends: list[int] = []
    out: list[int] = []
    for start, end in spans:
        for i, e in enumerate(ends):
            if e <= start:
                ends[i] = end
                out.append(i)
                break
        else:
            ends.append(end)
            out.append(len(ends) - 1)
    return out
```

- [ ] **Step 4: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add py/capcut
git commit -m "feat(capcut): main track parts around baked stretches, track allocation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Project folder safety and the lab

**Files:**
- Create: `py/capcut/adam_capcut/folder.py`, `py/capcut/adam_capcut/lab.py`
- Test: `py/capcut/tests/test_folder.py`

**Interfaces:**
- Consumes: `ExportError` (Task 4).
- Produces: `MARKER = ".adam_studio_export"`, `default_projects_root() -> Path`, `prepare_project_dir(root, name, template) -> Path` (creates `<root>/<name>` from the template with the marker and an empty `media/`); `lab_path() -> Path`, `load_lab() -> (pyJianYingDraft, draft_profiles)`.

- [ ] **Step 1: Write the failing test**

`py/capcut/tests/test_folder.py`:
```python
import pytest

from adam_capcut.errors import ExportError
from adam_capcut.folder import MARKER, prepare_project_dir
from adam_capcut.lab import lab_path, load_lab


@pytest.fixture
def template(tmp_path):
    t = tmp_path / "template"
    t.mkdir()
    (t / "draft_meta_info.json").write_text("{}")
    return t


def test_creates_the_project_from_the_template_with_the_marker(tmp_path, template):
    dest = prepare_project_dir(tmp_path / "projects", "demo", template)
    assert (dest / MARKER).exists() and (dest / "draft_meta_info.json").exists() and (dest / "media").is_dir()


def test_rebuilds_its_own_project(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / "media" / "old.mp4").write_text("x")
    dest = prepare_project_dir(tmp_path, "demo", template)
    assert not (dest / "media" / "old.mp4").exists()


def test_never_touches_a_project_it_did_not_create(tmp_path, template):
    mine = tmp_path / "demo"
    mine.mkdir()
    (mine / "keep.txt").write_text("x")
    with pytest.raises(ExportError, match="was not created by Adam Studio"):
        prepare_project_dir(tmp_path, "demo", template)
    assert (mine / "keep.txt").read_text() == "x"


def test_refuses_a_project_open_in_capcut(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / ".locked").touch()
    with pytest.raises(ExportError, match="is open in CapCut"):
        prepare_project_dir(tmp_path, "demo", template)
    assert (dest / ".locked").exists()


def test_names_the_lab_setting_when_pyjianyingdraft_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("ADAM_CAPCUT_LAB", str(tmp_path))
    assert lab_path() == tmp_path
    with pytest.raises(ExportError, match="ADAM_CAPCUT_LAB"):
        load_lab()
```

- [ ] **Step 2: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_capcut.folder'`.

- [ ] **Step 3: Implement**

`py/capcut/adam_capcut/folder.py`:
```python
"""The CapCut project folder, with the safety rules carried over from the lab."""
import os
import shutil
from pathlib import Path

from .errors import ExportError

MARKER = ".adam_studio_export"


def default_projects_root() -> Path:
    return Path(os.path.expandvars(r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft"))


def prepare_project_dir(root: Path, name: str, template: Path) -> Path:
    """A fresh CapCut project folder from the template. Only folders this exporter created are replaced,
    and never while CapCut has them open."""
    dest = Path(root) / name
    if dest.exists():
        if not (dest / MARKER).exists():
            raise ExportError(f'CapCut project "{name}" exists and was not created by Adam Studio: refusing to overwrite it. Pick another --name.')
        if (dest / ".locked").exists():
            raise ExportError(f'CapCut project "{name}" is open in CapCut: close it there, then export again.')
        shutil.rmtree(dest)
    shutil.copytree(template, dest)
    # Marked right away, so an export that fails halfway can be redone over it.
    (dest / MARKER).touch()
    (dest / "media").mkdir(exist_ok=True)
    return dest
```

`py/capcut/adam_capcut/lab.py`:
```python
"""pyJianYingDraft and draft_profiles, used from the ClaudeCapcut lab (never copied into the repo)."""
import os
import sys
from pathlib import Path

from .errors import ExportError


def lab_path() -> Path:
    return Path(os.environ.get("ADAM_CAPCUT_LAB", str(Path.home() / "ClaudeCapcut" / "VectCutAPI")))


def load_lab():
    path = lab_path()
    if not (path / "pyJianYingDraft").is_dir() or not (path / "draft_profiles.py").is_file():
        raise ExportError(f"pyJianYingDraft not found in {path}: set ADAM_CAPCUT_LAB to the VectCutAPI folder of the ClaudeCapcut lab")
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
    import draft_profiles
    import pyJianYingDraft
    import pyJianYingDraft.text_segment  # noqa: F401  (TextStyleRange lives there)

    return pyJianYingDraft, draft_profiles
```

- [ ] **Step 4: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: 18 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add py/capcut
git commit -m "feat(capcut): project folder ownership marker, lock refusal, lab loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Export skeleton: media, main track, report

**Files:**
- Create: `py/capcut/adam_capcut/media.py`, `py/capcut/adam_capcut/build.py`, `py/capcut/adam_capcut/export.py`
- Create: `py/capcut/tests/helpers.py`, `py/capcut/tests/conftest.py`
- Test: `py/capcut/tests/test_export.py`

**Interfaces:**
- Consumes: units (Task 4), `main_track` and `part_frames` (Task 5), `prepare_project_dir`, `default_projects_root`, `MARKER`, `lab_path`, `load_lab` (Task 6), the prep folder format (Task 3).
- Produces: `probe(path) -> (duration_s, width, height)`; `copy_media(timeline, plan, prep, media_dir) -> {"videos": {asset: (path, info)}, "files": {asset: path}, "bakes": {id: (path, info)}, "overlays": {elementId: (path, info)}}`; `entry(id, kind, status, reason)`; `class Builder(pjd, timeline, plan, media)` with `.script`, `.entries`, `.span(a, b)`, `.video_material(key, path, info)`, `.main_track()`, `.grade(seg)`; `build_script(pjd, timeline, plan, media) -> (script, entries)`; `REPO`, `TSX`, `run_prepare(project_dir, prep)`, `export(project_dir, *, name=None, projects_root=None, prepare=True, prep_dir=None) -> Path`. Test helpers: `FONT_ID`, `content_of(dest, profiles)`, `report_of(project, name)`, fixtures `lab` and `project` (a project folder with a space and an accent in its path, holding source media and a ready `renders/capcut`).

- [ ] **Step 1: Write the test helpers and fixtures**

`py/capcut/tests/helpers.py`:
```python
import json
import subprocess
from pathlib import Path

FONT_ID = "7181740482383319553"
FONT_CANDIDATES = ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def system_font() -> str:
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    raise RuntimeError(f"no system font among {FONT_CANDIDATES}")


def timeline_dict(font: str) -> dict:
    """A resolved timeline shaped like the renderer's (4 s, 30 fps, 1080x1920)."""
    lint = {"minDurationMs": 0, "maxDurationMs": 60000, "maxPauseMs": 350, "fillers": []}
    return {
        "format": "9:16", "width": 1080, "height": 1920, "fps": 30, "durationFrames": 120,
        "clips": [
            {"id": "c1", "asset": "s", "fromFrame": 0, "durationFrames": 60, "sourceInMs": 0, "sourceOutMs": 2000,
             "framing": {"mode": "cover"}, "zoom": {"base": 1.08, "driftPerSec": 0.004},
             "transitionOut": {"kind": "subjectSlide", "durationMs": 600}, "volume": 1},
            {"id": "c2", "asset": "s", "fromFrame": 60, "durationFrames": 60, "sourceInMs": 2000, "sourceOutMs": 4000,
             "framing": {"mode": "fit", "background": "blur"}, "zoom": {"base": 1, "driftPerSec": 0},
             "transitionOut": {"kind": "cut"}, "volume": 0.8},
        ],
        "elements": [
            {"id": "behind", "kind": "image", "layer": "behind-subject", "fromFrame": 9, "durationFrames": 18, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {"asset": "m", "fit": "full"}},
            {"id": "pic", "kind": "image", "layer": "front", "fromFrame": 30, "durationFrames": 15, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {"asset": "m", "fit": "full", "intro": "fade", "outro": "glitch"}},
            {"id": "t1", "kind": "title", "layer": "front", "fromFrame": 75, "durationFrames": 15, "trimStartMs": 0,
             "x": 0.5, "y": 0.3, "props": {"phases": [{"startMs": 0, "endMs": 500, "lines": [{"text": "HELLO", "box": False, "sizeScale": 1}]}]}},
        ],
        "captions": [{"id": "cap1", "fromFrame": 6, "durationFrames": 36, "text": "créé\nma boîte", "highlightRanges": [[8, 13]], "x": 0.5, "y": 0.76}],
        "beats": [],
        "audio": [
            {"id": "clip:c1", "asset": "s", "fromFrame": 0, "durationFrames": 60, "sourceInMs": 0, "volume": 1, "fadeInMs": 0, "fadeOutMs": 0},
            {"id": "clip:c2", "asset": "s", "fromFrame": 60, "durationFrames": 60, "sourceInMs": 2000, "volume": 0.8, "fadeInMs": 0, "fadeOutMs": 0},
            {"id": "beep", "asset": "b", "fromFrame": 30, "durationFrames": 9, "sourceInMs": 0, "volume": 0.5, "fadeInMs": 50, "fadeOutMs": 100},
        ],
        "orphans": [], "warnings": [],
        "style": {
            "name": "Test",
            "fonts": {"caption": {"family": "Caption", "file": font, "capcutResourceId": FONT_ID}, "title": {"family": "Title", "file": font}},
            "colors": {"text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A"},
            "grade": {"warmth": 0.3, "contrast": 0.1, "saturation": 0.12, "brightness": -0.02, "vignette": 0.35},
            "caption": {"size": 0.052, "stroke": 0.08, "shadow": True, "maxCharsPerLine": 22, "intro": "miniZoom"},
            "slots": {"9:16": {}, "16:9": {}},
            "lint": {"9:16": lint, "16:9": lint},
        },
    }


def plan_dict(src: Path, font: str) -> dict:
    """capcut-plan.json as the prepare step writes it for the timeline above."""
    return {
        "name": "synthétique : test", "width": 1080, "height": 1920, "fps": 30,
        "bakes": [
            {"id": "b01", "fromFrame": 9, "toFrame": 27, "file": "bake/b01.mp4"},
            {"id": "b02", "fromFrame": 53, "toFrame": 71, "file": "bake/b02.mp4"},
        ],
        "overlays": [{"elementId": "t1", "fromFrame": 75, "durationFrames": 15, "file": "overlay/o01.mov"}],
        "entries": [
            {"id": "transition:c1", "kind": "subjectSlide", "status": "baked", "reason": "person-only slide, baked into the main track"},
            {"id": "behind", "kind": "image", "status": "baked", "reason": "drawn behind the subject, baked into the main track"},
            {"id": "t1", "kind": "title", "status": "baked", "reason": "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)"},
        ],
        "sources": {
            "s": {"video": str(src / "edit.mp4"), "width": 1080, "height": 1920},
            "m": {"file": str(src / "magenta.png")},
            "b": {"file": str(src / "beep.wav")},
        },
        "fonts": {
            "caption": {"path": font, "family": "Caption", "resourceId": FONT_ID},
            "title": {"path": font, "family": "Title", "resourceId": None},
        },
    }


def content_of(dest: Path, profiles) -> dict:
    return json.loads((dest / profiles.get_draft_profile().content_file).read_text(encoding="utf-8"))


def report_of(project: Path, name: str) -> dict:
    data = json.loads((project / "renders" / f"{name}.capcut-report.json").read_text(encoding="utf-8"))
    return {e["id"]: e for e in data["entries"]}
```

`py/capcut/tests/conftest.py`:
```python
import json

import pytest

from adam_capcut.lab import lab_path, load_lab
from helpers import ffmpeg, plan_dict, system_font, timeline_dict

H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac"]


@pytest.fixture(scope="session")
def lab():
    if not (lab_path() / "pyJianYingDraft").is_dir():
        pytest.skip(f"pyJianYingDraft lab not found at {lab_path()} (set ADAM_CAPCUT_LAB)")
    return load_lab()


@pytest.fixture(scope="session")
def project(tmp_path_factory):
    """A project folder (a space and an accent in its path) with source media and a prepared renders/capcut."""
    root = tmp_path_factory.mktemp("adam capcut") / "projet démo"
    src = root / "media-src"
    prep = root / "renders" / "capcut"
    for d in (src, prep / "bake", prep / "overlay"):
        d.mkdir(parents=True)
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", *H264, str(src / "edit.mp4"))
    ffmpeg("-f", "lavfi", "-i", "color=c=magenta:s=1080x1920", "-frames:v", "1", str(src / "magenta.png"))
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", str(src / "beep.wav"))
    for b in ("b01", "b02"):
        ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920:r=30:d=0.6", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.6", *H264, str(prep / "bake" / f"{b}.mp4"))
    ffmpeg("-f", "lavfi", "-i", "color=c=black@0.0:s=1080x1920:r=30:d=0.5", "-vf", "format=rgba",
           "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", str(prep / "overlay" / "o01.mov"))
    font = system_font()
    (prep / "timeline.json").write_text(json.dumps(timeline_dict(font), ensure_ascii=False), encoding="utf-8")
    (prep / "capcut-plan.json").write_text(json.dumps(plan_dict(src, font), ensure_ascii=False), encoding="utf-8")
    return root
```

- [ ] **Step 2: Write the failing test**

`py/capcut/tests/test_export.py`:
```python
from pathlib import Path

import pytest

from adam_capcut.errors import ExportError
from adam_capcut.export import export
from helpers import content_of, report_of


def test_main_track_is_contiguous_and_uses_the_baked_stretches(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="main track", projects_root=tmp_path, prepare=False)
    content = content_of(dest, profiles)
    main = next(t for t in content["tracks"] if t["name"] == "main")
    ranges = [(s["target_timerange"]["start"], s["target_timerange"]["duration"]) for s in main["segments"]]
    assert ranges == [(0, 300000), (300000, 600000), (900000, 866667), (1766667, 600000), (2366667, 1633333)]
    # c2 resumes 366.7 ms into its own source range, which starts at 2000 ms.
    assert main["segments"][4]["source_timerange"]["start"] == 2366667
    assert main["segments"][4]["volume"] == 0.8
    kinds = {k["property_type"] for s in main["segments"] for k in s["common_keyframes"]}
    assert {"KFTypeScaleX", "KFTypeBrightness", "KFTypeContrast", "KFTypeSaturation"} <= kinds
    assert [c["type"] for c in content["materials"]["canvases"]] == ["canvas_blur"]


def test_every_media_file_is_copied_inside_the_capcut_project(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="media", projects_root=tmp_path, prepare=False)
    content = content_of(dest, profiles)
    paths = [m["path"] for m in content["materials"]["videos"] + content["materials"].get("audios", [])]
    assert paths
    for p in paths:
        assert Path(p).exists() and Path(p).resolve().is_relative_to(dest.resolve())


def test_report_lists_native_and_baked_items(lab, project, tmp_path):
    export(project, name="report", projects_root=tmp_path, prepare=False)
    r = report_of(project, "report")
    assert r["clip:c1"]["status"] == "native"
    assert r["bake:b01"]["status"] == "baked"
    assert r["behind"]["status"] == "baked"
    assert r["transition:c1"]["status"] == "baked"


def test_uses_a_safe_folder_name(lab, project, tmp_path):
    dest = export(project, projects_root=tmp_path, prepare=False)
    assert dest.name == "synthétique - test"
    assert (project / "renders" / "synthétique - test.capcut-report.json").exists()


def test_refuses_a_project_it_did_not_create(lab, project, tmp_path):
    mine = tmp_path / "mine"
    mine.mkdir()
    (mine / "keep.txt").write_text("x")
    with pytest.raises(ExportError, match="was not created by Adam Studio"):
        export(project, name="mine", projects_root=tmp_path, prepare=False)
    assert (mine / "keep.txt").read_text() == "x"


def test_rebuilds_its_own_project_but_not_while_it_is_open(lab, project, tmp_path):
    dest = export(project, name="again", projects_root=tmp_path, prepare=False)
    export(project, name="again", projects_root=tmp_path, prepare=False)
    (dest / ".locked").touch()
    with pytest.raises(ExportError, match="is open in CapCut"):
        export(project, name="again", projects_root=tmp_path, prepare=False)
```

Expected values: the main track is c1 frames 0 to 9, bake b01 9 to 27, c1 27 to 53, bake b02 53 to 71 (it straddles the cut), c2 71 to 120. At 30 fps, frame 71 is 2366666.7 µs, rounded to 2366667.

- [ ] **Step 3: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_capcut.export'`.

- [ ] **Step 4: Implement media copy, the main track and the export**

`py/capcut/adam_capcut/media.py`:
```python
"""Copies every file the CapCut project uses into its media folder: the project stays self-contained."""
import json
import shutil
import subprocess
from pathlib import Path

from .errors import ExportError


def probe(path: Path) -> tuple[float, int, int]:
    """Duration in seconds, width and height, from ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(out)
    stream = next((s for s in info.get("streams", []) if "width" in s), {})
    duration = info.get("format", {}).get("duration")
    return float(duration) if duration not in (None, "N/A") else 0.0, int(stream.get("width", 0)), int(stream.get("height", 0))


def copy_media(timeline: dict, plan: dict, prep: Path, media_dir: Path) -> dict:
    sources = plan["sources"]
    out: dict = {"videos": {}, "files": {}, "bakes": {}, "overlays": {}}

    def copy(src: Path, name: str) -> Path:
        if not src.is_file():
            raise ExportError(f"{src} is missing: run the prepare step again")
        dst = media_dir / f"{name}{src.suffix.lower()}"
        shutil.copy2(src, dst)
        return dst

    for i, asset in enumerate(sorted({c["asset"] for c in timeline["clips"]}), 1):
        video = sources.get(asset, {}).get("video")
        if not video:
            raise ExportError(f'no video file for asset "{asset}" in the prepared plan')
        dst = copy(Path(video), f"v{i:02d}")
        out["videos"][asset] = (dst, probe(dst))
    wanted = [e["props"]["asset"] for e in timeline["elements"] if e["kind"] == "image" and e["layer"] == "front"]
    wanted += [a["asset"] for a in timeline["audio"] if not a["id"].startswith("clip:")]
    for i, asset in enumerate(dict.fromkeys(wanted), 1):
        file = sources.get(asset, {}).get("file")
        if not file:
            raise ExportError(f'no file for asset "{asset}" in the prepared plan')
        out["files"][asset] = copy(Path(file), f"f{i:02d}")
    for b in plan["bakes"]:
        dst = copy(prep / b["file"], f"bake-{b['id']}")
        out["bakes"][b["id"]] = (dst, probe(dst))
    for i, o in enumerate(plan["overlays"], 1):
        dst = copy(prep / o["file"], f"overlay-{i:02d}")
        out["overlays"][o["elementId"]] = (dst, probe(dst))
    return out
```

`py/capcut/adam_capcut/build.py`:
```python
"""Builds the CapCut script from the resolved timeline and the prepared plan."""
from pathlib import Path

from .layout import main_track
from .units import cover_scale, crop_rect_at, crop_transform, ms_us, span_us, zoom_at


def entry(id_: str, kind: str, status: str, reason: str) -> dict:
    return {"id": id_, "kind": kind, "status": status, "reason": reason}


class Builder:
    def __init__(self, pjd, timeline: dict, plan: dict, media: dict):
        self.p = pjd
        self.tl = timeline
        self.plan = plan
        self.media = media
        self.fps = timeline["fps"]
        self.canvas = (timeline["width"], timeline["height"])
        self.script = pjd.Script_file(timeline["width"], timeline["height"], fps=self.fps)
        self.entries: list[dict] = []
        self.materials: dict = {}

    def span(self, from_frame: int, to_frame: int):
        start, duration = span_us(from_frame, to_frame, self.fps)
        return self.p.Timerange(start, duration)

    def video_material(self, key, path: Path, info: tuple[float, int, int]):
        if key not in self.materials:
            m = self.p.Video_material("video", path=str(path), duration=info[0], width=info[1], height=info[2])
            self.script.add_material(m)
            self.materials[key] = m
        return self.materials[key]

    def grade(self, seg) -> None:
        """Brightness, contrast and saturation on every main track segment, baked or native."""
        g = self.tl["style"]["grade"]
        for prop in ("brightness", "contrast", "saturation"):
            if g[prop]:
                seg.add_keyframe(getattr(self.p.Keyframe_property, prop), 0, g[prop])

    def main_track(self) -> None:
        p = self.p
        self.script.add_track(p.Track_type.video, "main")
        for part in main_track(self.tl, self.plan["bakes"]):
            if part["kind"] == "bake":
                b = part["bake"]
                path, info = self.media["bakes"][b["id"]]
                tr = self.span(b["fromFrame"], b["toFrame"])
                seg = p.Video_segment(self.video_material(("bake", b["id"]), path, info), tr, source_timerange=p.Timerange(0, tr.duration))
                self.entries.append(entry(f"bake:{b['id']}", "main track", "baked", f"frames {b['fromFrame']} to {b['toFrame'] - 1} rendered by Remotion"))
            else:
                seg = self.clip_part(part)
            self.grade(seg)
            self.script.add_segment(seg, "main")
        for c in self.tl["clips"]:
            if c["framing"]["mode"] != "split":
                self.entries.append(entry(f"clip:{c['id']}", "clip", "native", f"{c['framing']['mode']} framing"))

    def clip_part(self, part: dict):
        p, c = self.p, part["clip"]
        path, info = self.media["videos"][c["asset"]]
        source = (info[1], info[2])
        tr = self.span(part["from"], part["to"])
        offset_ms = (part["from"] - c["fromFrame"]) * 1000 / self.fps
        end_ms = offset_ms + tr.duration / 1000
        seg = p.Video_segment(self.video_material(("video", c["asset"]), path, info), tr,
                              source_timerange=p.Timerange(ms_us(c["sourceInMs"] + offset_ms), tr.duration), volume=c["volume"])
        framing = c["framing"]
        times = [offset_ms, end_ms]
        if framing["mode"] == "crop":
            times += [k["atMs"] - c["sourceInMs"] for k in framing.get("keyframes", []) if offset_ms < k["atMs"] - c["sourceInMs"] < end_ms]
        for elapsed in sorted(set(times)):
            t_us = min(tr.duration, ms_us(elapsed - offset_ms))
            z = zoom_at(c["zoom"], elapsed)
            if framing["mode"] == "crop":
                scale, x, y = crop_transform(crop_rect_at(framing, c["sourceInMs"] + elapsed), source, self.canvas, z)
                seg.add_keyframe(p.Keyframe_property.position_x, t_us, x)
                seg.add_keyframe(p.Keyframe_property.position_y, t_us, y)
            else:
                scale = (cover_scale(source, self.canvas) if framing["mode"] == "cover" else 1.0) * z
            seg.add_keyframe(p.Keyframe_property.uniform_scale, t_us, scale)
        if framing["mode"] == "fit":
            if framing.get("background", "blur") == "blur":
                seg.add_background_filling("blur", 0.0625)
            else:
                color = framing.get("color") or "#000000"
                seg.add_background_filling("color", color=color if len(color) == 9 else f"{color}FF")
        return seg


def build_script(pjd, timeline: dict, plan: dict, media: dict):
    b = Builder(pjd, timeline, plan, media)
    b.main_track()
    return b.script, b.entries
```

`py/capcut/adam_capcut/export.py`:
```python
"""python -m adam_capcut export: the prepare step (TypeScript), then the CapCut project and its report."""
import json
import subprocess
from pathlib import Path

from .build import build_script
from .errors import ExportError
from .folder import MARKER, default_projects_root, prepare_project_dir
from .lab import lab_path, load_lab
from .media import copy_media
from .units import safe_name

REPO = Path(__file__).resolve().parents[3]
TSX = REPO / "node_modules" / "tsx" / "dist" / "cli.mjs"


def run_prepare(project_dir: Path, prep: Path) -> None:
    """Runs `adam capcut-prep` (resolve, lint, Remotion renders of what CapCut cannot do natively)."""
    if not TSX.is_file():
        raise ExportError(f"{TSX} not found: run npm install at the repo root")
    cmd = ["node", str(TSX), str(REPO / "packages" / "render" / "src" / "cli.ts"), "capcut-prep", str(project_dir), "--out", str(prep)]
    if subprocess.run(cmd, cwd=REPO).returncode != 0:
        raise ExportError("the prepare step failed: see the messages above")


def export(project_dir, *, name: str | None = None, projects_root=None, prepare: bool = True, prep_dir=None) -> Path:
    project_dir = Path(project_dir).resolve()
    prep = Path(prep_dir).resolve() if prep_dir else project_dir / "renders" / "capcut"
    if prepare:
        run_prepare(project_dir, prep)
    for f in ("timeline.json", "capcut-plan.json"):
        if not (prep / f).is_file():
            raise ExportError(f"{prep / f} is missing: export without --skip-prepare")
    timeline = json.loads((prep / "timeline.json").read_text(encoding="utf-8"))
    plan = json.loads((prep / "capcut-plan.json").read_text(encoding="utf-8"))
    pjd, profiles = load_lab()
    profile = profiles.get_draft_profile()
    title = name or plan["name"]
    folder = safe_name(title)
    root = Path(projects_root) if projects_root else default_projects_root()
    dest = prepare_project_dir(root, folder, lab_path() / profile.template_dir)
    media = copy_media(timeline, plan, prep, dest / "media")
    script, entries = build_script(pjd, timeline, plan, media)
    profiles.write_profile_content(profile, dest, script.dumps(profile))
    (dest / MARKER).touch()
    report = project_dir / "renders" / f"{folder}.capcut-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"project": str(dest), "name": title, "entries": plan["entries"] + entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return dest
```

- [ ] **Step 5: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: 24 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add py/capcut
git commit -m "feat(capcut): export with copied media, native main track around baked stretches, report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Captions, front items, sounds, look and the caption font

**Files:**
- Create: `py/capcut/adam_capcut/fonts.py`
- Modify: `py/capcut/adam_capcut/build.py`, `py/capcut/adam_capcut/export.py`
- Test: `py/capcut/tests/test_build.py`, `py/capcut/tests/test_fonts.py`

**Interfaces:**
- Consumes: `Builder`, `entry`, `build_script` (Task 7), `allocate` (Task 5), units (Task 4), `probe` (Task 7), fixtures and helpers (Task 7).
- Produces: `CAPTION_SIZE_K`, `BORDER_K`, `INTRO`, `OUTRO`; `Builder.captions()`, `Builder.front()`, `Builder.image(e, tr)`, `Builder.sounds()`, `Builder.look()`; `build_script` calls them all; `apply_caption_font(content, font) -> str`.

- [ ] **Step 1: Write the failing tests**

`py/capcut/tests/test_fonts.py`:
```python
import json

from adam_capcut.fonts import apply_caption_font


def test_points_every_text_at_the_caption_font_and_shadows_every_range():
    styles = [{"range": [0, 4], "shadows": [{"x": 1}]}, {"range": [4, 8]}]
    content = json.dumps({"materials": {"texts": [{"id": "t1", "content": json.dumps({"styles": styles})}]}})
    out = json.loads(apply_caption_font(content, {"path": "C:\\fonts\\a.ttf", "family": "A", "resourceId": "42"}))
    t = out["materials"]["texts"][0]
    assert (t["font_path"], t["font_resource_id"], t["fonts"][0]["title"]) == ("C:/fonts/a.ttf", "42", "A")
    styled = json.loads(t["content"])["styles"]
    assert [st["font"] for st in styled] == [{"path": "C:/fonts/a.ttf", "id": "42"}] * 2
    assert styled[1]["shadows"] == [{"x": 1}]


def test_leaves_the_content_alone_without_a_capcut_resource_id():
    assert apply_caption_font("{}", {"path": "x", "family": "A", "resourceId": None}) == "{}"
```

`py/capcut/tests/test_build.py`:
```python
import json

import pytest

from adam_capcut.export import export
from helpers import FONT_ID, content_of, report_of


def test_captions_are_native_text_with_the_style_font_and_highlight(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="captions", projects_root=tmp_path, prepare=False)
    texts = content_of(dest, profiles)["materials"]["texts"]
    assert len(texts) == 1
    assert texts[0]["font_resource_id"] == FONT_ID
    styles = json.loads(texts[0]["content"])["styles"]
    # "créé\nma boîte" with "boîte" highlighted: the accents do not shift the range.
    assert [st["range"] for st in styles] == [[0, 8], [8, 13]]
    assert styles[1]["fill"]["content"]["solid"]["color"] == pytest.approx([1.0, 209 / 255, 0.0])
    assert report_of(project, "captions")["cap1"]["status"] == "native"


def test_front_images_are_sized_photos_and_overlays_are_videos_on_front_tracks(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="front", projects_root=tmp_path, prepare=False), profiles)
    photos = [m for m in content["materials"]["videos"] if m["type"] == "photo"]
    assert [(m["width"], m["height"]) for m in photos] == [(1080, 1920)]
    front = [t for t in content["tracks"] if t["name"].startswith("front")]
    assert [len(t["segments"]) for t in front] == [2]
    r = report_of(project, "front")
    assert r["pic"]["status"] == "native" and "RGB Scanlines" in r["pic"]["reason"]
    assert r["t1"]["status"] == "baked"


def test_sound_effects_keep_volume_and_fades(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="sounds", projects_root=tmp_path, prepare=False), profiles)
    audio = [t for t in content["tracks"] if t["type"] == "audio"]
    assert [len(t["segments"]) for t in audio] == [1]
    assert audio[0]["segments"][0]["volume"] == 0.5
    assert [(f["fade_in_duration"], f["fade_out_duration"]) for f in content["materials"]["audio_fades"]] == [(50000, 100000)]
    assert report_of(project, "sounds")["beep"]["status"] == "native"


def test_vignette_is_native_and_warmth_is_reported(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="look", projects_root=tmp_path, prepare=False), profiles)
    assert [e["name"] for e in content["materials"]["video_effects"]] == ["Vignette"]
    r = report_of(project, "look")
    assert r["grade"]["status"] == "native"
    assert r["grade.vignette"]["status"] == "native"
    assert r["grade.warmth"]["status"] == "skipped"
```

- [ ] **Step 2: Run them to see them fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: `test_fonts.py` FAILS with `ModuleNotFoundError: No module named 'adam_capcut.fonts'`; the 4 tests of `test_build.py` FAIL (no texts, no photos, no audio tracks, no effects).

- [ ] **Step 3: Implement the caption font**

`py/capcut/adam_capcut/fonts.py`:
```python
"""The style's caption font on every CapCut text, written like CapCut does (lab: build_edit.py apply_font)."""
import json


def apply_caption_font(content: str, font: dict) -> str:
    rid = font.get("resourceId")
    if not rid:
        return content
    path = font["path"].replace("\\", "/")
    d = json.loads(content)
    for m in d["materials"]["texts"]:
        m["font_path"] = path
        m["font_resource_id"] = rid
        m["font_id"] = ""
        m["fonts"] = [{
            "id": m["id"] + "-font", "resource_id": rid, "third_resource_id": "", "category_id": "preset",
            "category_name": "Presets", "source_platform": 1, "path": path, "effect_id": rid,
            "title": font["family"], "team_id": "", "file_uri": "", "request_id": "",
        }]
        c = json.loads(m["content"])
        # pyJianYingDraft only shadows the first color range of a multi-color text: shadow every range alike.
        shadow = next((st["shadows"] for st in c.get("styles", []) if st.get("shadows")), None)
        for st in c.get("styles", []):
            st["font"] = {"path": path, "id": rid}
            if shadow:
                st["shadows"] = shadow
        m["content"] = json.dumps(c, ensure_ascii=False)
    return json.dumps(d, ensure_ascii=False)
```

In `py/capcut/adam_capcut/export.py`, add the import:
```python
from .fonts import apply_caption_font
```
and replace:
```python
    profiles.write_profile_content(profile, dest, script.dumps(profile))
```
with:
```python
    profiles.write_profile_content(profile, dest, apply_caption_font(script.dumps(profile), plan["fonts"]["caption"]))
```

- [ ] **Step 4: Implement captions, front items, sounds and look**

In `py/capcut/adam_capcut/build.py`, replace the imports with:
```python
"""Builds the CapCut script from the resolved timeline and the prepared plan."""
from pathlib import Path

from .layout import main_track
from .media import probe
from .tracks import allocate
from .units import cover_scale, crop_rect_at, crop_transform, hex_rgb, image_scale, ms_us, place, span_us, zoom_at

# CapCut font size per unit of the style's caption size (a fraction of the canvas width): the lab's captions
# were 10.5 for about 0.052. Provisional, checked in CapCut (docs/decisions/0002-capcut-export-check.md).
CAPTION_SIZE_K = 200
# CapCut border width per unit of the style's stroke (a fraction of the font size): the lab used 40 for 0.08.
BORDER_K = 500
# Renderer presets to CapCut animations, with their renderer durations in ms.
INTRO = {"fade": ("Fade_In", 250), "pop": ("Mini_Zoom", 200), "glitch": ("RGB_Scanlines", 200)}
OUTRO = {"fade": ("Fade_Out", 250), "pop": ("Mini_Zoom", 200), "glitch": ("RGB_Scanlines", 200)}
APPROX = {"glitch": "glitch approximated by RGB Scanlines"}
```
add these methods to `Builder` (after `clip_part`):
```python
    def captions(self) -> None:
        p, style = self.p, self.tl["style"]
        cap = style["caption"]
        size = cap["size"] * CAPTION_SIZE_K
        border = p.Text_border(color=(0.0, 0.0, 0.0), width=cap["stroke"] * BORDER_K)
        shadow = p.Text_shadow(has_shadow=True, alpha=0.55, distance=4.0, smoothing=0.6, angle=-60.0) if cap["shadow"] else None
        caps = sorted(self.tl["captions"], key=lambda c: c["fromFrame"])
        tracks = allocate([(c["fromFrame"], c["fromFrame"] + c["durationFrames"]) for c in caps])
        for i in range(max(tracks, default=-1) + 1):
            self.script.add_track(p.Track_type.text, f"captions{i + 1}", relative_index=i)
        for c, t in zip(caps, tracks):
            x, y = place(c["x"], c["y"])
            tr = self.span(c["fromFrame"], c["fromFrame"] + c["durationFrames"])
            seg = p.Text_segment(c["text"], tr, style=p.Text_style(size=size, color=hex_rgb(style["colors"]["text"]), align=1),
                                 border=border, shadow=shadow, clip_settings=p.Clip_settings(transform_x=x, transform_y=y))
            # Same offsets as the renderer; identical to Python indices for text without emoji.
            for a, b in c["highlightRanges"]:
                seg.add_text_style(p.text_segment.TextStyleRange(
                    a, b, p.Text_style(size=size, color=hex_rgb(style["colors"]["highlight"]), align=1), border=border))
            if cap["intro"] == "miniZoom":
                seg.add_animation(p.CapCut_Text_intro.Mini_Zoom, duration=min(150_000, tr.duration // 3))
            self.script.add_segment(seg, f"captions{t + 1}")
            self.entries.append(entry(c["id"], "caption", "native", "CapCut text"))
        font = self.plan["fonts"]["caption"]
        if caps and not font.get("resourceId"):
            self.entries.append(entry("font.caption", "font", "skipped", f'no capcutResourceId for "{font["family"]}" in the style: CapCut shows its default font'))

    def front(self) -> None:
        """Front images (native photos) and overlays (transparent MOV), one video track per overlap level."""
        p = self.p
        items = []
        for e in self.tl["elements"]:
            if e["layer"] != "front":
                continue
            if e["kind"] == "image":
                items.append(("image", e))
            elif e["id"] in self.media["overlays"]:
                items.append(("overlay", e))
        items.sort(key=lambda it: it[1]["fromFrame"])
        tracks = allocate([(e["fromFrame"], e["fromFrame"] + e["durationFrames"]) for _, e in items])
        for i in range(max(tracks, default=-1) + 1):
            self.script.add_track(p.Track_type.video, f"front{i + 1}", relative_index=i + 1)
        for (kind, e), t in zip(items, tracks):
            tr = self.span(e["fromFrame"], e["fromFrame"] + e["durationFrames"])
            if kind == "overlay":
                path, info = self.media["overlays"][e["id"]]
                seg = p.Video_segment(self.video_material(("overlay", e["id"]), path, info), tr, source_timerange=p.Timerange(0, tr.duration), volume=0.0)
            else:
                seg = self.image(e, tr)
            self.script.add_segment(seg, f"front{t + 1}")

    def image(self, e: dict, tr):
        p, props = self.p, e["props"]
        full = props.get("fit", "full") == "full"
        key = ("photo", props["asset"], full)
        mat = self.materials.get(key)
        if mat is None:
            path = self.media["files"][props["asset"]]
            mat = p.Video_material("photo", path=str(path))
            # pyJianYingDraft leaves photos at 0x0 (it expects a download step): set the size CapCut must use.
            if full:
                mat.width, mat.height = self.canvas
            else:
                _, mat.width, mat.height = probe(path)
            self.script.add_material(mat)
            self.materials[key] = mat
        scale = 1.0 if full else image_scale((mat.width, mat.height), self.canvas)
        x, y = (0.0, 0.0) if full else place(e["x"], e["y"])
        seg = p.Video_segment(mat, tr, clip_settings=p.Clip_settings(scale_x=scale, scale_y=scale, transform_x=x, transform_y=y))
        notes = []
        for prop, table, kinds in (("intro", INTRO, p.CapCut_Intro_type), ("outro", OUTRO, p.CapCut_Outro_type)):
            preset = props.get(prop)
            if not preset:
                continue
            if preset not in table:
                notes.append(f'{prop} "{preset}" has no CapCut mapping')
                continue
            name, ms = table[preset]
            seg.add_animation(getattr(kinds, name), duration=min(ms_us(ms), tr.duration // 2))
            if preset in APPROX:
                notes.append(APPROX[preset])
        self.entries.append(entry(e["id"], "image", "native", "photo" + (f" ({'; '.join(notes)})" if notes else "")))
        return seg

    def sounds(self) -> None:
        p = self.p
        sfx = sorted((a for a in self.tl["audio"] if not a["id"].startswith("clip:") and a["durationFrames"] > 0), key=lambda a: a["fromFrame"])
        tracks = allocate([(a["fromFrame"], a["fromFrame"] + a["durationFrames"]) for a in sfx])
        for i in range(max(tracks, default=-1) + 1):
            self.script.add_track(p.Track_type.audio, f"sfx{i + 1}")
        for a, t in zip(sfx, tracks):
            key = ("audio", a["asset"])
            if key not in self.materials:
                m = p.Audio_material(path=str(self.media["files"][a["asset"]]))
                self.script.add_material(m)
                self.materials[key] = m
            tr = self.span(a["fromFrame"], a["fromFrame"] + a["durationFrames"])
            seg = p.Audio_segment(self.materials[key], tr, source_timerange=p.Timerange(ms_us(a["sourceInMs"]), tr.duration), volume=a["volume"])
            if a["fadeInMs"] or a["fadeOutMs"]:
                seg.add_fade(ms_us(a["fadeInMs"]), ms_us(a["fadeOutMs"]))
            self.script.add_segment(seg, f"sfx{t + 1}")
            self.entries.append(entry(a["id"], "sfx", "native", "audio segment"))

    def look(self) -> None:
        p, g = self.p, self.tl["style"]["grade"]
        adjusted = [k for k in ("brightness", "contrast", "saturation") if g[k]]
        if adjusted:
            self.entries.append(entry("grade", "grade", "native", f"{', '.join(adjusted)} keyframes on the main track"))
        if g["vignette"] > 0:
            self.script.add_track(p.Track_type.effect, "fx")
            self.script.add_effect(p.CapCut_Video_scene_effect_type.Vignette, self.span(0, self.tl["durationFrames"]), "fx",
                                   params=[round(g["vignette"] * 100)])
            self.entries.append(entry("grade.vignette", "grade", "native", "Vignette effect over the whole video"))
        if g["warmth"]:
            self.entries.append(entry("grade.warmth", "grade", "skipped",
                                      f"CapCut has no warmth keyframe: add an Adjust layer with Temperature by hand (warmth {g['warmth']})"))
```
and replace `build_script` with:
```python
def build_script(pjd, timeline: dict, plan: dict, media: dict):
    b = Builder(pjd, timeline, plan, media)
    b.main_track()
    b.front()
    b.captions()
    b.sounds()
    b.look()
    return b.script, b.entries
```

- [ ] **Step 5: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: 30 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add py/capcut
git commit -m "feat(capcut): native captions with the style font, photos, overlays, sound effects, vignette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: CLI, end-to-end chain, docs and the CapCut check

**Files:**
- Create: `py/capcut/adam_capcut/__main__.py`, `docs/decisions/0002-capcut-export-check.md`
- Modify: `README.md`
- Test: `py/capcut/tests/test_cli.py`, `py/capcut/tests/test_e2e.py`

**Interfaces:**
- Consumes: `export`, `REPO`, `TSX` (Task 7), `ExportError`, fixtures and helpers (Task 7), `makeSynthetic` (packages/render/tests/e2e/synthetic.ts).
- Produces: `main(argv=None) -> int` and the command `python -m adam_capcut export <projectDir> [--name] [--projects-root] [--skip-prepare]`.

- [ ] **Step 1: Write the failing tests**

`py/capcut/tests/test_cli.py`:
```python
from adam_capcut.__main__ import main


def test_exports_and_prints_the_capcut_project_folder(lab, project, tmp_path, capsys):
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "cli"]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / "cli")


def test_refusals_are_messages_not_tracebacks(lab, project, tmp_path, capsys):
    (tmp_path / "taken").mkdir()
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "taken"]) == 1
    assert "was not created by Adam Studio" in capsys.readouterr().err
```

`py/capcut/tests/test_e2e.py`:
```python
import json
import subprocess
from pathlib import Path

import pytest

from adam_capcut.__main__ import main
from adam_capcut.export import REPO, TSX
from helpers import content_of, report_of


@pytest.mark.e2e
def test_exports_the_synthetic_project_through_the_prepare_step(lab, tmp_path, capsys):
    _, profiles = lab
    project = tmp_path / "projet e2e"
    synthetic = (REPO / "packages" / "render" / "tests" / "e2e" / "synthetic.ts").as_uri()
    subprocess.run(["node", str(TSX), "-e", f"import('{synthetic}').then(m => m.makeSynthetic(process.argv[1]))", str(project)], cwd=REPO, check=True)
    data = json.loads((project / "project.json").read_text(encoding="utf-8"))
    data["elements"].append({"id": "t1", "kind": "title", "anchor": {"atMs": 2500}, "durationMs": 500,
                             "props": {"phases": [{"startMs": 0, "endMs": 500, "lines": [{"text": "HELLO"}]}]}})
    (project / "project.json").write_text(json.dumps(data), encoding="utf-8")

    assert main(["export", str(project), "--projects-root", str(tmp_path / "capcut")]) == 0
    dest = Path(capsys.readouterr().out.strip().splitlines()[-1])
    content = content_of(dest, profiles)
    main = next(t for t in content["tracks"] if t["name"] == "main")
    assert len(main["segments"]) == 5
    assert any(t["name"].startswith("front") for t in content["tracks"])
    r = report_of(project, "synthetic")
    assert (r["behind"]["status"], r["t1"]["status"], r["beep"]["status"]) == ("baked", "baked", "native")
```

- [ ] **Step 2: Run them to see them fail**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut` then `py/capcut/.venv/Scripts/python -m pytest py/capcut -m e2e`
Expected: both runs FAIL with `ModuleNotFoundError: No module named 'adam_capcut.__main__'`.

- [ ] **Step 3: Implement the CLI**

`py/capcut/adam_capcut/__main__.py`:
```python
"""python -m adam_capcut export <projectDir> [--name "1015 edit"] [--projects-root DIR] [--skip-prepare]"""
import argparse
import sys
from pathlib import Path

from .errors import ExportError
from .export import export


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m adam_capcut")
    sub = parser.add_subparsers(dest="command", required=True)
    ex = sub.add_parser("export", help="write the CapCut project of an Adam Studio project")
    ex.add_argument("project_dir")
    ex.add_argument("--name", help="CapCut project name (default: the project name)")
    ex.add_argument("--projects-root", help="CapCut projects folder (default: CapCut Desktop's)")
    ex.add_argument("--skip-prepare", action="store_true", help="reuse renders/capcut from a previous prepare step")
    args = parser.parse_args(argv)
    try:
        dest = export(Path(args.project_dir), name=args.name, projects_root=args.projects_root, prepare=not args.skip_prepare)
    except ExportError as e:
        print(e, file=sys.stderr)
        return 1
    print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run all the Python tests**

Run: `py/capcut/.venv/Scripts/python -m pytest py/capcut` then `py/capcut/.venv/Scripts/python -m pytest py/capcut -m e2e`
Expected: 32 tests PASS, then 1 end-to-end test PASSES (about 1 to 2 minutes).

- [ ] **Step 5: Document the export**

In `README.md`, add this section (after the existing usage section):
````markdown
## Export to CapCut

The exporter writes a CapCut Desktop project: native clips, captions, photos and sound effects where
CapCut has an equivalent, Remotion renders for the rest (behind-subject effects and person-only slides
baked into the main track, titles as transparent ProRes 4444 overlays). It needs the patched
pyJianYingDraft of the ClaudeCapcut lab (`ADAM_CAPCUT_LAB`, default `~/ClaudeCapcut/VectCutAPI`).

```
python -m venv py/capcut/.venv
py/capcut/.venv/Scripts/python -m pip install -e "py/capcut[dev]"
py/capcut/.venv/Scripts/python -m adam_capcut export <projectDir> [--name "1015 edit"]
```

It never overwrites a CapCut project it did not create, nor one open in CapCut. Every export writes
`renders/<name>.capcut-report.json`, listing each item as `native`, `baked` or `skipped` with the reason.
Tests: `py/capcut/.venv/Scripts/python -m pytest py/capcut` (add `-m e2e` for the full chain).
````

`docs/decisions/0002-capcut-export-check.md`:
```markdown
# 0002: CapCut export, manual check

Context: spec section 12 asks for one manual check of an exported project in CapCut Desktop. The
automated tests check the project JSON; only CapCut shows whether it plays as the renderer does.

How: add a title to the demo project, export it, open it in CapCut Desktop, compare with
`npm run adam -- render C:\Users\miche\AdamStudioProjects\demo` (the MP4 of the same project).

    py/capcut/.venv/Scripts/python -m adam_capcut export C:\Users\miche\AdamStudioProjects\demo --name "adam demo"

| Check | Expected | Result |
|---|---|---|
| The project opens with no missing media | all media found | to fill |
| Main track | 5 segments; red and blue take, gray during the slide | to fill |
| 0.3 to 0.9 s | magenta image behind the green square (baked) | to fill |
| 1.8 to 2.4 s | the square slides out left and back from the right over gray (baked) | to fill |
| 0.2 to 1.4 s | caption "red blue", "blue" in yellow, size close to the MP4 | to fill |
| 2.5 to 3.0 s | the title "HELLO" over the video, background transparent | to fill |
| 1.0 s | the beep is heard | to fill |

Decision: filled in after the check (caption size factor kept or corrected, anything CapCut rejects).
```

- [ ] **Step 6: Export the demo for the creator's check**

Add a title to `C:\Users\miche\AdamStudioProjects\demo\project.json` (append to `elements`):
```json
{ "id": "t1", "kind": "title", "anchor": { "atMs": 2500 }, "durationMs": 500, "props": { "phases": [{ "startMs": 0, "endMs": 500, "lines": [{ "text": "HELLO" }] }] } }
```
Run: `py/capcut/.venv/Scripts/python -m adam_capcut export "C:/Users/miche/AdamStudioProjects/demo" --name "adam demo"` then `npm run adam -- render "C:/Users/miche/AdamStudioProjects/demo"`
Expected: the first prints the CapCut project folder (`...\com.lveditor.draft\adam demo`) and writes `renders/adam demo.capcut-report.json`; the second writes `renders/synthetic.mp4`. The creator opens "adam demo" in CapCut and fills the Result column; the executor records the outcome in the decision file.

- [ ] **Step 7: Run everything and commit**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e -w @adam-studio/render`, `py/capcut/.venv/Scripts/python -m pytest py/capcut`
Expected: model and render unit suites PASS, typecheck exit code 0, 14 render end-to-end tests PASS, 32 Python tests PASS.

```bash
git add py/capcut README.md docs/decisions/0002-capcut-export-check.md
git commit -m "feat(capcut): python -m adam_capcut export, end-to-end test, docs and the CapCut check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
