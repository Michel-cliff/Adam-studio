# Adam Studio Model Implementation Plan (sub-project 1, plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@adam-studio/model`, the TypeScript package that defines, validates, resolves and lints an Adam Studio project, including the guided workflow with proposals and variants, and settle the CapCut alpha-video question first.

**Architecture:** A pure TypeScript library (no Node built-ins, so it can run inside the Remotion browser bundle later). zod schemas define the authoring model (`project.json`), the style and the resolved timeline. `parseProject` adds cross-reference checks. `resolve()` turns word anchors and cuts into a flat frame-based timeline. `lint()` checks the reels rules. `cutWords` / `restoreWords` / `trimToWords` edit cuts from the transcript. `applyPatch` / `decide` run the guided workflow. A script exports JSON Schemas for the Python CapCut exporter.

**Tech Stack:** Node 24, npm workspaces, TypeScript 7 (strict), zod 4.6, vitest 5, tsx 4.

**Spec:** `docs/superpowers/specs/2026-10-16-adam-studio-core-design.md` (sections 3, 4, 5, 6, 7, 13 and 14 for this plan).

The other plans of sub-project 1, written after this one is done: plan 2 renderer (`packages/render`, `adam render`, `adam review`, `adam decide`), plan 3 CapCut exporter (`py/capcut`), plan 4 acceptance (1015).

## Global Constraints

- Node >= 24, npm workspaces; TypeScript 7 strict with `noUncheckedIndexedAccess`; zod `^4.6.7`; vitest `^5.0.5`; tsx `^4.23.15`.
- All times in the authoring model are integer milliseconds; frames appear only in the resolved timeline, always computed as `msToFrame(accumulatedMs, fps)` (never by adding rounded durations).
- Formats: `9:16` is 1080x1920, `16:9` is 1920x1080. Default fps in fixtures: 30.
- `packages/model` must not import Node built-ins (`node:fs`, `node:path`, ...) outside `scripts/`; file checks go through an injected `fileExists` callback.
- Word ids are `<assetId>.w<index>`. An unknown word id is a parse error; a known word that falls in a cut is an orphan (lint warning), never an exception.
- The public repo never contains personal footage or third-party asset files. License: MIT.
- Docs written in the repo use no em dash characters.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A word id that exists but whose time range was cut: `parseProject` must accept it and `resolve()` must report the item as an orphan (Task 4 test "a cut word is not a parse error", Task 7 orphan test).
- An anchor whose offset lands before 0 or an element running past the end: clamp to the timeline instead of failing; drop and warn if nothing is visible (Task 7 clamp test).
- The same source range used twice in `story` (a repeated sentence): anchors map deterministically to the first occurrence (Task 7 duplicate-range test).
- A highlight phrase missing from the caption text, or split by the automatic line break: warning or correct range, never a crash (Task 8 tests).
- Deciding a proposal of a locked step, deciding twice, or picking a variant after "more" emptied the list: explicit `WorkflowError` (Task 10 tests).
- Windows paths (`C:\...`) in assets for `assets.missing` (Task 11 test).

---

### Task 1: Spike: does CapCut render video with an alpha channel?

The spec's first risk (section 13.1). Throwaway script plus a decision record; it runs with the ClaudeCapcut lab venv, outside the npm workspace.

**Files:**
- Create: `spikes/capcut-alpha/make_test_project.py`
- Create: `docs/decisions/0001-capcut-alpha-video.md`

**Interfaces:**
- Consumes: the lab at `C:\Users\miche\ClaudeCapcut\VectCutAPI` (pyJianYingDraft, `draft_profiles`, its `.venv`), ffmpeg on PATH.
- Produces: the decision record read by plan 3 (CapCut exporter): which overlay container, if any, keeps transparency in CapCut.

- [ ] **Step 1: Write the spike script**

```python
"""Spike: does CapCut Desktop render video with an alpha channel?

Builds the CapCut project "adam_alpha_spike": a test pattern for 6 s, with an orange circle overlay that has
a transparent background, as WebM VP9 alpha from 0 to 3 s and as MOV ProRes 4444 from 3 to 6 s.

Run with the lab venv:
  C:\\Users\\miche\\ClaudeCapcut\\VectCutAPI\\.venv\\Scripts\\python spikes\\capcut-alpha\\make_test_project.py
"""
import os
import shutil
import subprocess
import sys

LAB = os.environ.get("ADAM_CAPCUT_LAB", r"C:\Users\miche\ClaudeCapcut\VectCutAPI")
sys.path.insert(0, LAB)

from pyJianYingDraft import Script_file, Timerange, Track_type, Video_material, Video_segment  # noqa: E402
from draft_profiles import get_draft_profile, write_profile_content  # noqa: E402

PROJECTS = os.path.expandvars(r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft")
NAME = "adam_alpha_spike"
MARKER = ".vectcut_generated"
US = 1_000_000
CIRCLE = "format=rgba,geq=r='255':g='107':b='53':a='if(lt(hypot(X-540-300*sin(2*T),Y-960),220),255,0)'"


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def main():
    dest = os.path.join(PROJECTS, NAME)
    if os.path.exists(dest):
        if not os.path.exists(os.path.join(dest, MARKER)):
            sys.exit(f"{dest} exists and was not created by this spike: refusing to touch it")
        if os.path.exists(os.path.join(dest, ".locked")):
            sys.exit("the spike project is open in CapCut: close it, then run again")
        shutil.rmtree(dest)
    profile = get_draft_profile()
    shutil.copytree(os.path.join(LAB, profile.template_dir), dest)
    open(os.path.join(dest, MARKER), "w").close()
    media = os.path.join(dest, "media")
    os.makedirs(media)

    bg = os.path.join(media, "bg.mp4")
    webm = os.path.join(media, "overlay.webm")
    mov = os.path.join(media, "overlay.mov")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", bg)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", CIRCLE,
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", webm)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", CIRCLE,
           "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", mov)

    script = Script_file(1080, 1920)
    m_bg = Video_material("video", path=bg, duration=6, width=1080, height=1920)
    m_webm = Video_material("video", path=webm, duration=3, width=1080, height=1920)
    m_mov = Video_material("video", path=mov, duration=3, width=1080, height=1920)
    for m in (m_bg, m_webm, m_mov):
        script.add_material(m)
    script.add_track(Track_type.video, "bg")
    script.add_track(Track_type.video, "overlay", relative_index=1)
    script.add_segment(Video_segment(m_bg, Timerange(0, 6 * US)), "bg")
    script.add_segment(Video_segment(m_webm, Timerange(0, 3 * US)), "overlay")
    script.add_segment(Video_segment(m_mov, Timerange(3 * US, 3 * US)), "overlay")
    write_profile_content(profile, dest, script.dumps(profile))
    print(dest)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and check the files**

Run: `C:\Users\miche\ClaudeCapcut\VectCutAPI\.venv\Scripts\python spikes\capcut-alpha\make_test_project.py`
Expected: prints the project folder path. Then run
`ffprobe -v error -show_entries stream=codec_name,pix_fmt -of csv=p=0 "<printed path>\media\overlay.webm"` and the same for `overlay.mov`.
Expected: `vp9,yuva420p` (ffprobe may report `yuv420p` for VP9 alpha; the alpha lives in a side stream, which is normal) and `prores,yuva444p12le` or `yuva444p10le`.

- [ ] **Step 3: Ask the creator to check in CapCut**

Ask, word for word: "Open the CapCut project `adam_alpha_spike` and play it. From 0 to 3 s and from 3 to 6 s, do you see an orange circle moving over the colored test pattern (transparent), a black screen with the circle (alpha ignored), or a missing / offline clip?" Wait for the answer for both ranges.

- [ ] **Step 4: Write the decision record with the observed result**

Create `docs/decisions/0001-capcut-alpha-video.md` with this content, filling the two result cells with the observed values (`transparent`, `opaque black` or `not imported`) and keeping only the decision paragraph that matches:

```markdown
# 0001: CapCut and video with an alpha channel

Context: the CapCut exporter (spec section 10) needs to know whether CapCut Desktop renders transparent
video overlays, to export elements without a native CapCut equivalent as overlays.

Test: `spikes/capcut-alpha/make_test_project.py` builds the CapCut project `adam_alpha_spike`: a test
pattern with an orange circle overlay, WebM VP9 alpha from 0 to 3 s and MOV ProRes 4444 from 3 to 6 s.

| Container | Result in CapCut |
|---|---|
| WebM VP9 alpha (0 to 3 s) | <observed> |
| MOV ProRes 4444 (3 to 6 s) | <observed> |

Decision (if at least one container is transparent): elements without a native equivalent are exported
as transparent overlays in that container, MOV ProRes 4444 preferred when both work because CapCut
handles it as a standard editing codec.

Decision (if neither is transparent): elements without a native equivalent are baked into the main
track: the affected stretch of the story is replaced by a clip rendered by Remotion with the element
included, like behind-subject effects.
```

- [ ] **Step 5: Commit**

```bash
git add spikes/capcut-alpha/make_test_project.py docs/decisions/0001-capcut-alpha-video.md
git commit -m "spike: CapCut alpha video test and decision record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Monorepo scaffold and time utilities

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `LICENSE`
- Create: `packages/model/package.json`, `packages/model/tsconfig.json`
- Create: `packages/model/src/time.ts`, `packages/model/src/index.ts`
- Test: `packages/model/tests/time.test.ts`

**Interfaces:**
- Produces: `type Format = "9:16" | "16:9"`, `FORMAT_SIZES`, `canvasSize(format): { width; height }`, `msToFrame(ms, fps): number` from `packages/model/src/time.ts`.

- [ ] **Step 1: Create the workspace files**

`package.json`:
```json
{
  "name": "adam-studio",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
.env
.env.*
__pycache__/
*.pyc
```

`LICENSE`:
```
MIT License

Copyright (c) 2026 Michel-Cliff OGOUDEDJI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`packages/model/package.json`:
```json
{
  "name": "@adam-studio/model",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "export-schemas": "tsx scripts/export-schemas.ts"
  },
  "dependencies": { "zod": "^4.6.7" },
  "devDependencies": {
    "@types/node": "^26.6.5",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.5"
  }
}
```

`packages/model/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 2: Install**

Run: `npm install` (repo root)
Expected: creates `node_modules/` and `package-lock.json`, exit code 0.

- [ ] **Step 3: Write the failing test**

`packages/model/tests/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canvasSize, msToFrame } from "../src/time";

describe("canvasSize", () => {
  it("maps 9:16 to a vertical 1080x1920 canvas", () => {
    expect(canvasSize("9:16")).toEqual({ width: 1080, height: 1920 });
  });
  it("maps 16:9 to a landscape 1920x1080 canvas", () => {
    expect(canvasSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("msToFrame", () => {
  it("rounds to the nearest frame", () => {
    expect(msToFrame(0, 30)).toBe(0);
    expect(msToFrame(1010, 30)).toBe(30);
    expect(msToFrame(2020, 30)).toBe(61);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/time`.

- [ ] **Step 5: Implement**

`packages/model/src/time.ts`:
```ts
export type Format = "9:16" | "16:9";

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export function canvasSize(format: Format): { width: number; height: number } {
  return FORMAT_SIZES[format];
}

/** Milliseconds to the nearest frame. Convert accumulated positions, never add rounded durations. */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}
```

`packages/model/src/index.ts`:
```ts
export * from "./time";
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: 3 tests PASS; typecheck exit code 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore LICENSE packages/model
git commit -m "chore: npm workspace, MIT license, model package with time utilities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schemas (project, style, element kinds) and schema-level parsing

**Files:**
- Create: `packages/model/src/schema/project.ts`, `packages/model/src/schema/style.ts`, `packages/model/src/schema/kinds.ts`
- Create: `packages/model/src/parse.ts`
- Create: `packages/model/tests/helpers.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/parse.test.ts`

**Interfaces:**
- Consumes: `Format` from `src/time.ts`.
- Produces (exact names used by later tasks):
  - `src/schema/project.ts`: `FormatSchema`, `CanvasSchema`, `AssetSchema`, `WordSchema`, `TranscriptSchema`, `FramingSchema`, `ZoomSchema`, `TransitionOutSchema`, `ClipSchema`, `AnchorSchema`, `ElementSchema`, `CaptionSchema`, `BeatSchema`, `StructureSchema`, `STEP_IDS`, `StepIdSchema`, `StepStateSchema`, `WorkflowSchema`, `PatchSchema`, `VariantKeySchema`, `VariantSchema`, `ProposalStatusSchema`, `ProposalSchema`, `ProjectSchema`; types `Asset`, `Word`, `Framing`, `Zoom`, `TransitionOut`, `Clip`, `Anchor`, `Element`, `ElementInput`, `Caption`, `Beat`, `Structure`, `StepId`, `StepState`, `Workflow`, `Patch`, `VariantKey`, `Variant`, `ProposalStatus`, `Proposal`, `Project`, `ProjectInput`.
  - `src/schema/style.ts`: `FR_FILLERS`, `FontSchema`, `StyleSchema`; types `Style`, `StyleInput`.
  - `src/schema/kinds.ts`: `TitlePropsSchema`, `BehindSubjectTextPropsSchema`, `ImagePropsSchema`, `SfxPropsSchema`, `KIND_SCHEMAS`, `KIND_NAMES`, `ASSET_PROP_KINDS`, `isKind(kind)`; types `KindName`, `TitleProps`, `BehindSubjectTextProps`, `ImageProps`, `SfxProps`.
  - `src/parse.ts`: `FieldError { path; message }`, `ParseResult<T>`, `formatPath(path)`, `parseStyle(input)`, `checkElementProps(el, path, errors)`, `parseProject(input)`.
  - `tests/helpers.ts`: `NUMBERS`, `words(asset, texts, startMs?, stepMs?, lenMs?)`, `projectInput(over?)`, `makeProject(over?)`, `styleInput`, `makeStyle(over?)`.

- [ ] **Step 1: Write the test helpers**

`packages/model/tests/helpers.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing tests**

`packages/model/tests/parse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseProject, parseStyle } from "../src/parse";
import { projectInput, styleInput } from "./helpers";

describe("parseProject (schema level)", () => {
  it("accepts a minimal project and applies defaults", () => {
    const r = parseProject(projectInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const clip = r.value.story[0]!;
    expect(clip.framing).toEqual({ mode: "cover" });
    expect(clip.zoom).toEqual({ base: 1, driftPerSec: 0 });
    expect(clip.transitionOut).toEqual({ kind: "cut" });
    expect(clip.volume).toBe(1);
    expect(r.value.elements).toEqual([]);
    expect(r.value.proposals).toEqual([]);
    expect(r.value.styleOverrides).toEqual({});
  });

  it("names the exact field when a clip ends before it starts", () => {
    const r = parseProject(projectInput({ story: [{ id: "c1", asset: "a", inMs: 500, outMs: 500 }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "story[0].outMs", message: "outMs must be greater than inMs" });
  });

  it("rejects an unknown element kind", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "laser", anchor: { atMs: 0 }, durationMs: 1000 }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "elements[0].kind", message: 'unknown kind "laser"' });
  });

  it("validates element props per kind with a precise path", () => {
    const r = parseProject(projectInput({
      elements: [{
        id: "e1", kind: "title", anchor: { atMs: 0 }, durationMs: 3000,
        props: { phases: [{ startMs: 0, endMs: 1500, lines: [{ text: "" }] }] },
      }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path)).toContain("elements[0].props.phases[0].lines[0].text");
  });

  it("applies kind defaults to props", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 1000, props: { text: "CONTEXTE" } }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.elements[0]!.props).toEqual({ text: "CONTEXTE", color: "accent", sizeScale: 1 });
  });

  it("requires exactly one way to end an element", () => {
    const r = parseProject(projectInput({
      elements: [{ id: "e1", kind: "image", anchor: { atMs: 0 }, durationMs: 1000, untilEnd: true, props: { asset: "a" } }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "elements[0].durationMs", message: "set exactly one of durationMs, untilWord, untilEnd" });
  });
});

describe("parseStyle", () => {
  it("accepts the test style and fills defaults", () => {
    const r = parseStyle(styleInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.grade).toEqual({ warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 });
    expect(r.value.caption.maxCharsPerLine).toBe(22);
    expect(r.value.lint["9:16"].maxPauseMs).toBe(350);
    expect(r.value.lint["9:16"].fillers).toContain("du coup");
  });

  it("names a bad color", () => {
    const r = parseStyle({ ...styleInput, colors: { ...styleInput.colors, accent: "orange" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual({ path: "colors.accent", message: "expected a #RRGGBB color" });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/parse`.

- [ ] **Step 4: Implement the project schema**

`packages/model/src/schema/project.ts`:
```ts
import { z } from "zod";

export const FormatSchema = z.enum(["9:16", "16:9"]);
const Ms = z.number().int().nonnegative();
const Unit = z.number().min(0).max(1);

export const CanvasSchema = z.object({ format: FormatSchema, fps: z.number().int().positive() });

export const AssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio", "image", "lottie"]),
  path: z.string().min(1),
  meta: z
    .object({
      durationMs: Ms.optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      hasAudio: z.boolean().optional(),
    })
    .default({}),
});

export const WordSchema = z
  .object({ id: z.string().min(1), text: z.string(), startMs: Ms, endMs: Ms })
  .refine((w) => w.endMs >= w.startMs, { message: "endMs must be >= startMs", path: ["endMs"] });

export const TranscriptSchema = z.object({
  lang: z.string().default("fr"),
  words: z.record(z.string(), z.array(WordSchema)).default({}),
});

const RectSchema = z.object({ x: Unit, y: Unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) });

export const FramingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cover") }),
  z.object({ mode: z.literal("fit"), background: z.enum(["blur", "color"]).default("blur"), color: z.string().optional() }),
  z.object({
    mode: z.literal("crop"),
    rect: RectSchema,
    keyframes: z.array(z.object({ atMs: Ms, rect: RectSchema })).default([]),
  }),
  z.object({ mode: z.literal("split"), asset: z.string().min(1), layout: z.string().default("top-bottom") }),
]);

export const ZoomSchema = z.object({ base: z.number().positive().default(1), driftPerSec: z.number().default(0) });

export const TransitionOutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cut") }),
  z.object({ kind: z.literal("crossfade"), durationMs: Ms }),
  z.object({ kind: z.literal("subjectSlide"), durationMs: Ms, word: z.string().optional() }),
]);

export const ClipSchema = z
  .object({
    id: z.string().min(1),
    asset: z.string().min(1),
    inMs: Ms,
    outMs: Ms,
    framing: FramingSchema.default({ mode: "cover" }),
    zoom: ZoomSchema.default({ base: 1, driftPerSec: 0 }),
    transitionOut: TransitionOutSchema.default({ kind: "cut" }),
    volume: z.number().min(0).default(1),
  })
  .refine((c) => c.outMs > c.inMs, { message: "outMs must be greater than inMs", path: ["outMs"] });

export const AnchorSchema = z.union([
  z.object({ word: z.string().min(1), offsetMs: z.number().int().default(0) }),
  z.object({ atMs: Ms }),
]);

export const ElementSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    layer: z.enum(["front", "behind-subject"]).default("front"),
    anchor: AnchorSchema,
    durationMs: Ms.optional(),
    untilWord: z.string().min(1).optional(),
    untilEnd: z.boolean().optional(),
    slot: z.string().default("center"),
    position: z.object({ x: Unit, y: Unit }).optional(),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (e) => [e.durationMs !== undefined, e.untilWord !== undefined, e.untilEnd === true].filter(Boolean).length === 1,
    { message: "set exactly one of durationMs, untilWord, untilEnd", path: ["durationMs"] },
  );

export const CaptionSchema = z.object({
  words: z.tuple([z.string().min(1), z.string().min(1)]),
  text: z.string().min(1),
  highlight: z.array(z.string().min(1)).default([]),
  lang: z.string().optional(),
});

export const BeatSchema = z.object({ role: z.string().min(1), from: z.string().min(1), to: z.string().min(1) });
export const StructureSchema = z.object({ framework: z.string().min(1), beats: z.array(BeatSchema).default([]) });

export const STEP_IDS = ["cuts", "structure", "captions", "hook", "beats", "visuals", "sound", "look"] as const;
export const StepIdSchema = z.enum(STEP_IDS);
export const StepStateSchema = z.enum(["locked", "open", "done"]);
export const WorkflowSchema = z.object({ current: StepIdSchema, steps: z.record(StepIdSchema, StepStateSchema) });

export const PatchSchema = z.object({
  addElements: z.array(ElementSchema).optional(),
  addCaptions: z.array(CaptionSchema).optional(),
  setStory: z.array(ClipSchema).min(1).optional(),
  setStructure: StructureSchema.optional(),
  setStyle: z.record(z.string(), z.unknown()).optional(),
  removeElements: z.array(z.string()).optional(),
});

export const VariantKeySchema = z.enum(["A", "B", "C"]);
export const VariantSchema = z.object({ key: VariantKeySchema, label: z.string().min(1), patch: PatchSchema });
export const ProposalStatusSchema = z.union([
  z.literal("pending"),
  z.literal("rejected"),
  z.object({ accepted: VariantKeySchema }),
]);
export const ProposalSchema = z.object({
  id: z.string().min(1),
  step: StepIdSchema,
  anchor: AnchorSchema.optional(),
  reason: z.string().default(""),
  variants: z.array(VariantSchema).max(3),
  status: ProposalStatusSchema.default("pending"),
  history: z
    .array(z.object({ variants: z.array(VariantSchema), decision: z.literal("more"), note: z.string().optional() }))
    .default([]),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  canvas: CanvasSchema,
  style: z.string().min(1),
  styleOverrides: z.record(z.string(), z.unknown()).default({}),
  assets: z.array(AssetSchema),
  transcript: TranscriptSchema.default({ lang: "fr", words: {} }),
  story: z.array(ClipSchema).min(1),
  elements: z.array(ElementSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  structure: StructureSchema.optional(),
  workflow: WorkflowSchema.optional(),
  proposals: z.array(ProposalSchema).default([]),
});

export type Asset = z.output<typeof AssetSchema>;
export type Word = z.output<typeof WordSchema>;
export type Framing = z.output<typeof FramingSchema>;
export type Zoom = z.output<typeof ZoomSchema>;
export type TransitionOut = z.output<typeof TransitionOutSchema>;
export type Clip = z.output<typeof ClipSchema>;
export type Anchor = z.output<typeof AnchorSchema>;
export type Element = z.output<typeof ElementSchema>;
export type ElementInput = z.input<typeof ElementSchema>;
export type Caption = z.output<typeof CaptionSchema>;
export type Beat = z.output<typeof BeatSchema>;
export type Structure = z.output<typeof StructureSchema>;
export type StepId = z.output<typeof StepIdSchema>;
export type StepState = z.output<typeof StepStateSchema>;
export type Workflow = z.output<typeof WorkflowSchema>;
export type Patch = z.output<typeof PatchSchema>;
export type VariantKey = z.output<typeof VariantKeySchema>;
export type Variant = z.output<typeof VariantSchema>;
export type ProposalStatus = z.output<typeof ProposalStatusSchema>;
export type Proposal = z.output<typeof ProposalSchema>;
export type Project = z.output<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
```

- [ ] **Step 5: Implement the style schema**

`packages/model/src/schema/style.ts`:
```ts
import { z } from "zod";
import { FormatSchema } from "./project";

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected a #RRGGBB color");
const Signed = z.number().min(-1).max(1);
const Point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const FR_FILLERS = ["euh", "heu", "bah", "ben", "du coup", "en fait"];

export const FontSchema = z.object({
  family: z.string().min(1),
  file: z.string().min(1),
  capcutResourceId: z.string().optional(),
});

export const StyleSchema = z.object({
  name: z.string().min(1),
  fonts: z.object({ caption: FontSchema, title: FontSchema }),
  colors: z.object({ text: Hex, highlight: Hex, accent: Hex, ink: Hex }),
  grade: z
    .object({
      warmth: Signed.default(0),
      contrast: Signed.default(0),
      saturation: Signed.default(0),
      brightness: Signed.default(0),
      vignette: z.number().min(0).max(1).default(0),
    })
    .default({ warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 }),
  caption: z.object({
    size: z.number().positive(),
    stroke: z.number().min(0).default(0.08),
    shadow: z.boolean().default(true),
    maxCharsPerLine: z.number().int().positive().default(22),
    intro: z.string().default("miniZoom"),
  }),
  slots: z.record(FormatSchema, z.record(z.string(), Point)),
  lint: z.record(
    FormatSchema,
    z.object({
      minDurationMs: z.number().int().nonnegative(),
      maxDurationMs: z.number().int().positive(),
      maxPauseMs: z.number().int().positive().default(350),
      fillers: z.array(z.string()).default(FR_FILLERS),
    }),
  ),
});

export type Style = z.output<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;
```

- [ ] **Step 6: Implement the element kinds registry**

`packages/model/src/schema/kinds.ts`:
```ts
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
```

- [ ] **Step 7: Implement schema-level parsing**

`packages/model/src/parse.ts`:
```ts
import type { ZodError, ZodType } from "zod";
import { ProjectSchema, type Element, type Project } from "./schema/project";
import { StyleSchema, type Style } from "./schema/style";
import { KIND_SCHEMAS, isKind } from "./schema/kinds";

export interface FieldError {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/** ["elements", 4, "props", "lines", 1, "text"] -> "elements[4].props.lines[1].text" */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

export function joinPath(prefix: string, sub: string): string {
  if (!sub) return prefix;
  return sub.startsWith("[") ? `${prefix}${sub}` : `${prefix}.${sub}`;
}

function toErrors(error: ZodError, prefix = ""): FieldError[] {
  return error.issues.map((i) => ({
    path: prefix ? joinPath(prefix, formatPath(i.path)) : formatPath(i.path),
    message: i.message,
  }));
}

export function parseStyle(input: unknown): ParseResult<Style> {
  const r = StyleSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: toErrors(r.error) };
}

/** Validates props against the kind's schema and returns the element with defaults applied. */
export function checkElementProps(el: Element, path: string, errors: FieldError[]): Element {
  if (!isKind(el.kind)) {
    errors.push({ path: `${path}.kind`, message: `unknown kind "${el.kind}"` });
    return el;
  }
  const schema: ZodType = KIND_SCHEMAS[el.kind];
  const r = schema.safeParse(el.props);
  if (!r.success) {
    errors.push(...toErrors(r.error, `${path}.props`));
    return el;
  }
  return { ...el, props: r.data as Record<string, unknown> };
}

export function parseProject(input: unknown): ParseResult<Project> {
  const r = ProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: toErrors(r.error) };
  const project = r.data;
  const errors: FieldError[] = [];
  const elements = project.elements.map((el, i) => checkElementProps(el, `elements[${i}]`, errors));
  const proposals = project.proposals.map((p, i) => ({
    ...p,
    variants: p.variants.map((v, j) =>
      v.patch.addElements
        ? {
            ...v,
            patch: {
              ...v.patch,
              addElements: v.patch.addElements.map((el, k) =>
                checkElementProps(el, `proposals[${i}].variants[${j}].patch.addElements[${k}]`, errors),
              ),
            },
          }
        : v,
    ),
  }));
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...project, elements, proposals } };
}
```

`packages/model/src/index.ts` (replace the whole file):
```ts
export * from "./time";
export * from "./schema/project";
export * from "./schema/style";
export * from "./schema/kinds";
export * from "./parse";
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all tests PASS (3 time + 8 parse); typecheck exit code 0.

- [ ] **Step 9: Commit**

```bash
git add packages/model
git commit -m "feat(model): project, style and element kind schemas with precise error paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Word index and cross-reference checks

**Files:**
- Create: `packages/model/src/words.ts`
- Modify: `packages/model/src/parse.ts` (replace the whole file, below)
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/refs.test.ts`

**Interfaces:**
- Consumes: schemas and `checkElementProps`, `formatPath`, `joinPath` from Task 3.
- Produces: `src/words.ts`: `interface WordRef { id; asset; index; text; startMs; endMs }`, `indexWords(project: Pick<Project, "transcript">): Map<string, WordRef>`. `parseProject` now also rejects dangling references. `checkElement(el, path, ctx)` is internal.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/refs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseProject } from "../src/parse";
import { indexWords } from "../src/words";
import { makeProject, projectInput, words } from "./helpers";

function errorsOf(over: Parameters<typeof projectInput>[0]) {
  const r = parseProject(projectInput(over));
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}

describe("indexWords", () => {
  it("indexes words by id with their asset and position", () => {
    const w = indexWords(makeProject()).get("a.w5");
    expect(w).toEqual({ id: "a.w5", asset: "a", index: 5, text: "cinq", startMs: 5000, endMs: 5500 });
  });
});

describe("parseProject cross-references", () => {
  it("rejects a clip on an unknown asset", () => {
    expect(errorsOf({ story: [{ id: "c1", asset: "nope", inMs: 0, outMs: 1000 }] }))
      .toContainEqual({ path: "story[0].asset", message: 'unknown asset "nope"' });
  });

  it("rejects an anchor on an unknown word", () => {
    expect(errorsOf({ elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w99" }, durationMs: 500, props: { text: "X" } }] }))
      .toContainEqual({ path: "elements[0].anchor.word", message: 'unknown word "a.w99"' });
  });

  it("accepts an anchor on a word that exists but was cut (a cut word is not a parse error)", () => {
    const r = parseProject(projectInput({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }],
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w5" }, durationMs: 500, props: { text: "X" } }],
    }));
    expect(r.ok).toBe(true);
  });

  it("rejects a caption whose words come from two assets", () => {
    const errors = errorsOf({
      assets: [
        { id: "a", kind: "video", path: "a.mp4" },
        { id: "b", kind: "video", path: "b.mp4" },
      ],
      transcript: { lang: "fr", words: { a: words("a", ["un"]), b: words("b", ["deux"]) } },
      captions: [{ words: ["a.w0", "b.w0"], text: "un deux" }],
    });
    expect(errors).toContainEqual({ path: "captions[0].words", message: "a caption's first and last words must come from the same asset" });
  });

  it("rejects a caption whose last word comes before its first", () => {
    expect(errorsOf({ captions: [{ words: ["a.w4", "a.w2"], text: "x" }] }))
      .toContainEqual({ path: "captions[0].words", message: "the last word comes before the first word" });
  });

  it("rejects duplicate element ids", () => {
    const el = { id: "e1", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 500, props: { text: "X" } };
    expect(errorsOf({ elements: [el, el] })).toContainEqual({ path: "elements[1].id", message: 'duplicate id "e1"' });
  });

  it("rejects an image element pointing to an unknown asset", () => {
    expect(errorsOf({ elements: [{ id: "e1", kind: "image", anchor: { atMs: 0 }, durationMs: 500, props: { asset: "logo" } }] }))
      .toContainEqual({ path: "elements[0].props.asset", message: 'unknown asset "logo"' });
  });

  it("checks elements inside proposal variants", () => {
    const errors = errorsOf({
      proposals: [{
        id: "p1", step: "visuals",
        variants: [{ key: "A", label: "x", patch: { addElements: [{ id: "e9", kind: "laser", anchor: { atMs: 0 }, durationMs: 100 }] } }],
      }],
    });
    expect(errors).toContainEqual({ path: "proposals[0].variants[0].patch.addElements[0].kind", message: 'unknown kind "laser"' });
  });

  it("rejects a beat on an unknown word", () => {
    expect(errorsOf({ structure: { framework: "soar", beats: [{ role: "situation", from: "a.w0", to: "a.w42" }] } }))
      .toContainEqual({ path: "structure.beats[0].to", message: 'unknown word "a.w42"' });
  });

  it("rejects transcript words of an unknown asset and duplicate word ids", () => {
    const errors = errorsOf({
      transcript: { lang: "fr", words: { a: [...words("a", ["un"]), ...words("a", ["un"])], ghost: words("ghost", ["x"]) } },
    });
    expect(errors).toContainEqual({ path: "transcript.words.ghost", message: 'unknown asset "ghost"' });
    expect(errors).toContainEqual({ path: "transcript.words", message: "word ids must be unique across assets" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/words`.

- [ ] **Step 3: Implement the word index**

`packages/model/src/words.ts`:
```ts
import type { Project } from "./schema/project";

export interface WordRef {
  id: string;
  asset: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export function indexWords(project: Pick<Project, "transcript">): Map<string, WordRef> {
  const map = new Map<string, WordRef>();
  for (const [asset, list] of Object.entries(project.transcript.words)) {
    list.forEach((w, index) => {
      map.set(w.id, { id: w.id, asset, index, text: w.text, startMs: w.startMs, endMs: w.endMs });
    });
  }
  return map;
}
```

- [ ] **Step 4: Replace `parse.ts` with the cross-referencing version**

`packages/model/src/parse.ts` (whole file):
```ts
import type { ZodError, ZodType } from "zod";
import {
  ProjectSchema,
  type Anchor,
  type Asset,
  type Caption,
  type Clip,
  type Element,
  type Project,
  type Variant,
} from "./schema/project";
import { StyleSchema, type Style } from "./schema/style";
import { ASSET_PROP_KINDS, KIND_SCHEMAS, isKind } from "./schema/kinds";
import { indexWords, type WordRef } from "./words";

export interface FieldError {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/** ["elements", 4, "props", "lines", 1, "text"] -> "elements[4].props.lines[1].text" */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

export function joinPath(prefix: string, sub: string): string {
  if (!sub) return prefix;
  return sub.startsWith("[") ? `${prefix}${sub}` : `${prefix}.${sub}`;
}

function toErrors(error: ZodError, prefix = ""): FieldError[] {
  return error.issues.map((i) => ({
    path: prefix ? joinPath(prefix, formatPath(i.path)) : formatPath(i.path),
    message: i.message,
  }));
}

export function parseStyle(input: unknown): ParseResult<Style> {
  const r = StyleSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: toErrors(r.error) };
}

/** Validates props against the kind's schema and returns the element with defaults applied. */
export function checkElementProps(el: Element, path: string, errors: FieldError[]): Element {
  if (!isKind(el.kind)) {
    errors.push({ path: `${path}.kind`, message: `unknown kind "${el.kind}"` });
    return el;
  }
  const schema: ZodType = KIND_SCHEMAS[el.kind];
  const r = schema.safeParse(el.props);
  if (!r.success) {
    errors.push(...toErrors(r.error, `${path}.props`));
    return el;
  }
  return { ...el, props: r.data as Record<string, unknown> };
}

interface Ctx {
  assets: Map<string, Asset>;
  words: Map<string, WordRef>;
  errors: FieldError[];
}

function duplicates(ids: string[], path: string, errors: FieldError[]): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) errors.push({ path: `${path}[${i}].id`, message: `duplicate id "${id}"` });
    seen.add(id);
  });
}

function checkWord(id: string, path: string, ctx: Ctx): void {
  if (!ctx.words.has(id)) ctx.errors.push({ path, message: `unknown word "${id}"` });
}

function checkAnchor(anchor: Anchor, path: string, ctx: Ctx): void {
  if ("word" in anchor) checkWord(anchor.word, `${path}.word`, ctx);
}

function checkClip(c: Clip, path: string, ctx: Ctx): void {
  if (!ctx.assets.has(c.asset)) ctx.errors.push({ path: `${path}.asset`, message: `unknown asset "${c.asset}"` });
  if (c.framing.mode === "split" && !ctx.assets.has(c.framing.asset)) {
    ctx.errors.push({ path: `${path}.framing.asset`, message: `unknown asset "${c.framing.asset}"` });
  }
}

function checkElement(el: Element, path: string, ctx: Ctx): Element {
  const parsed = checkElementProps(el, path, ctx.errors);
  checkAnchor(parsed.anchor, `${path}.anchor`, ctx);
  if (parsed.untilWord !== undefined) checkWord(parsed.untilWord, `${path}.untilWord`, ctx);
  if (ASSET_PROP_KINDS.has(parsed.kind)) {
    const asset = (parsed.props as { asset?: unknown }).asset;
    if (typeof asset === "string" && !ctx.assets.has(asset)) {
      ctx.errors.push({ path: `${path}.props.asset`, message: `unknown asset "${asset}"` });
    }
  }
  return parsed;
}

function checkCaption(c: Caption, path: string, ctx: Ctx): void {
  checkWord(c.words[0], `${path}.words[0]`, ctx);
  checkWord(c.words[1], `${path}.words[1]`, ctx);
  const first = ctx.words.get(c.words[0]);
  const last = ctx.words.get(c.words[1]);
  if (!first || !last) return;
  if (first.asset !== last.asset) {
    ctx.errors.push({ path: `${path}.words`, message: "a caption's first and last words must come from the same asset" });
  } else if (last.index < first.index) {
    ctx.errors.push({ path: `${path}.words`, message: "the last word comes before the first word" });
  }
}

function checkVariant(v: Variant, path: string, ctx: Ctx): Variant {
  const patch = { ...v.patch };
  if (patch.addElements) {
    patch.addElements = patch.addElements.map((el, k) => checkElement(el, `${path}.addElements[${k}]`, ctx));
  }
  patch.addCaptions?.forEach((c, k) => checkCaption(c, `${path}.addCaptions[${k}]`, ctx));
  patch.setStory?.forEach((c, k) => checkClip(c, `${path}.setStory[${k}]`, ctx));
  patch.setStructure?.beats.forEach((b, k) => {
    checkWord(b.from, `${path}.setStructure.beats[${k}].from`, ctx);
    checkWord(b.to, `${path}.setStructure.beats[${k}].to`, ctx);
  });
  return { ...v, patch };
}

export function parseProject(input: unknown): ParseResult<Project> {
  const r = ProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: toErrors(r.error) };
  const project = r.data;
  const errors: FieldError[] = [];
  const ctx: Ctx = { assets: new Map(project.assets.map((a) => [a.id, a])), words: indexWords(project), errors };

  duplicates(project.assets.map((a) => a.id), "assets", errors);
  duplicates(project.story.map((c) => c.id), "story", errors);
  duplicates(project.elements.map((e) => e.id), "elements", errors);
  duplicates(project.proposals.map((p) => p.id), "proposals", errors);

  for (const asset of Object.keys(project.transcript.words)) {
    if (!ctx.assets.has(asset)) errors.push({ path: `transcript.words.${asset}`, message: `unknown asset "${asset}"` });
  }
  const wordCount = Object.values(project.transcript.words).reduce((n, list) => n + list.length, 0);
  if (wordCount !== ctx.words.size) errors.push({ path: "transcript.words", message: "word ids must be unique across assets" });

  project.story.forEach((c, i) => checkClip(c, `story[${i}]`, ctx));
  const elements = project.elements.map((el, i) => checkElement(el, `elements[${i}]`, ctx));
  project.captions.forEach((c, i) => checkCaption(c, `captions[${i}]`, ctx));
  project.structure?.beats.forEach((b, i) => {
    checkWord(b.from, `structure.beats[${i}].from`, ctx);
    checkWord(b.to, `structure.beats[${i}].to`, ctx);
  });
  const proposals = project.proposals.map((p, i) => {
    if (p.anchor) checkAnchor(p.anchor, `proposals[${i}].anchor`, ctx);
    return { ...p, variants: p.variants.map((v, j) => checkVariant(v, `proposals[${i}].variants[${j}].patch`, ctx)) };
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...project, elements, proposals } };
}
```

Note: `checkVariant` receives the path of the patch, so error paths read `proposals[0].variants[0].patch.addElements[0].kind`.

Add to `packages/model/src/index.ts`:
```ts
export * from "./words";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all tests PASS (Task 3 tests still pass, 11 new); typecheck exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/model
git commit -m "feat(model): word index and cross-reference checks in parseProject

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Narrative frameworks

**Files:**
- Create: `packages/model/src/frameworks.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/frameworks.test.ts`

**Interfaces:**
- Produces: `interface FrameworkBeat { role: string; description: string; maxMs?: number }`, `interface Framework { id; name; beats: FrameworkBeat[]; rules: string[] }`, `FRAMEWORKS: Framework[]`, `CORE_RULES: string[]`, `getFramework(id): Framework | undefined`.

- [ ] **Step 1: Write the failing test**

`packages/model/tests/frameworks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CORE_RULES, FRAMEWORKS, getFramework } from "../src/frameworks";

describe("frameworks", () => {
  it("ships the five reels frameworks", () => {
    expect(FRAMEWORKS.map((f) => f.id)).toEqual(["hrst", "bab", "soar", "three-act", "open-loop"]);
  });

  it("orders the beats of each framework", () => {
    expect(getFramework("hrst")!.beats.map((b) => b.role)).toEqual(["hook", "relatable", "show", "takeaway"]);
    expect(getFramework("bab")!.beats.map((b) => b.role)).toEqual(["before", "after", "bridge"]);
    expect(getFramework("soar")!.beats.map((b) => b.role)).toEqual(["situation", "obstacle", "action", "results"]);
    expect(getFramework("three-act")!.beats.map((b) => b.role)).toEqual(["setup", "conflict", "resolution"]);
    expect(getFramework("open-loop")!.beats.map((b) => b.role)).toEqual(["curiosity", "explore", "closure"]);
  });

  it("gives every beat a description for Claude", () => {
    for (const f of FRAMEWORKS) for (const b of f.beats) expect(b.description.length).toBeGreaterThan(10);
  });

  it("limits the hook beat to 3 seconds and ties the open loop back to its hook", () => {
    expect(getFramework("hrst")!.beats[0]!.maxMs).toBe(3000);
    expect(getFramework("open-loop")!.rules).toContain("closure-ties-to-hook");
  });

  it("returns undefined for an unknown framework", () => {
    expect(getFramework("xyz")).toBeUndefined();
  });

  it("keeps the three core reels rules", () => {
    expect(CORE_RULES).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/frameworks`.

- [ ] **Step 3: Implement**

`packages/model/src/frameworks.ts`:
```ts
export interface FrameworkBeat {
  role: string;
  description: string;
  /** Upper bound for this beat's duration, checked by lint(). */
  maxMs?: number;
}

export interface Framework {
  id: string;
  name: string;
  beats: FrameworkBeat[];
  /** Checks that need judgment (done by Claude, not lint), e.g. "closure-ties-to-hook". */
  rules: string[];
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "hrst",
    name: "Hook, Relatable, Show, Takeaway",
    beats: [
      { role: "hook", description: "Stop the swipe in the first seconds with a visual or text hook.", maxMs: 3000 },
      { role: "relatable", description: "Name the situation or pain the viewer recognizes in their own life." },
      { role: "show", description: "Show the thing itself: the demo, the example, the proof." },
      { role: "takeaway", description: "Leave one clear lesson or call to action." },
    ],
    rules: [],
  },
  {
    id: "bab",
    name: "Before, After, Bridge",
    beats: [
      { role: "before", description: "Paint the situation before: the problem as the viewer lives it." },
      { role: "after", description: "Show the situation after: the result, the relief, the transformation." },
      { role: "bridge", description: "Explain how to get from before to after." },
    ],
    rules: [],
  },
  {
    id: "soar",
    name: "Situation, Obstacle, Action, Results",
    beats: [
      { role: "situation", description: "Frame the current context, background, or personal story." },
      { role: "obstacle", description: "Identify the core problem, barrier, or failure." },
      { role: "action", description: "Describe the steps taken to fix or overcome it." },
      { role: "results", description: "Showcase the final outcome or transformation to drive a lead or action." },
    ],
    rules: [],
  },
  {
    id: "three-act",
    name: "3-act structure (micro)",
    beats: [
      { role: "setup", description: "Hook the viewer in the first 3 seconds and state the premise." },
      { role: "conflict", description: "Build tension, share a mistake, or explore the struggle." },
      { role: "resolution", description: "Deliver the punchline, the lesson, or a strong call to action." },
    ],
    rules: [],
  },
  {
    id: "open-loop",
    name: "Open loop",
    beats: [
      { role: "curiosity", description: "Open with an intriguing statement, question, or unusual result." },
      { role: "explore", description: "Walk through the process quickly while keeping the pacing tight." },
      { role: "closure", description: "Tie the ending back to the opening hook so the video can replay seamlessly." },
    ],
    rules: ["closure-ties-to-hook"],
  },
];

export const CORE_RULES = [
  "The first 3 seconds: use a visual or text hook immediately to stop the swipe.",
  "Edit ruthlessly: cut any pause, breath, or filler word that does not push the narrative forward.",
  "Single focus: build the whole 15 to 60 second script around one idea, feeling, or lesson.",
];

export function getFramework(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./frameworks";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @adam-studio/model`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): HRST, BAB, SOAR, 3-act and open-loop frameworks as data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Story layout (source time to output time)

**Files:**
- Create: `packages/model/src/layout.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/layout.test.ts`

**Interfaces:**
- Consumes: `Clip`, `Project` (Task 3), `WordRef` (Task 4).
- Produces: `interface ClipLayout { clip: Clip; index: number; outStartMs: number; outEndMs: number }`, `interface StoryLayout { clips: ClipLayout[]; totalMs: number }`, `layoutStory(project: Pick<Project, "story">): StoryLayout`, `sourceToOutputMs(clips, asset, ms): number | null`, `wordOutput(clips, word): { startMs: number; endMs: number } | null`.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/layout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { layoutStory, sourceToOutputMs, wordOutput } from "../src/layout";
import { indexWords } from "../src/words";
import { makeProject } from "./helpers";

const cut = () =>
  makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 10000 }] });

describe("layoutStory", () => {
  it("lays clips end to end in milliseconds", () => {
    const { clips, totalMs } = layoutStory(cut());
    expect(clips.map((l) => [l.clip.id, l.outStartMs, l.outEndMs])).toEqual([["c1", 0, 2000], ["c2", 2000, 7000]]);
    expect(totalMs).toBe(7000);
  });
});

describe("sourceToOutputMs", () => {
  it("maps a kept moment through the cut", () => {
    const { clips } = layoutStory(cut());
    expect(sourceToOutputMs(clips, "a", 500)).toBe(500);
    expect(sourceToOutputMs(clips, "a", 5200)).toBe(2200);
  });
  it("returns null for a cut moment or another asset", () => {
    const { clips } = layoutStory(cut());
    expect(sourceToOutputMs(clips, "a", 3000)).toBeNull();
    expect(sourceToOutputMs(clips, "b", 500)).toBeNull();
  });
  it("maps a source range used twice to its first occurrence", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3000 }, { id: "c2", asset: "a", inMs: 0, outMs: 3000 }] });
    expect(sourceToOutputMs(layoutStory(p).clips, "a", 1800)).toBe(1800);
  });
});

describe("wordOutput", () => {
  it("maps a kept word and clips its end at the clip boundary", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 5200 }, { id: "c2", asset: "a", inMs: 7000, outMs: 9000 }] });
    const { clips } = layoutStory(p);
    const w = indexWords(p);
    expect(wordOutput(clips, w.get("a.w2")!)).toEqual({ startMs: 2600, endMs: 3100 });
    expect(wordOutput(clips, w.get("a.w5")!)).toEqual({ startMs: 5000, endMs: 5200 });
    expect(wordOutput(clips, w.get("a.w6")!)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/layout`.

- [ ] **Step 3: Implement**

`packages/model/src/layout.ts`:
```ts
import type { Clip, Project } from "./schema/project";
import type { WordRef } from "./words";

export interface ClipLayout {
  clip: Clip;
  index: number;
  outStartMs: number;
  outEndMs: number;
}

export interface StoryLayout {
  clips: ClipLayout[];
  totalMs: number;
}

/** Clips laid end to end (the story is magnetic: no gaps, no overlaps). */
export function layoutStory(project: Pick<Project, "story">): StoryLayout {
  let acc = 0;
  const clips = project.story.map((clip, index) => {
    const outStartMs = acc;
    acc += clip.outMs - clip.inMs;
    return { clip, index, outStartMs, outEndMs: acc };
  });
  return { clips, totalMs: acc };
}

/** Output time of a source moment, or null when it was cut. A range used twice maps to its first use. */
export function sourceToOutputMs(clips: ClipLayout[], asset: string, ms: number): number | null {
  for (const l of clips) {
    if (l.clip.asset === asset && ms >= l.clip.inMs && ms < l.clip.outMs) return l.outStartMs + (ms - l.clip.inMs);
  }
  return null;
}

/** Output span of a word, decided by where the word starts; its end is clipped at that clip's out point. */
export function wordOutput(clips: ClipLayout[], word: WordRef): { startMs: number; endMs: number } | null {
  for (const l of clips) {
    const c = l.clip;
    if (c.asset === word.asset && word.startMs >= c.inMs && word.startMs < c.outMs) {
      return {
        startMs: l.outStartMs + (word.startMs - c.inMs),
        endMs: l.outStartMs + (Math.min(word.endMs, c.outMs) - c.inMs),
      };
    }
  }
  return null;
}
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./layout";
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @adam-studio/model`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): story layout mapping source time to output time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Timeline schema and `resolve()` for clips, elements and audio

**Files:**
- Create: `packages/model/src/schema/timeline.ts`, `packages/model/src/merge.ts`, `packages/model/src/context.ts`, `packages/model/src/elements.ts`, `packages/model/src/resolve.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/resolve.test.ts`

**Interfaces:**
- Consumes: `layoutStory`, `wordOutput`, `ClipLayout` (Task 6); `indexWords`, `WordRef` (Task 4); `SfxPropsSchema` (Task 3); `msToFrame`, `canvasSize` (Task 2).
- Produces:
  - `src/schema/timeline.ts`: `TimelineClipSchema`, `TimelineElementSchema`, `TimelineCaptionSchema`, `TimelineBeatSchema`, `TimelineAudioSchema`, `TimelineSchema`; types `Timeline`, `TimelineClip`, `TimelineElement`, `TimelineCaption`, `TimelineBeat`, `TimelineAudio`.
  - `src/merge.ts`: `type Plain = Record<string, unknown>`, `deepMerge(base: Plain, patch: Plain): Plain`.
  - `src/context.ts`: `class ResolveError extends Error`, `interface ResolveContext { project; style; fps; clips; totalMs; words; orphans: string[]; warnings: string[]; frame(ms); place(slot, position?); wordOut(id) }`, `createContext(project, style): ResolveContext`, `anchorMs(ctx, anchor): number | null`, `mergeStyle(style, overrides): Style`.
  - `src/elements.ts`: `resolveElements(ctx): { elements: TimelineElement[]; sfx: TimelineAudio[] }`, `resolveClipAudio(ctx): TimelineAudio[]`.
  - `src/resolve.ts`: `resolve(project: Project, style: Style): Timeline` (Task 10 adds a third `options` parameter).

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/resolve.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";
import { TimelineSchema } from "../src/schema/timeline";
import type { ElementInput } from "../src/schema/project";
import { makeProject, makeStyle } from "./helpers";

const style = makeStyle();
const cut = { story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 10000 }] };
const word = (w: string, extra: Partial<ElementInput> = {}): ElementInput => ({
  id: "t", kind: "text.behindSubject", anchor: { word: w }, durationMs: 1000, props: { text: "HELLO" }, ...extra,
});

describe("resolve: clips", () => {
  it("places clips from accumulated milliseconds so rounding never drifts", () => {
    const tl = resolve(makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 1010 }, { id: "c2", asset: "a", inMs: 2000, outMs: 3010 }] }), style);
    expect(tl.clips.map((c) => [c.id, c.fromFrame, c.durationFrames])).toEqual([["c1", 0, 30], ["c2", 30, 31]]);
    expect(tl.durationFrames).toBe(61);
    expect(TimelineSchema.safeParse(tl).success).toBe(true);
  });

  it("sizes the canvas from the format", () => {
    const tl = resolve(makeProject({ canvas: { format: "16:9", fps: 30 } }), style);
    expect([tl.width, tl.height, tl.format]).toEqual([1920, 1080, "16:9"]);
  });
});

describe("resolve: elements", () => {
  it("follows the speech through a cut", () => {
    const tl = resolve(makeProject({ ...cut, elements: [word("a.w5")] }), style);
    expect(tl.elements[0]).toMatchObject({ id: "t", fromFrame: 60, durationFrames: 30, layer: "front" });
  });

  it("reports an element anchored to a cut word as an orphan", () => {
    const tl = resolve(makeProject({ ...cut, elements: [word("a.w3")] }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.orphans).toEqual(["t"]);
  });

  it("clamps an element that starts before 0", () => {
    const tl = resolve(makeProject({ elements: [word("a.w0", { anchor: { word: "a.w0", offsetMs: -2000 }, durationMs: 3000 })] }), style);
    expect(tl.elements[0]).toMatchObject({ fromFrame: 0, durationFrames: 60 });
  });

  it("drops and warns about an element with nothing visible", () => {
    const tl = resolve(makeProject({ elements: [word("a.w0", { anchor: { atMs: 20000 }, durationMs: 500 })] }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.warnings).toContain('element "t" has no visible duration and was dropped');
  });

  it("ends an element at a word or at the end", () => {
    const tl = resolve(makeProject({
      elements: [
        { id: "u", kind: "text.behindSubject", anchor: { word: "a.w0" }, untilWord: "a.w2", props: { text: "A" } },
        { id: "v", kind: "text.behindSubject", anchor: { atMs: 9000 }, untilEnd: true, props: { text: "B" } },
      ],
    }), style);
    expect(tl.elements.map((e) => [e.id, e.fromFrame, e.durationFrames])).toEqual([["u", 30, 63], ["v", 270, 30]]);
  });

  it("places elements by slot, by explicit position, and warns on an unknown slot", () => {
    const tl = resolve(makeProject({
      elements: [
        word("a.w0", { id: "s1", slot: "title" }),
        word("a.w0", { id: "s2", position: { x: 0.1, y: 0.9 } }),
        word("a.w0", { id: "s3", slot: "nowhere" }),
      ],
    }), style);
    expect(tl.elements.map((e) => [e.id, e.x, e.y])).toEqual([["s1", 0.5, 0.3], ["s2", 0.1, 0.9], ["s3", 0.5, 0.5]]);
    expect(tl.warnings).toContain('unknown slot "nowhere", placed at the center');
  });

  it("maps a source range used twice to its first occurrence", () => {
    const tl = resolve(makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3000 }, { id: "c2", asset: "a", inMs: 0, outMs: 3000 }],
      elements: [word("a.w1")],
    }), style);
    expect(tl.elements[0]!.fromFrame).toBe(54);
  });
});

describe("resolve: audio and style", () => {
  it("adds clip audio and turns sfx elements into audio items", () => {
    const tl = resolve(makeProject({
      assets: [
        { id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 30000, hasAudio: true } },
        { id: "s", kind: "audio", path: "s.wav" },
      ],
      elements: [{ id: "sfx1", kind: "sfx", anchor: { atMs: 500 }, durationMs: 400, props: { asset: "s", volume: 0.4 } }],
    }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.audio).toEqual([
      { id: "clip:c1", asset: "a", fromFrame: 0, durationFrames: 300, sourceInMs: 0, volume: 1, fadeInMs: 0, fadeOutMs: 0 },
      { id: "sfx1", asset: "s", fromFrame: 15, durationFrames: 12, sourceInMs: 0, volume: 0.4, fadeInMs: 0, fadeOutMs: 0 },
    ]);
  });

  it("skips clip audio for a silent video", () => {
    const tl = resolve(makeProject({ assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { hasAudio: false } }] }), style);
    expect(tl.audio).toEqual([]);
  });

  it("applies project style overrides on top of the style", () => {
    const tl = resolve(makeProject({ styleOverrides: { colors: { highlight: "#00FF00" } } }), style);
    expect(tl.style.colors).toEqual({ text: "#FFFFFF", highlight: "#00FF00", accent: "#FF6B35", ink: "#0E0C0A" });
  });
});
```

Expected values: w5 starts at 5000, kept in `c2` at output 2000 ms, frame 60. `u` runs from w0 start (1000 ms, frame 30) to w2 end (3100 ms, frame 93): 63 frames. `v` starts at 9000 ms (frame 270) and ends at 10000 ms (frame 300). w1 starts at 1800 ms, frame 54.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/resolve`.

- [ ] **Step 3: Implement the timeline schema**

`packages/model/src/schema/timeline.ts`:
```ts
import { z } from "zod";
import { FormatSchema, FramingSchema, TransitionOutSchema, ZoomSchema } from "./project";
import { StyleSchema } from "./style";

const Frame = z.number().int().nonnegative();
const Frames = z.number().int().positive();
const Ms = z.number().int().nonnegative();

export const TimelineClipSchema = z.object({
  id: z.string(),
  asset: z.string(),
  fromFrame: Frame,
  durationFrames: Frame,
  sourceInMs: Ms,
  sourceOutMs: Ms,
  framing: FramingSchema,
  zoom: ZoomSchema,
  transitionOut: TransitionOutSchema,
  volume: z.number().min(0),
});

export const TimelineElementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  layer: z.enum(["front", "behind-subject"]),
  fromFrame: Frame,
  durationFrames: Frames,
  x: z.number(),
  y: z.number(),
  props: z.record(z.string(), z.unknown()),
});

export const TimelineCaptionSchema = z.object({
  id: z.string(),
  fromFrame: Frame,
  durationFrames: Frames,
  text: z.string(),
  highlightRanges: z.array(z.tuple([Frame, Frame])),
  x: z.number(),
  y: z.number(),
});

export const TimelineBeatSchema = z.object({ role: z.string(), fromFrame: Frame, toFrame: Frame });

export const TimelineAudioSchema = z.object({
  id: z.string(),
  asset: z.string(),
  fromFrame: Frame,
  durationFrames: Frame,
  sourceInMs: Ms,
  volume: z.number().min(0),
  fadeInMs: Ms,
  fadeOutMs: Ms,
});

export const TimelineSchema = z.object({
  format: FormatSchema,
  width: Frames,
  height: Frames,
  fps: Frames,
  durationFrames: Frame,
  clips: z.array(TimelineClipSchema),
  elements: z.array(TimelineElementSchema),
  captions: z.array(TimelineCaptionSchema),
  beats: z.array(TimelineBeatSchema),
  audio: z.array(TimelineAudioSchema),
  orphans: z.array(z.string()),
  warnings: z.array(z.string()),
  style: StyleSchema,
});

export type TimelineClip = z.output<typeof TimelineClipSchema>;
export type TimelineElement = z.output<typeof TimelineElementSchema>;
export type TimelineCaption = z.output<typeof TimelineCaptionSchema>;
export type TimelineBeat = z.output<typeof TimelineBeatSchema>;
export type TimelineAudio = z.output<typeof TimelineAudioSchema>;
export type Timeline = z.output<typeof TimelineSchema>;
```

(`highlightRanges` holds character offsets; `Frame` is reused only as "non-negative integer".)

- [ ] **Step 4: Implement deep merge and the resolve context**

`packages/model/src/merge.ts`:
```ts
export type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge of plain objects; arrays and scalars from `patch` replace those in `base`. */
export function deepMerge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const current = out[k];
    out[k] = isPlain(v) && isPlain(current) ? deepMerge(current, v) : v;
  }
  return out;
}
```

`packages/model/src/context.ts`:
```ts
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
```

- [ ] **Step 5: Implement elements, audio and `resolve()`**

`packages/model/src/elements.ts`:
```ts
import { anchorMs, type ResolveContext } from "./context";
import { SfxPropsSchema } from "./schema/kinds";
import type { TimelineAudio, TimelineElement } from "./schema/timeline";

export function resolveElements(ctx: ResolveContext): { elements: TimelineElement[]; sfx: TimelineAudio[] } {
  const elements: TimelineElement[] = [];
  const sfx: TimelineAudio[] = [];
  for (const el of ctx.project.elements) {
    const start = anchorMs(ctx, el.anchor);
    if (start === null) {
      ctx.orphans.push(el.id);
      continue;
    }
    let end: number | null;
    if (el.durationMs !== undefined) end = start + el.durationMs;
    else if (el.untilWord !== undefined) {
      const out = ctx.wordOut(el.untilWord);
      end = out === null ? null : out.endMs;
    } else end = ctx.totalMs;
    if (end === null) {
      ctx.orphans.push(el.id);
      continue;
    }
    const fromFrame = ctx.frame(Math.max(0, start));
    const toFrame = ctx.frame(Math.min(ctx.totalMs, end));
    if (toFrame - fromFrame < 1) {
      ctx.warnings.push(`element "${el.id}" has no visible duration and was dropped`);
      continue;
    }
    if (el.kind === "sfx") {
      const p = SfxPropsSchema.parse(el.props);
      sfx.push({
        id: el.id,
        asset: p.asset,
        fromFrame,
        durationFrames: toFrame - fromFrame,
        sourceInMs: 0,
        volume: p.volume,
        fadeInMs: p.fadeInMs,
        fadeOutMs: p.fadeOutMs,
      });
      continue;
    }
    const { x, y } = ctx.place(el.slot, el.position);
    elements.push({ id: el.id, kind: el.kind, layer: el.layer, fromFrame, durationFrames: toFrame - fromFrame, x, y, props: el.props });
  }
  return { elements, sfx };
}

export function resolveClipAudio(ctx: ResolveContext): TimelineAudio[] {
  const assets = new Map(ctx.project.assets.map((a) => [a.id, a]));
  return ctx.clips
    .filter((l) => {
      const a = assets.get(l.clip.asset);
      return a !== undefined && (a.kind === "audio" || (a.kind === "video" && a.meta.hasAudio !== false));
    })
    .map((l) => ({
      id: `clip:${l.clip.id}`,
      asset: l.clip.asset,
      fromFrame: ctx.frame(l.outStartMs),
      durationFrames: ctx.frame(l.outEndMs) - ctx.frame(l.outStartMs),
      sourceInMs: l.clip.inMs,
      volume: l.clip.volume,
      fadeInMs: 0,
      fadeOutMs: 0,
    }));
}
```

`packages/model/src/resolve.ts`:
```ts
import { canvasSize } from "./time";
import type { Project } from "./schema/project";
import type { Style } from "./schema/style";
import type { Timeline, TimelineBeat, TimelineCaption } from "./schema/timeline";
import { createContext, mergeStyle } from "./context";
import { resolveClipAudio, resolveElements } from "./elements";

export { ResolveError } from "./context";

export function resolve(projectIn: Project, styleIn: Style): Timeline {
  const project = projectIn;
  const style = mergeStyle(styleIn, project.styleOverrides);
  const ctx = createContext(project, style);
  const { width, height } = canvasSize(project.canvas.format);
  const clips = ctx.clips.map((l) => ({
    id: l.clip.id,
    asset: l.clip.asset,
    fromFrame: ctx.frame(l.outStartMs),
    durationFrames: ctx.frame(l.outEndMs) - ctx.frame(l.outStartMs),
    sourceInMs: l.clip.inMs,
    sourceOutMs: l.clip.outMs,
    framing: l.clip.framing,
    zoom: l.clip.zoom,
    transitionOut: l.clip.transitionOut,
    volume: l.clip.volume,
  }));
  const { elements, sfx } = resolveElements(ctx);
  const captions: TimelineCaption[] = [];
  const beats: TimelineBeat[] = [];
  return {
    format: project.canvas.format,
    width,
    height,
    fps: ctx.fps,
    durationFrames: ctx.frame(ctx.totalMs),
    clips,
    elements,
    captions,
    beats,
    audio: [...resolveClipAudio(ctx), ...sfx],
    orphans: ctx.orphans,
    warnings: ctx.warnings,
    style,
  };
}
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./schema/timeline";
export * from "./merge";
export { anchorMs, createContext, mergeStyle, type ResolveContext } from "./context";
export * from "./resolve";
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/model
git commit -m "feat(model): timeline schema and resolve() for clips, anchored elements and audio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Captions and beats in `resolve()`

**Files:**
- Create: `packages/model/src/text.ts`, `packages/model/src/captions.ts`
- Modify: `packages/model/src/resolve.ts`, `packages/model/src/index.ts`
- Test: `packages/model/tests/captions.test.ts`

**Interfaces:**
- Consumes: `ResolveContext`, `ResolveError` (Task 7).
- Produces: `src/text.ts`: `wrapCaption(text, maxChars): string`, `findHighlights(text, phrases): { ranges: [number, number][]; missing: string[] }`, `normalizeWord(text): string`. `src/captions.ts`: `resolveCaptions(ctx): TimelineCaption[]`, `resolveBeats(ctx): TimelineBeat[]`. `resolve()` now fills `captions` and `beats`.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/captions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";
import { findHighlights, normalizeWord, wrapCaption } from "../src/text";
import { makeProject, makeStyle } from "./helpers";

const style = makeStyle();
const cut = { story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 10000 }] };

describe("wrapCaption", () => {
  it("keeps short text on one line", () => {
    expect(wrapCaption("here in France", 22)).toBe("here in France");
  });
  it("splits long text into two balanced lines", () => {
    expect(wrapCaption("I just started my first company", 22)).toBe("I just started\nmy first company");
  });
  it("leaves text that already has a line break alone", () => {
    expect(wrapCaption("one\ntwo three four five six seven", 22)).toBe("one\ntwo three four five six seven");
  });
});

describe("findHighlights", () => {
  it("finds a phrase split by the line break", () => {
    expect(findHighlights("selling these\nskills now", ["these skills"])).toEqual({ ranges: [[8, 20]], missing: [] });
  });
  it("reports a missing phrase instead of failing", () => {
    expect(findHighlights("hello", ["bye"])).toEqual({ ranges: [], missing: ["bye"] });
  });
});

describe("normalizeWord", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeWord("Euh,")).toBe("euh");
  });
});

describe("resolve: captions", () => {
  it("splits a caption that straddles a cut into one piece per kept range", () => {
    const tl = resolve(makeProject({ ...cut, captions: [{ words: ["a.w1", "a.w5"], text: "un deux trois quatre cinq" }] }), style);
    expect(tl.captions.map((c) => [c.id, c.fromFrame, c.durationFrames])).toEqual([["cap0.0", 54, 6], ["cap0.1", 60, 15]]);
  });

  it("orphans a caption whose words were all cut", () => {
    const tl = resolve(makeProject({ ...cut, captions: [{ words: ["a.w2", "a.w3"], text: "deux trois" }] }), style);
    expect(tl.captions).toEqual([]);
    expect(tl.orphans).toEqual(["caption:0"]);
  });

  it("wraps text with the style limit and computes highlight ranges on the wrapped text", () => {
    const tl = resolve(makeProject({
      captions: [{ words: ["a.w0", "a.w3"], text: "I just started my first company", highlight: ["first company"] }],
    }), style);
    expect(tl.captions[0]).toMatchObject({ id: "cap0", text: "I just started\nmy first company", highlightRanges: [[18, 31]], x: 0.5, y: 0.76 });
  });

  it("warns when a highlight is not in the caption", () => {
    const tl = resolve(makeProject({ captions: [{ words: ["a.w0", "a.w1"], text: "zero un", highlight: ["deux"] }] }), style);
    expect(tl.captions).toHaveLength(1);
    expect(tl.warnings).toContain('caption 0: highlight "deux" not found in "zero un"');
  });
});

describe("resolve: beats", () => {
  it("turns beats into frame ranges and orphans a beat on a cut word", () => {
    const tl = resolve(makeProject({
      ...cut,
      structure: { framework: "soar", beats: [
        { role: "situation", from: "a.w0", to: "a.w2" },
        { role: "obstacle", from: "a.w5", to: "a.w6" },
      ] },
    }), style);
    expect(tl.beats).toEqual([{ role: "obstacle", fromFrame: 60, toFrame: 99 }]);
    expect(tl.orphans).toEqual(["beat:situation"]);
  });
});
```

Expected values: piece 1 is w1 start 1800 ms to the cut at 2000 ms (frames 54 to 60); piece 2 is 5000 to 5500 ms in source, 2000 to 2500 ms in output (frames 60 to 75). Obstacle runs from w5 at output 2000 ms (frame 60) to w6 end: source 6300 ms, output 3300 ms (frame 99).

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/text`.

- [ ] **Step 3: Implement the text helpers**

`packages/model/src/text.ts`:
```ts
/** Two balanced lines when the text is longer than maxChars and has no manual break. */
export function wrapCaption(text: string, maxChars: number): string {
  if (text.length <= maxChars || text.includes("\n")) return text;
  const words = text.split(" ");
  if (words.length < 2) return text;
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Character ranges of each phrase, case-insensitive, tolerant to a line break between its words. */
export function findHighlights(text: string, phrases: string[]): { ranges: [number, number][]; missing: string[] } {
  const ranges: [number, number][] = [];
  const missing: string[] = [];
  for (const phrase of phrases) {
    const pattern = phrase.trim().split(/\s+/).map(escapeRegExp).join("[ \\n]+");
    const m = new RegExp(pattern, "i").exec(text);
    if (m) ranges.push([m.index, m.index + m[0].length]);
    else missing.push(phrase);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { ranges, missing };
}

export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:…"«»()]/g, "").trim();
}
```

- [ ] **Step 4: Implement captions and beats**

`packages/model/src/captions.ts`:
```ts
import { ResolveError, type ResolveContext } from "./context";
import type { TimelineBeat, TimelineCaption } from "./schema/timeline";
import { findHighlights, wrapCaption } from "./text";

/** Pieces shorter than this after a cut are dropped. */
const MIN_PIECE_MS = 50;

export function resolveCaptions(ctx: ResolveContext): TimelineCaption[] {
  const out: TimelineCaption[] = [];
  const pos = ctx.place("caption");
  ctx.project.captions.forEach((c, i) => {
    const first = ctx.words.get(c.words[0]);
    const last = ctx.words.get(c.words[1]);
    if (!first || !last) throw new ResolveError(`caption ${i} references unknown words`);
    const pieces: [number, number][] = [];
    for (const l of ctx.clips) {
      if (l.clip.asset !== first.asset) continue;
      const s = Math.max(first.startMs, l.clip.inMs);
      const e = Math.min(last.endMs, l.clip.outMs);
      if (e - s > MIN_PIECE_MS) pieces.push([l.outStartMs + s - l.clip.inMs, l.outStartMs + e - l.clip.inMs]);
    }
    if (pieces.length === 0) {
      ctx.orphans.push(`caption:${i}`);
      return;
    }
    const text = wrapCaption(c.text, ctx.style.caption.maxCharsPerLine);
    const { ranges, missing } = findHighlights(text, c.highlight);
    for (const m of missing) ctx.warnings.push(`caption ${i}: highlight "${m}" not found in "${c.text}"`);
    pieces.forEach(([s, e], k) => {
      const fromFrame = ctx.frame(s);
      out.push({
        id: pieces.length > 1 ? `cap${i}.${k}` : `cap${i}`,
        fromFrame,
        durationFrames: Math.max(1, ctx.frame(e) - fromFrame),
        text,
        highlightRanges: ranges,
        x: pos.x,
        y: pos.y,
      });
    });
  });
  return out.sort((a, b) => a.fromFrame - b.fromFrame);
}

export function resolveBeats(ctx: ResolveContext): TimelineBeat[] {
  const beats: TimelineBeat[] = [];
  for (const b of ctx.project.structure?.beats ?? []) {
    const from = ctx.wordOut(b.from);
    const to = ctx.wordOut(b.to);
    if (from === null || to === null) {
      ctx.orphans.push(`beat:${b.role}`);
      continue;
    }
    beats.push({ role: b.role, fromFrame: ctx.frame(from.startMs), toFrame: ctx.frame(to.endMs) });
  }
  return beats;
}
```

- [ ] **Step 5: Wire them into `resolve()`**

In `packages/model/src/resolve.ts`, replace:
```ts
import type { Timeline, TimelineBeat, TimelineCaption } from "./schema/timeline";
```
with:
```ts
import type { Timeline } from "./schema/timeline";
import { resolveBeats, resolveCaptions } from "./captions";
```
and replace:
```ts
  const captions: TimelineCaption[] = [];
  const beats: TimelineBeat[] = [];
```
with:
```ts
  const captions = resolveCaptions(ctx);
  const beats = resolveBeats(ctx);
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./text";
export * from "./captions";
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/model
git commit -m "feat(model): captions split by cuts, wrapped with highlights, and beats in resolve()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Transcript editing (`cutWords`, `restoreWords`, `trimToWords`)

**Files:**
- Create: `packages/model/src/transcript.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/transcript.test.ts`

**Interfaces:**
- Consumes: `indexWords`, `WordRef` (Task 4); `Project`, `Clip` (Task 3).
- Produces: `class EditError extends Error`, `cutWords(project, wordIds): Project`, `restoreWords(project, wordIds): Project`, `trimToWords(project, clipId, firstWordId, lastWordId, pad?: { beforeMs: number; afterMs: number }): Project`.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/transcript.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { EditError, cutWords, restoreWords, trimToWords } from "../src/transcript";
import { makeProject } from "./helpers";

const ranges = (p: ReturnType<typeof makeProject>) => p.story.map((c) => [c.id, c.inMs, c.outMs]);

describe("cutWords", () => {
  it("removes the span of consecutive words by splitting the clip", () => {
    const p = cutWords(makeProject(), ["a.w3", "a.w4"]);
    expect(ranges(p)).toEqual([["c1", 0, 3400], ["c1~2", 4700, 10000]]);
  });

  it("keeps the clip id when the cut is at its start", () => {
    const p = cutWords(makeProject({ story: [{ id: "c1", asset: "a", inMs: 1000, outMs: 10000 }] }), ["a.w0"]);
    expect(ranges(p)).toEqual([["c1", 1500, 10000]]);
  });

  it("moves the outgoing transition to the last piece", () => {
    const p = cutWords(makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 10000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }],
    }), ["a.w3"]);
    expect(p.story.map((c) => c.transitionOut.kind)).toEqual(["cut", "subjectSlide"]);
  });

  it("throws on an unknown word", () => {
    expect(() => cutWords(makeProject(), ["a.w99"])).toThrow(EditError);
  });
});

describe("restoreWords", () => {
  it("undoes a cut exactly, transition included", () => {
    const original = makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 10000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }],
    });
    const back = restoreWords(cutWords(original, ["a.w3", "a.w4"]), ["a.w3", "a.w4"]);
    expect(back.story).toEqual(original.story);
  });

  it("inserts a clip for words far from any kept range", () => {
    const p = restoreWords(makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }] }), ["a.w9"]);
    expect(ranges(p)).toEqual([["c1", 0, 2000], ["c1~2", 8200, 8700]]);
  });

  it("does nothing for words already kept", () => {
    const p = makeProject();
    expect(restoreWords(p, ["a.w2"]).story).toEqual(p.story);
  });

  it("refuses words of an asset that is not in the story", () => {
    const p = makeProject({
      assets: [{ id: "a", kind: "video", path: "a.mp4" }, { id: "b", kind: "video", path: "b.mp4" }],
      transcript: { lang: "fr", words: { a: [], b: [{ id: "b.w0", text: "x", startMs: 0, endMs: 100 }] } },
    });
    expect(() => restoreWords(p, ["b.w0"])).toThrow(/not in the story/);
  });
});

describe("trimToWords", () => {
  it("trims a clip to its words with padding", () => {
    const p = trimToWords(makeProject(), "c1", "a.w1", "a.w3");
    expect(ranges(p)).toEqual([["c1", 1720, 3960]]);
  });

  it("clamps to the asset duration", () => {
    const p = trimToWords(makeProject({ assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 8720 } }] }), "c1", "a.w8", "a.w9");
    expect(ranges(p)).toEqual([["c1", 7320, 8720]]);
  });

  it("throws on an unknown clip", () => {
    expect(() => trimToWords(makeProject(), "zz", "a.w1", "a.w3")).toThrow(EditError);
  });
});
```

Expected values: w3 is 3400 to 3900 ms and w4 is 4200 to 4700 ms, so the cut removes 3400 to 4700. w1 starts at 1800 (minus 80 = 1720), w3 ends at 3900 (plus 60 = 3960). w8 starts at 7400 (minus 80 = 7320), w9 ends at 8700 (plus 60 = 8760, clamped to 8720).

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/transcript`.

- [ ] **Step 3: Implement**

`packages/model/src/transcript.ts`:
```ts
import type { Clip, Project } from "./schema/project";
import { indexWords, type WordRef } from "./words";

export class EditError extends Error {}

function refsOf(project: Project, wordIds: string[]): WordRef[] {
  const words = indexWords(project);
  return wordIds.map((id) => {
    const w = words.get(id);
    if (!w) throw new EditError(`unknown word "${id}"`);
    return w;
  });
}

/** Groups words into runs of consecutive words of the same asset. */
function runs(refs: WordRef[]): WordRef[][] {
  const sorted = [...refs].sort((a, b) => (a.asset === b.asset ? a.index - b.index : a.asset < b.asset ? -1 : 1));
  const out: WordRef[][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && prev.asset === w.asset && w.index === prev.index + 1) last.push(w);
    else if (!(prev && prev.id === w.id)) out.push([w]);
  }
  return out;
}

function uniqueId(base: string, ids: Set<string>): string {
  let n = 2;
  while (ids.has(`${base}~${n}`)) n++;
  const id = `${base}~${n}`;
  ids.add(id);
  return id;
}

export function cutWords(project: Project, wordIds: string[]): Project {
  let story = project.story;
  const ids = new Set(story.map((c) => c.id));
  for (const run of runs(refsOf(project, wordIds))) {
    const first = run[0]!;
    const s = first.startMs;
    const e = run[run.length - 1]!.endMs;
    story = story.flatMap((c): Clip[] => {
      if (c.asset !== first.asset || e <= c.inMs || s >= c.outMs) return [c];
      const parts: Clip[] = [];
      if (s > c.inMs) parts.push({ ...c, outMs: s, transitionOut: e < c.outMs ? { kind: "cut" } : c.transitionOut });
      if (e < c.outMs) parts.push({ ...c, id: parts.length ? uniqueId(c.id, ids) : c.id, inMs: e });
      return parts;
    });
  }
  return { ...project, story };
}

export function restoreWords(project: Project, wordIds: string[]): Project {
  const story = [...project.story];
  const ids = new Set(story.map((c) => c.id));
  for (const run of runs(refsOf(project, wordIds))) {
    const asset = run[0]!.asset;
    const s = run[0]!.startMs;
    const e = run[run.length - 1]!.endMs;
    if (story.some((c) => c.asset === asset && s >= c.inMs && e <= c.outMs)) continue;
    let at = -1;
    story.forEach((c, k) => {
      if (c.asset === asset && c.outMs <= s) at = k;
    });
    let neighbour: Clip | undefined = story[at];
    let insertAt = at + 1;
    if (at < 0) {
      insertAt = story.findIndex((c) => c.asset === asset && c.inMs >= e);
      if (insertAt < 0) throw new EditError(`cannot restore: asset "${asset}" is not in the story`);
      neighbour = story[insertAt];
    }
    const template = neighbour!;
    story.splice(insertAt, 0, { ...template, id: uniqueId(template.id, ids), inMs: s, outMs: e, transitionOut: { kind: "cut" } });
    // Merge with the clips it touches, so a cut followed by a restore gives back the original clip.
    const i = insertAt;
    const next = story[i + 1];
    if (next && next.asset === asset && next.inMs === e) {
      story.splice(i, 2, { ...story[i]!, outMs: next.outMs, transitionOut: next.transitionOut, id: next.id });
    }
    const prev = story[i - 1];
    if (prev && prev.asset === asset && prev.outMs === s) {
      const cur = story[i]!;
      story.splice(i - 1, 2, { ...prev, outMs: cur.outMs, transitionOut: cur.transitionOut });
    }
  }
  return { ...project, story };
}

export function trimToWords(
  project: Project,
  clipId: string,
  firstWordId: string,
  lastWordId: string,
  pad: { beforeMs: number; afterMs: number } = { beforeMs: 80, afterMs: 60 },
): Project {
  const idx = project.story.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new EditError(`unknown clip "${clipId}"`);
  const clip = project.story[idx]!;
  const [first, last] = refsOf(project, [firstWordId, lastWordId]);
  if (first!.asset !== clip.asset || last!.asset !== clip.asset) {
    throw new EditError(`words must belong to the clip's asset "${clip.asset}"`);
  }
  const duration = project.assets.find((a) => a.id === clip.asset)?.meta.durationMs ?? Number.POSITIVE_INFINITY;
  const inMs = Math.max(0, first!.startMs - pad.beforeMs);
  const outMs = Math.min(duration, last!.endMs + pad.afterMs);
  if (outMs <= inMs) throw new EditError(`trimming "${clipId}" would leave nothing`);
  const story = project.story.map((c, k) => (k === idx ? { ...c, inMs, outMs } : c));
  return { ...project, story };
}
```

Merge order matters: merging with `next` first keeps `next.id` and its transition (the right piece of an earlier cut), then merging with `prev` keeps `prev.id`. After a cut of `c1` into `c1` and `c1~2`, restore inserts `c1~3`, merges it with `c1~2` (taking id `c1~2` and its transition), then with `c1`, which keeps id `c1` and the transition: the original clip comes back.

Add to `packages/model/src/index.ts`:
```ts
export * from "./transcript";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): cut, restore and trim the story from transcript words

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Guided workflow (`applyPatch`, `decide`) and virtual variants in `resolve()`

**Files:**
- Create: `packages/model/src/workflow.ts`
- Modify: `packages/model/src/resolve.ts`, `packages/model/src/index.ts`
- Test: `packages/model/tests/workflow.test.ts`

**Interfaces:**
- Consumes: `STEP_IDS`, `Patch`, `Proposal`, `VariantKey`, `Workflow`, `Project` (Task 3); `deepMerge` (Task 7); `resolve` (Task 7).
- Produces: `class WorkflowError extends Error`, `type Decision = VariantKey | "reject" | "more"`, `newWorkflow(): Workflow`, `applyPatch(project, patch): Project`, `decide(project, proposalId, decision, note?): Project`, `interface ResolveOptions { apply?: { proposal: string; variant: VariantKey } }`, and `resolve(project, style, options?: ResolveOptions)`.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/workflow.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";
import { WorkflowError, applyPatch, decide, newWorkflow } from "../src/workflow";
import { makeProject, makeStyle } from "./helpers";

/** A fully defaulted element: valid both as project input and as an already-parsed Element for applyPatch. */
const text = (id: string) => ({
  id, kind: "text.behindSubject", layer: "front" as const, anchor: { atMs: 0 }, durationMs: 1000,
  slot: "center", props: { text: id, color: "accent", sizeScale: 1 },
});

function guided() {
  return makeProject({
    workflow: newWorkflow(),
    proposals: [
      {
        id: "p1", step: "cuts", reason: "cut plan",
        variants: [
          { key: "A", label: "tight", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 5000 }] } },
          { key: "B", label: "balanced", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 8000 }] } },
          { key: "C", label: "loose", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 9500 }] } },
        ],
      },
      {
        id: "p2", step: "visuals", reason: "mention of jobless.fr",
        variants: [{ key: "A", label: "word behind", patch: { addElements: [text("jobless")] } }],
      },
    ],
  });
}

describe("newWorkflow", () => {
  it("opens the cuts step and locks the others", () => {
    const wf = newWorkflow();
    expect(wf.current).toBe("cuts");
    expect(wf.steps).toEqual({
      cuts: "open", structure: "locked", captions: "locked", hook: "locked",
      beats: "locked", visuals: "locked", sound: "locked", look: "locked",
    });
  });
});

describe("decide", () => {
  it("applies the chosen variant and opens the next step", () => {
    const p = decide(guided(), "p1", "B");
    expect(p.story.map((c) => c.outMs)).toEqual([8000]);
    expect(p.proposals[0]!.status).toEqual({ accepted: "B" });
    expect(p.workflow).toMatchObject({ current: "structure", steps: { cuts: "done", structure: "open" } });
  });

  it("rejects without applying anything", () => {
    const before = guided();
    const p = decide(before, "p1", "reject");
    expect(p.story).toEqual(before.story);
    expect(p.proposals[0]!.status).toBe("rejected");
    expect(p.workflow!.steps.cuts).toBe("done");
  });

  it("asks for more: keeps the variants in history and stays pending", () => {
    const p = decide(guided(), "p1", "more", "less tight");
    const prop = p.proposals[0]!;
    expect(prop.status).toBe("pending");
    expect(prop.variants).toEqual([]);
    expect(prop.history).toHaveLength(1);
    expect(prop.history[0]).toMatchObject({ decision: "more", note: "less tight" });
    expect(prop.history[0]!.variants.map((v) => v.key)).toEqual(["A", "B", "C"]);
    expect(p.workflow!.current).toBe("cuts");
  });

  it("refuses a variant after more emptied the list", () => {
    const p = decide(guided(), "p1", "more");
    expect(() => decide(p, "p1", "A")).toThrow('proposal "p1" has no variant A');
  });

  it("refuses a proposal of a locked step", () => {
    expect(() => decide(guided(), "p2", "A")).toThrow(WorkflowError);
    expect(() => decide(guided(), "p2", "A")).toThrow(/locked/);
  });

  it("refuses to decide twice", () => {
    const p = decide(guided(), "p1", "A");
    expect(() => decide(p, "p1", "B")).toThrow('proposal "p1" is already decided');
  });

  it("refuses an unknown proposal", () => {
    expect(() => decide(guided(), "p9", "A")).toThrow(WorkflowError);
  });
});

describe("applyPatch", () => {
  it("adds and removes elements, appends captions, merges style overrides", () => {
    const base = makeProject({ elements: [text("old")] });
    const p = applyPatch(base, {
      removeElements: ["old"],
      addElements: [text("new")],
      addCaptions: [{ words: ["a.w0", "a.w1"], text: "zero un", highlight: [] }],
      setStyle: { colors: { highlight: "#00FF00" } },
    });
    expect(p.elements.map((e) => e.id)).toEqual(["new"]);
    expect(p.captions).toHaveLength(1);
    expect(p.styleOverrides).toEqual({ colors: { highlight: "#00FF00" } });
  });

  it("refuses an element id that already exists", () => {
    const base = makeProject({ elements: [text("x")] });
    expect(() => applyPatch(base, { addElements: [text("x")] })).toThrow('element id "x" already exists');
  });
});

describe("resolve with a virtual variant", () => {
  it("shows a pending variant only when asked", () => {
    const style = makeStyle();
    const p = guided();
    expect(resolve(p, style).elements).toEqual([]);
    expect(resolve(p, style, { apply: { proposal: "p2", variant: "A" } }).elements.map((e) => e.id)).toEqual(["jobless"]);
  });

  it("names a bad proposal or variant", () => {
    const style = makeStyle();
    expect(() => resolve(guided(), style, { apply: { proposal: "p2", variant: "C" } })).toThrow('proposal "p2" has no variant C');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/workflow`.

- [ ] **Step 3: Implement the workflow**

`packages/model/src/workflow.ts`:
```ts
import { STEP_IDS, type Patch, type Project, type Proposal, type StepId, type VariantKey, type Workflow } from "./schema/project";
import { deepMerge } from "./merge";

export class WorkflowError extends Error {}

export type Decision = VariantKey | "reject" | "more";

export function newWorkflow(): Workflow {
  const steps = Object.fromEntries(STEP_IDS.map((s) => [s, s === "cuts" ? "open" : "locked"])) as Workflow["steps"];
  return { current: "cuts", steps };
}

export function applyPatch(project: Project, patch: Patch): Project {
  let next: Project = { ...project };
  if (patch.setStory) next = { ...next, story: patch.setStory };
  if (patch.setStructure) next = { ...next, structure: patch.setStructure };
  if (patch.removeElements) {
    const rm = new Set(patch.removeElements);
    next = { ...next, elements: next.elements.filter((e) => !rm.has(e.id)) };
  }
  if (patch.addElements) {
    const ids = new Set(next.elements.map((e) => e.id));
    for (const e of patch.addElements) {
      if (ids.has(e.id)) throw new WorkflowError(`element id "${e.id}" already exists`);
      ids.add(e.id);
    }
    next = { ...next, elements: [...next.elements, ...patch.addElements] };
  }
  if (patch.addCaptions) next = { ...next, captions: [...next.captions, ...patch.addCaptions] };
  if (patch.setStyle) next = { ...next, styleOverrides: deepMerge(next.styleOverrides, patch.setStyle) };
  return next;
}

/** Closes the current step when all its proposals are decided, and opens the next one. */
function advance(project: Project): Project {
  const wf = project.workflow;
  if (!wf) return project;
  const steps = { ...wf.steps };
  let current: StepId = wf.current;
  for (;;) {
    const ofStep = project.proposals.filter((p) => p.step === current);
    if (steps[current] !== "open" || ofStep.length === 0 || ofStep.some((p) => p.status === "pending")) break;
    steps[current] = "done";
    const nextStep = STEP_IDS[STEP_IDS.indexOf(current) + 1];
    if (!nextStep) break;
    steps[nextStep] = "open";
    current = nextStep;
  }
  return { ...project, workflow: { current, steps } };
}

export function decide(project: Project, proposalId: string, decision: Decision, note?: string): Project {
  const idx = project.proposals.findIndex((p) => p.id === proposalId);
  if (idx < 0) throw new WorkflowError(`unknown proposal "${proposalId}"`);
  const p = project.proposals[idx]!;
  if (p.status !== "pending") throw new WorkflowError(`proposal "${p.id}" is already decided`);
  const wf = project.workflow;
  if (wf && wf.steps[p.step] === "locked") {
    throw new WorkflowError(`step "${p.step}" is locked: finish "${wf.current}" first`);
  }
  let next = project;
  let updated: Proposal;
  if (decision === "reject") {
    updated = { ...p, status: "rejected" };
  } else if (decision === "more") {
    const entry = note === undefined
      ? { variants: p.variants, decision: "more" as const }
      : { variants: p.variants, decision: "more" as const, note };
    updated = { ...p, variants: [], history: [...p.history, entry] };
  } else {
    const v = p.variants.find((x) => x.key === decision);
    if (!v) throw new WorkflowError(`proposal "${p.id}" has no variant ${decision}`);
    next = applyPatch(project, v.patch);
    updated = { ...p, status: { accepted: decision } };
  }
  next = { ...next, proposals: next.proposals.map((x, i) => (i === idx ? updated : x)) };
  return advance(next);
}
```

- [ ] **Step 4: Add the `apply` option to `resolve()`**

In `packages/model/src/resolve.ts`, add the import:
```ts
import { ResolveError } from "./context";
import { applyPatch } from "./workflow";
import type { VariantKey } from "./schema/project";
```
replace:
```ts
export function resolve(projectIn: Project, styleIn: Style): Timeline {
  const project = projectIn;
```
with:
```ts
export interface ResolveOptions {
  /** Applies one pending variant virtually, for previews. */
  apply?: { proposal: string; variant: VariantKey };
}

export function resolve(projectIn: Project, styleIn: Style, options: ResolveOptions = {}): Timeline {
  let project = projectIn;
  if (options.apply) {
    const { proposal, variant } = options.apply;
    const p = project.proposals.find((x) => x.id === proposal);
    if (!p) throw new ResolveError(`unknown proposal "${proposal}"`);
    const v = p.variants.find((x) => x.key === variant);
    if (!v) throw new ResolveError(`proposal "${proposal}" has no variant ${variant}`);
    project = applyPatch(project, v.patch);
  }
```
and change `export { ResolveError } from "./context";` to `export { ResolveError };`.

Add to `packages/model/src/index.ts`:
```ts
export * from "./workflow";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/model
git commit -m "feat(model): guided workflow with decide(), patches and virtual variants in resolve()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `lint()`

**Files:**
- Create: `packages/model/src/lint.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/lint.test.ts`

**Interfaces:**
- Consumes: `layoutStory`, `wordOutput` (Task 6); `indexWords` (Task 4); `getFramework` (Task 5); `normalizeWord` (Task 8); `Timeline` (Task 7); `Project` (Task 3).
- Produces: `interface LintWarning { rule: string; severity: "error" | "warning"; message: string; ids: string[] }`, `interface LintOptions { projectDir?: string; fileExists?: (path: string) => boolean }`, `lint(project, timeline, options?): LintWarning[]`.

- [ ] **Step 1: Write the failing tests**

`packages/model/tests/lint.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { lint, type LintOptions } from "../src/lint";
import { resolve } from "../src/resolve";
import type { ProjectInput } from "../src/schema/project";
import { makeProject, makeStyle, words } from "./helpers";

const style = makeStyle();
/** 15.1 s, speech at 100 ms, 300 ms gaps, a caption at the start: lint-clean. */
const clean: Partial<ProjectInput> = {
  story: [{ id: "c1", asset: "a", inMs: 900, outMs: 16000 }],
  captions: [{ words: ["a.w0", "a.w1"], text: "zero un" }],
};
function run(over: Partial<ProjectInput> = {}, opts: LintOptions = {}) {
  const p = makeProject({ ...clean, ...over });
  return lint(p, resolve(p, style), opts);
}
const rules = (ws: ReturnType<typeof run>) => ws.map((w) => w.rule);

describe("lint", () => {
  it("passes a clean project", () => {
    expect(run()).toEqual([]);
  });

  it("flags speech that starts after 500 ms", () => {
    const ws = run({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 16000 }] });
    expect(ws).toContainEqual({ rule: "hook.first3s", severity: "warning", message: "Speech starts at 1000 ms (more than 500 ms)", ids: ["a.w0"] });
  });

  it("flags a missing text hook in the first 3 seconds", () => {
    expect(rules(run({ captions: [] }))).toContain("hook.first3s");
  });

  it("flags pauses longer than the style limit", () => {
    const ws = run({ styleOverrides: { lint: { "9:16": { maxPauseMs: 200 } } } });
    expect(ws.filter((w) => w.rule === "pace.pauses")).toHaveLength(9);
  });

  it("flags single and two-word fillers that were kept", () => {
    const ws = run({ transcript: { lang: "fr", words: { a: words("a", ["euh", "un", "du", "coup", "quatre", "cinq", "six", "sept", "huit", "neuf"]) } } });
    const fillers = ws.filter((w) => w.rule === "pace.fillers");
    expect(fillers.map((w) => w.ids)).toEqual([["a.w0"], ["a.w2", "a.w3"]]);
  });

  it("flags a duration outside the format range", () => {
    expect(rules(run({ story: [{ id: "c1", asset: "a", inMs: 900, outMs: 5000 }] }))).toContain("duration.range");
  });

  it("checks beats against the framework", () => {
    const missing = run({ structure: { framework: "soar", beats: [{ role: "situation", from: "a.w0", to: "a.w2" }] } });
    expect(missing).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Missing beats for soar: obstacle, action, results" }));
    const unknown = run({ structure: { framework: "xyz", beats: [] } });
    expect(unknown).toContainEqual(expect.objectContaining({ rule: "structure.beats", severity: "error" }));
    const disordered = run({ structure: { framework: "bab", beats: [
      { role: "after", from: "a.w0", to: "a.w2" }, { role: "before", from: "a.w3", to: "a.w5" }, { role: "bridge", from: "a.w6", to: "a.w9" },
    ] } });
    expect(disordered).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Beats are not in the order of bab" }));
  });

  it("flags a hook beat longer than its limit", () => {
    const ws = run({ structure: { framework: "hrst", beats: [
      { role: "hook", from: "a.w0", to: "a.w5" }, { role: "relatable", from: "a.w6", to: "a.w6" },
      { role: "show", from: "a.w7", to: "a.w7" }, { role: "takeaway", from: "a.w8", to: "a.w9" },
    ] } });
    expect(ws).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Beat hook lasts 4500 ms (limit 3000 ms)" }));
  });

  it("reports orphans", () => {
    const ws = run({ story: [{ id: "c1", asset: "a", inMs: 900, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 19000 }],
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w3" }, durationMs: 500, props: { text: "X" } }] });
    expect(ws).toContainEqual(expect.objectContaining({ rule: "elements.orphans", ids: ["e1"] }));
  });

  it("checks files with Windows paths and names the analysis step", () => {
    const exists = new Set(["C:\\media\\a.mp4", "D:/p/cache/a/edit.mp4"]);
    const ws = run(
      { assets: [{ id: "a", kind: "video", path: "C:\\media\\a.mp4", meta: { durationMs: 30000 } }],
        story: [{ id: "c1", asset: "a", inMs: 900, outMs: 16000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }] },
      { projectDir: "D:/p", fileExists: (f) => exists.has(f) },
    );
    const missing = ws.filter((w) => w.rule === "assets.missing").map((w) => w.message);
    expect(missing).toEqual([
      'Missing subject.webm for asset "a": run the matting analysis step',
      'Missing plate.png for asset "a": run the clean plate analysis step',
    ]);
  });

  it("blocks export while proposals are pending", () => {
    const ws = run({ proposals: [{ id: "p1", step: "cuts", variants: [] }] });
    expect(ws).toContainEqual({ rule: "proposals.pending", severity: "error", message: "1 proposal(s) still pending", ids: ["p1"] });
  });
});
```

Expected values: in the clean project the story starts at 900 ms, so w0 (1000 ms) plays at 100 ms; gaps between words are 300 ms (< 350); total 15100 ms is inside 15000 to 60000; the caption starts at frame 3 (100 ms). The hook beat runs from w0 (1000 ms) to w5 end (5500 ms): 4500 ms. In the orphan case the total is 1100 + 14000 = 15100 ms.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/lint`.

- [ ] **Step 3: Implement**

`packages/model/src/lint.ts`:
```ts
import type { Project } from "./schema/project";
import type { Timeline } from "./schema/timeline";
import { getFramework } from "./frameworks";
import { layoutStory, wordOutput } from "./layout";
import { normalizeWord } from "./text";
import { indexWords } from "./words";

export interface LintWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  ids: string[];
}

export interface LintOptions {
  /** Project folder, used to locate relative asset paths and the analysis cache. */
  projectDir?: string;
  /** Injected file check (the model package never touches the file system itself). */
  fileExists?: (path: string) => boolean;
}

const TEXT_KINDS = new Set(["title", "text.behindSubject"]);

function keptWords(project: Project) {
  const { clips } = layoutStory(project);
  const out: { id: string; text: string; startMs: number; endMs: number }[] = [];
  for (const w of indexWords(project).values()) {
    const o = wordOutput(clips, w);
    if (o) out.push({ id: w.id, text: w.text, ...o });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function lint(project: Project, timeline: Timeline, options: LintOptions = {}): LintWarning[] {
  const out: LintWarning[] = [];
  const warn = (rule: string, message: string, ids: string[] = [], severity: LintWarning["severity"] = "warning") =>
    out.push({ rule, severity, message, ids });
  const frameMs = (f: number) => Math.round((f * 1000) / timeline.fps);
  const rules = timeline.style.lint[timeline.format];
  const kept = keptWords(project);
  const { totalMs } = layoutStory(project);

  // The first 3 seconds
  const textStarts = [
    ...timeline.elements.filter((e) => TEXT_KINDS.has(e.kind)).map((e) => e.fromFrame),
    ...timeline.captions.map((c) => c.fromFrame),
  ];
  if (textStarts.length === 0 || frameMs(Math.min(...textStarts)) > 3000) {
    warn("hook.first3s", "No text hook appears in the first 3 seconds");
  }
  const firstWord = kept[0];
  if (firstWord && firstWord.startMs > 500) {
    warn("hook.first3s", `Speech starts at ${firstWord.startMs} ms (more than 500 ms)`, [firstWord.id]);
  }

  // Edit ruthlessly
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1]!;
    const b = kept[i]!;
    const gap = b.startMs - a.endMs;
    if (gap > rules.maxPauseMs) warn("pace.pauses", `${gap} ms pause between "${a.text}" and "${b.text}"`, [a.id, b.id]);
  }
  const fillers = new Set(rules.fillers.map(normalizeWord));
  for (let i = 0; i < kept.length; i++) {
    const one = normalizeWord(kept[i]!.text);
    if (fillers.has(one)) warn("pace.fillers", `Filler "${kept[i]!.text}" is still in the edit`, [kept[i]!.id]);
    const next = kept[i + 1];
    if (next && fillers.has(`${one} ${normalizeWord(next.text)}`)) {
      warn("pace.fillers", `Filler "${kept[i]!.text} ${next.text}" is still in the edit`, [kept[i]!.id, next.id]);
    }
  }

  // Duration
  if (totalMs < rules.minDurationMs || totalMs > rules.maxDurationMs) {
    warn("duration.range", `Duration ${totalMs} ms is outside ${rules.minDurationMs} to ${rules.maxDurationMs} ms for ${timeline.format}`);
  }

  // Structure
  if (project.structure) {
    const fw = getFramework(project.structure.framework);
    if (!fw) {
      warn("structure.beats", `Unknown framework "${project.structure.framework}"`, [], "error");
    } else {
      const roles = fw.beats.map((b) => b.role);
      const missing = roles.filter((r) => !timeline.beats.some((b) => b.role === r));
      if (missing.length) warn("structure.beats", `Missing beats for ${fw.id}: ${missing.join(", ")}`, missing);
      const ordered = [...timeline.beats].sort((a, b) => a.fromFrame - b.fromFrame);
      const inOrder = ordered.every((b, i) => {
        const prev = ordered[i - 1];
        return !prev || (roles.indexOf(prev.role) <= roles.indexOf(b.role) && prev.toFrame <= b.fromFrame);
      });
      if (!inOrder) warn("structure.beats", `Beats are not in the order of ${fw.id}`);
      for (const beat of timeline.beats) {
        const limit = fw.beats.find((b) => b.role === beat.role)?.maxMs;
        const lasts = frameMs(beat.toFrame - beat.fromFrame);
        if (limit !== undefined && lasts > limit) {
          warn("structure.beats", `Beat ${beat.role} lasts ${lasts} ms (limit ${limit} ms)`, [beat.role]);
        }
      }
    }
  }

  // Orphans
  if (timeline.orphans.length) {
    warn("elements.orphans", `${timeline.orphans.length} item(s) anchored to cut words are hidden`, timeline.orphans);
  }

  // Files
  if (options.fileExists && options.projectDir !== undefined) {
    const exists = options.fileExists;
    const dir = options.projectDir;
    const isAbsolute = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p);
    const assets = new Map(project.assets.map((a) => [a.id, a]));
    for (const a of project.assets) {
      const path = isAbsolute(a.path) ? a.path : `${dir}/${a.path}`;
      if (!exists(path)) warn("assets.missing", `Asset "${a.id}" not found at ${a.path}`, [a.id], "error");
    }
    const need = (asset: string, file: string, step: string) => {
      if (!exists(`${dir}/cache/${asset}/${file}`)) {
        warn("assets.missing", `Missing ${file} for asset "${asset}": run the ${step} analysis step`, [asset], "error");
      }
    };
    const inStory = [...new Set(project.story.map((c) => c.asset))].filter((id) => assets.get(id)?.kind === "video");
    for (const id of inStory) need(id, "edit.mp4", "variants");
    const slide = new Set<string>();
    project.story.forEach((c, i) => {
      if (c.transitionOut.kind !== "subjectSlide") return;
      slide.add(c.asset);
      const next = project.story[i + 1];
      if (next) slide.add(next.asset);
    });
    const behind = new Set<string>();
    for (const el of timeline.elements.filter((e) => e.layer === "behind-subject")) {
      for (const c of timeline.clips) {
        if (c.fromFrame < el.fromFrame + el.durationFrames && el.fromFrame < c.fromFrame + c.durationFrames) behind.add(c.asset);
      }
    }
    for (const id of new Set([...slide, ...behind])) need(id, "subject.webm", "matting");
    for (const id of slide) need(id, "plate.png", "clean plate");
  }

  // Proposals
  const pending = project.proposals.filter((p) => p.status === "pending");
  if (pending.length) {
    warn("proposals.pending", `${pending.length} proposal(s) still pending`, pending.map((p) => p.id), "error");
  }

  return out;
}
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./lint";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @adam-studio/model` then `npm run typecheck -w @adam-studio/model`
Expected: all PASS; typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): lint() for hook, pace, fillers, duration, beats, orphans, files and pending proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: JSON Schema export and README

**Files:**
- Create: `packages/model/src/jsonschema.ts`, `packages/model/scripts/export-schemas.ts`
- Create: `packages/model/schema/` (generated files, committed)
- Modify: `packages/model/src/index.ts`, `README.md`
- Test: `packages/model/tests/jsonschema.test.ts`

**Interfaces:**
- Consumes: `ProjectSchema`, `StyleSchema`, `TimelineSchema`, `FRAMEWORKS`.
- Produces: `exportSchemas(): Record<string, unknown>` with keys `project.schema.json`, `style.schema.json`, `timeline.schema.json`, `frameworks.json`; files written to `packages/model/schema/` by `npm run export-schemas -w @adam-studio/model` (read by plan 3's Python exporter).

- [ ] **Step 1: Write the failing test**

`packages/model/tests/jsonschema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { exportSchemas } from "../src/jsonschema";

describe("exportSchemas", () => {
  it("exports the project, style and timeline schemas and the frameworks", () => {
    const out = exportSchemas();
    expect(Object.keys(out).sort()).toEqual(["frameworks.json", "project.schema.json", "style.schema.json", "timeline.schema.json"]);
  });

  it("produces plain JSON Schema objects describing the main fields", () => {
    const out = exportSchemas() as Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    expect(Object.keys(out["project.schema.json"]!.properties!)).toEqual(expect.arrayContaining(["canvas", "story", "elements", "proposals"]));
    expect(out["timeline.schema.json"]!.required).toEqual(expect.arrayContaining(["clips", "elements", "captions", "audio"]));
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/model`
Expected: FAIL, cannot resolve `../src/jsonschema`.

- [ ] **Step 3: Implement**

`packages/model/src/jsonschema.ts`:
```ts
import { z } from "zod";
import { FRAMEWORKS } from "./frameworks";
import { ProjectSchema } from "./schema/project";
import { StyleSchema } from "./schema/style";
import { TimelineSchema } from "./schema/timeline";

/** JSON Schemas for consumers outside TypeScript (the Python CapCut exporter). */
export function exportSchemas(): Record<string, unknown> {
  return {
    "project.schema.json": z.toJSONSchema(ProjectSchema, { io: "input", unrepresentable: "any" }),
    "style.schema.json": z.toJSONSchema(StyleSchema, { io: "input", unrepresentable: "any" }),
    "timeline.schema.json": z.toJSONSchema(TimelineSchema, { io: "output", unrepresentable: "any" }),
    "frameworks.json": FRAMEWORKS,
  };
}
```

`packages/model/scripts/export-schemas.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSchemas } from "../src/jsonschema";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });
for (const [name, value] of Object.entries(exportSchemas())) {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote schema/${name}`);
}
```

Add to `packages/model/src/index.ts`:
```ts
export * from "./jsonschema";
```

- [ ] **Step 4: Run tests, then generate the files**

Run: `npm test -w @adam-studio/model`
Expected: all PASS.
Run: `npm run export-schemas -w @adam-studio/model`
Expected: prints `wrote schema/project.schema.json`, `wrote schema/style.schema.json`, `wrote schema/timeline.schema.json`, `wrote schema/frameworks.json`.

- [ ] **Step 5: Write the README**

`README.md` (replace the whole file):
```markdown
# Adam Studio

An open source video editing system driven by Claude: describe the edit, review three variants at every
step, render the final MP4 yourself, or export a native CapCut project to finish by hand.

Status: sub-project 1 (the edit core) in progress. See `docs/superpowers/specs/` for the design.

## Packages

- `packages/model`: the project format (zod schemas), `resolve()` from word-anchored edits to a frame
  timeline, `lint()` for the reels rules (hook in 3 s, pauses, fillers, duration, narrative beats),
  transcript editing (`cutWords`, `restoreWords`, `trimToWords`), and the guided workflow (`decide()`).

## Development

Requirements: Node 24 or later.

    npm install
    npm test
    npm run typecheck
    npm run export-schemas -w @adam-studio/model

Projects and media live outside this repository; never commit footage or third-party assets.

## A note on Remotion

The renderer (coming in the next plan) uses Remotion, which is free for individuals and companies of up
to 3 people. Larger companies reusing Adam Studio need their own Remotion company license.

## License

MIT
```

- [ ] **Step 6: Run the whole suite and typecheck from the root**

Run: `npm test` then `npm run typecheck`
Expected: all model tests PASS; typecheck exit code 0.

- [ ] **Step 7: Commit and push**

```bash
git add README.md packages/model
git commit -m "feat(model): JSON Schema export for the Python exporter, README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
