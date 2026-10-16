# Adam Studio, sub-project 1: the edit core

Status: design approved in conversation on 2026-10-16, pending review of this written spec.

## 1. Context

Adam Studio is an open source video editing system driven by Claude. It grows out of two manual edits of
the "1015" video (Project Adam series), where a set of one-off scripts proved the pieces: word-level
transcription, blank cutting, English captions in the Indivisible font, a warm grade, text behind the
speaker, person-only slide transitions, a Watch Dogs style HUD, synthesized sound effects and export to
a CapCut project.

The system is first a personal workflow for Michel-Cliff, built from reusable parts so it can be shared
on GitHub. It is not a commercial product: licensing of third-party assets and engines is not a design
driver, but the public repo never contains personal footage or third-party asset files.

### Goals of the whole system

- Formats: vertical talking-head videos and screen recordings / product demos.
- Each project is either 9:16 (1080x1920, phone) or 16:9 (1920x1080, landscape), chosen at creation.
- A web interface with preview and timeline, plus transcript-based editing (sub-project 4).
- Claude Code drives edits through an MCP server exposed by Adam Studio (sub-project 3). No chat is built
  into the app.
- The system renders the final MP4 itself, so the preview is the export. A CapCut project can also be
  exported for finishing by hand, as native as possible.
- Success means: a consistent series style, precise control over every cut and element, and advanced
  effects (text behind the speaker, person-only slides, HUD, screen zooms).

### Sub-projects

1. **Edit core** (this spec): project model, resolver, lint, Remotion renderer, CapCut exporter.
2. **Analysis**: import, media variants, transcription, silences, filler words, subject matte, clean plate.
3. **MCP server**: Claude Code tools on top of the core.
4. **Web app**: preview, timeline, transcript editing, inspectors.
5. **Series style**: Project Adam templates (title, HUD, colors, fonts, sounds, slots).
6. **Effects library**: native HUD kinds, behind-subject effects, screen zooms, Lottie, GL transitions.
7. **Asset library**: a local **Inspiration** folder where the creator drops reference videos, fonts,
   effects and other material for Claude to pick from first, plus search connectors (Freesound CC0,
   Openverse, Pexels, Pixabay, LottieFiles).
8. **Insights**: TikTok and Instagram connections to rank the creator's own videos by performance, relate
   it to format, framework and pacing, and watch public content of chosen creators; suggestions surface
   through the MCP server.

## 2. Scope of this spec

In scope: the project format, `resolve()`, `lint()`, narrative frameworks, the guided workflow with
proposals and variants (section 14), the element kind registry with the kinds needed for the acceptance
test, the Remotion renderer and render CLI (including `adam review` and `adam decide`), the CapCut
exporter, and the contract with the analysis cache.

Out of scope: producing analysis assets (sub-project 2; the acceptance test reuses assets already computed
for 1015), generating variants automatically (Claude does it through the MCP server, sub-project 3; in this
sub-project variants are written into `project.json` by hand or by Claude editing the file), the MCP
server, the web app, full series templates, native HUD components, asset search.

## 3. Repository layout

```
Adam-studio/
  packages/
    model/        TypeScript: zod schemas, types, resolve(), lint(), transcript operations,
                  frameworks.json, JSON Schema export for Python
    render/       Remotion compositions, element components, `adam render` CLI
  py/
    capcut/       CapCut exporter (reads the resolved timeline)
  fixtures/
    synthetic/    generator script for small test media + a synthetic project
  docs/
```

Tooling: npm workspaces, Node 24, strict TypeScript, vitest; Python 3.12 with pytest for `py/capcut`.
The CapCut exporter uses the patched pyJianYingDraft from the `ClaudeCapcut` lab as an external dependency
(path configured, never copied into the repo). Repo license: MIT.

Projects live outside the repo, for example `C:\Users\miche\AdamStudioProjects\1015\`:

```
<project>/
  project.json            authoring document (the single source of truth)
  cache/<assetId>/        derived files produced by analysis (section 9)
  renders/                MP4 exports, timeline.json snapshots, export reports
```

## 4. The authoring model (`project.json`)

All times are integer milliseconds. Frames appear only after resolution.

```jsonc
{
  "version": 1,
  "name": "1015",
  "canvas": { "format": "9:16", "fps": 30 },          // 9:16 -> 1080x1920, 16:9 -> 1920x1080
  "style": "styles/project-adam.json",                // path, relative to the project folder
  "assets": [ /* 4.1 */ ],
  "transcript": { /* 4.2 */ },
  "story": [ /* 4.3 */ ],
  "elements": [ /* 4.4 */ ],
  "captions": [ /* 4.5 */ ],
  "structure": { /* 4.6 */ },
  "workflow": { /* 14 */ },
  "proposals": [ /* 14 */ ]
}
```

### 4.1 Assets

```jsonc
{ "id": "clip01", "kind": "video", "path": "D:/raw/1015/clip01.mov",
  "meta": { "durationMs": 7100, "width": 2160, "height": 3840, "hasAudio": true } }
```

`kind` is `video`, `audio`, `image` or `lottie`. `path` points to the original, anywhere on disk. Derived
variants and analysis files are found by convention in `cache/<assetId>/` (section 9), never listed by hand.

### 4.2 Transcript

```jsonc
{ "lang": "fr",
  "words": { "clip01": [ { "id": "clip01.w0", "text": "A", "startMs": 610, "endMs": 680 } ] } }
```

Word ids are stable (`<assetId>.w<index>`) and never reused after edits.

### 4.3 Story (main track)

An ordered list of clips laid end to end (magnetic): no positions, so no gaps or overlaps exist by
construction.

```jsonc
{ "id": "c3", "asset": "clip02", "inMs": 2130, "outMs": 7000,
  "framing": { "mode": "cover" },
  "zoom": { "base": 1.08, "driftPerSec": 0.004 },
  "transitionOut": { "kind": "subjectSlide", "durationMs": 540, "word": "CONTEXTE" } }
```

- `framing.mode`: `cover`, `fit` (with `background: "blur" | "color"`), `crop` (a normalized rectangle
  plus optional keyframes `[{ "atMs", "rect" }]` for pan and zoom), `split` (a second asset for the other
  region, with a layout from the style).
- `transitionOut` kinds in v1: `cut` (default), `subjectSlide` (person-only slide; needs a matte and a
  plate), `crossfade`. The renderer draws `crossfade` as a cut: crossfades are done by hand (decision of
  2026-10-16).
- Transcript editing maps to clips: deleting words splits or trims clips; restoring words reverses it.
  These are pure functions in `packages/model` (`cutWords`, `restoreWords`, `trimToWords`).

### 4.4 Elements

```jsonc
{ "id": "e7", "kind": "title", "layer": "behind-subject",
  "anchor": { "word": "clip01.w0", "offsetMs": 0 }, "durationMs": 3350,
  "slot": "title", "props": { /* validated by the kind's schema */ } }
```

- `layer`: `front` or `behind-subject`.
- `anchor`: either `{ "word", "offsetMs" }` (follows the speech through cuts) or `{ "atMs" }` (absolute
  output time, for frames, end cards). An element whose anchor word is cut becomes an **orphan**: it is
  kept, reported by `lint()`, and not rendered.
- `durationMs`, or `{ "untilWord": ... }`, or `"untilEnd": true`.
- `slot`: a named position from the style for the project's format (`top`, `title`, `lower-third`,
  `caption`, `corner-right`, `center`, `full`), with an optional normalized override `{ "x", "y" }`
  (0..1 of the canvas). Slots already respect platform safe zones.

### 4.5 Captions

Caption groups are anchored to words, so recutting never desyncs them.

```jsonc
{ "words": ["clip02.w14", "clip02.w19"], "text": "I got my master's degree",
  "highlight": ["master's degree"], "lang": "en" }
```

`words` is the first and last word of the group. `text` may differ from the spoken words (translation).
A group that straddles a cut is split into one displayed piece per surviving range. Caption style comes
from the style file.

### 4.6 Narrative structure

```jsonc
{ "framework": "soar",
  "beats": [ { "role": "situation", "from": "clip01.w0", "to": "clip02.w41" } ] }
```

`packages/model/frameworks.json` defines the frameworks, each with ordered beat roles, a role description
used as guidance for Claude, and checkable expectations:

| Framework | Beats |
|---|---|
| `hrst` | hook, relatable, show, takeaway |
| `bab` | before, after, bridge |
| `soar` | situation, obstacle, action, results |
| `three-act` | setup, conflict, resolution |
| `open-loop` | curiosity, explore, closure (closure must tie back to the hook) |

Beats resolve to time ranges. Styles can attach treatments to beat changes (for example a subject slide
plus the beat word behind the speaker); the core exposes beats in the resolved timeline, the treatments
themselves belong to sub-project 5.

### 4.7 Style (minimal core schema)

The core needs enough style to render; sub-project 5 grows it into full series templates.

```jsonc
{ "name": "Project Adam",
  "fonts": { "caption": { "family": "Indivisible", "file": "%LOCALAPPDATA%/CapCut/User Data/Cache/effect/7181740482383319553/8f72e39497fcb7bc0b6cf6a100e09d24/IndivisibleApp-Bold.ttf",
                 "capcutResourceId": "7181740482383319553" },
             "title":   { "family": "Segoe UI Black", "file": "C:/Windows/Fonts/seguibl.ttf" } },
  "colors": { "text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A" },
  "grade": { "warmth": 0.35, "contrast": 0.10, "saturation": 0.12, "brightness": -0.02, "vignette": 0.25 },
  "caption": { "size": 0.052, "stroke": 0.08, "shadow": true, "maxCharsPerLine": 22, "intro": "miniZoom" },
  "slots": { "9:16": { "caption": { "x": 0.5, "y": 0.76 }, "title": { "x": 0.5, "y": 0.30 } },
             "16:9": { "caption": { "x": 0.5, "y": 0.86 }, "title": { "x": 0.5, "y": 0.22 } } },
  "lint": { "9:16": { "minDurationMs": 15000, "maxDurationMs": 60000 },
            "16:9": { "minDurationMs": 30000, "maxDurationMs": 1200000 } } }
```

Sizes are fractions of the canvas width so one style serves both formats. Grade values range from -1 to 1,
0 meaning neutral. The CapCut exporter converts sizes to CapCut text units with a factor calibrated once
against a known CapCut text.

## 5. `resolve(project, style, options?) -> Timeline`

A pure function, the only place where anchors, cuts and slots are interpreted. Accepted proposals are
already plain content in the project; pending and rejected proposals are ignored, except the one named in
`options.apply = { proposal, variant }`, which is applied virtually (used for variant previews).
Output (`timeline.json`):

```jsonc
{ "width": 1080, "height": 1920, "fps": 30, "durationFrames": 1940,
  "clips":    [ { "id", "asset", "fromFrame", "durationFrames", "sourceInMs", "framing", "zoom",
                  "grade", "transitionOut" } ],
  "elements": [ { "id", "kind", "layer", "fromFrame", "durationFrames", "x", "y", "props" } ],
  "captions": [ { "fromFrame", "durationFrames", "text", "highlightRanges", "x", "y", "style" } ],
  "beats":    [ { "role", "fromFrame", "toFrame" } ],
  "audio":    [ { "asset", "fromFrame", "durationFrames", "sourceInMs", "volume", "fadeInMs", "fadeOutMs" } ],
  "orphans":  [ "e12" ] }
```

Rules:
- Clip output positions are the running sum of clip durations; frames are rounded once, from the
  accumulated millisecond position, so rounding error never accumulates.
- A word maps to output time only if it falls inside a kept clip range; otherwise anchors on it are
  orphans.
- Elements are clamped to the timeline; zero-length results are dropped and reported.

Both the renderer and the CapCut exporter consume only this output.

## 6. `lint(project, timeline, style) -> Warning[]`

Each warning has a rule id, a severity, a message and the ids involved. Rules in v1:

| Rule | Check |
|---|---|
| `hook.first3s` | a front or behind-subject text element, or the first caption, starts before 3 s, and speech starts within 500 ms |
| `pace.pauses` | no gap between consecutive kept words longer than a threshold (default 350 ms) |
| `pace.fillers` | no kept filler word (per-language list, French default: euh, heu, bah, ben, du coup, en fait; configurable) |
| `duration.range` | total duration within the style's range for the format |
| `structure.beats` | every beat of the chosen framework is present, in order, non-overlapping |
| `elements.orphans` | no orphan elements or captions |
| `assets.missing` | every referenced asset and required derived file exists |
| `proposals.pending` | no proposal left pending (the final export refuses to run otherwise, unless forced) |

"Single focus" is judged by Claude in sub-project 3, not by lint.

## 7. Element kinds

A kind is registered in three places that share the kind's name: a zod props schema (`packages/model`),
a Remotion component (`packages/render`) and a CapCut mapping (`py/capcut`, validated against the JSON
Schema exported from the model). Kinds in v1, enough to rebuild 1015:

| Kind | Props (summary) | Layer |
|---|---|---|
| `title` | lines `[{ text, box? }]` in phases, reveal and glitch timings, kicker | behind-subject or front |
| `text.behindSubject` | one big word, color, reveal | behind-subject |
| `image` | asset id, fit, intro and outro presets | front |
| `sfx` | asset id, volume, fades | audio only |

HUD panels for the acceptance test are `image` elements using the PNGs already generated in the lab; native
HUD kinds come in sub-project 6.

## 8. Renderer (`packages/render`)

One Remotion composition reads `timeline.json` through input props. Layers from bottom to top:

1. **Video**: story clips (`OffthreadVideo`, the asset's `edit` variant on export, `proxy` in preview),
   framing, zoom keyframes, then the grade as an SVG filter (color matrix for warmth, contrast,
   saturation, brightness) plus a vignette overlay.
2. **Behind-subject elements.**
3. **Subject**: the asset's transparent matte video (VP9 with alpha) with the same framing, drawn only
   while a behind-subject element or a subject slide is active.
4. **Front elements** and captions (not graded).
5. **Audio**: clip audio and sfx with volume and fades.

`subjectSlide`: during the transition window the clean plate replaces layer 1, the subject layer
translates out of frame (ease-in) then the next clip's subject enters (ease-out), with a horizontal
directional blur (SVG `feGaussianBlur` with a horizontal-only deviation) proportional to speed.

Framing modes in both formats: `cover`, `fit` with blurred or colored background, `crop` with keyframed
pan and zoom, `split` with a style-defined layout.

CLI:
- `adam render <projectDir> [--out file.mp4] [--frames a-b] [--force]` resolves, renders H.264 + AAC at
  the canvas size and fps, and writes `renders/<name>.mp4` plus the timeline snapshot. It refuses while
  proposals are pending unless `--force`.
- `adam review <projectDir> [--step <name>]` renders, for every pending proposal of the current step, a
  short preview per variant and a comparison sheet (section 14).
- `adam decide <projectDir> <proposalId> <A|B|C|reject|more> [--note "..."]` records the decision and
  applies it.

Remotion Studio is the preview until the web app exists.

## 9. Contract with the analysis cache

`cache/<assetId>/` may contain:

| File | Used for | Required when |
|---|---|---|
| `edit.mp4` | export (H.264 at canvas resolution with the source aspect kept, audio; GOP rule) | always for video assets |
| `proxy.mp4` | preview (half resolution; GOP rule) | preview only, falls back to `edit.mp4` |
| `transcript.json` | words, merged into `project.json` on import | transcript editing |
| `silences.json` | pause lint and auto-cut suggestions | optional |
| `subject.webm` | subject layer (VP9 alpha, same timing and size as `edit.mp4`; GOP rule) | behind-subject elements or subject slides on this asset |
| `plate.png` | clean background without the speaker | subject slides on this asset |

GOP rule, for every video file above: a keyframe every second and no B-frames (x264 `-g <fps> -bf 0`,
libvpx `-g <fps>`). It is not optional: with the encoders' default long GOPs, Remotion's frame cache
loses frames during parallel renders ("No frame found at position"), found while building the renderer
on `edit.mp4` and `subject.webm`. For the same reason the renderer sizes its parallel tabs to the free
memory, so the frame cache (half the free memory) holds one second of frames per video decoded at the
same time, for every tab.

For the acceptance test these files are produced once by adapting the lab scripts; sub-project 2 replaces
that with a proper pipeline.

## 10. CapCut exporter (`py/capcut`)

`python -m adam_capcut export <projectDir> [--name "1015 edit"]` reads the resolved timeline and writes a
self-contained CapCut project (media copied inside) into CapCut's projects folder.

Mapping, native whenever possible:

| Timeline item | CapCut |
|---|---|
| clips, framing | video segments; cover and crop via scale and position keyframes; `fit` with blurred background via CapCut's native background blur; `split` clips baked by Remotion |
| grade | native brightness, contrast, saturation keyframes and Vignette effect; warmth applied to the copied takes and baked stretches with the renderer's color matrix (CapCut has no warmth keyframe) |
| captions, titles | native, editable text with the style fonts (CapCut resource ids), colors, highlight ranges, stroke, shadow, mapped intro presets; a title is one text per line and per phase, laid out like the renderer |
| image elements | photo segments (explicit 1080x1920 size) with mapped intro and outro presets |
| behind-subject elements, subject slides | the affected stretch of the main track is replaced by a clip rendered by Remotion with the effect baked in |
| elements without a native equivalent | a transparent overlay rendered by Remotion if CapCut accepts alpha video, otherwise baked into the main track |
| sfx and clip audio | native audio segments with volume |

Safety rules carried over from the lab: write an ownership marker at folder creation; never overwrite a
folder without the marker; refuse a project that contains `.locked` (open in CapCut).

Every export writes `renders/<name>.capcut-report.json`: each element marked `native`, `baked` or
`skipped`, with the reason.

## 11. Error handling

- Schema errors name the exact path (`elements[4].props.lines[1].text`).
- A missing asset or derived file names the file and the analysis step that produces it.
- Orphans are lint warnings, never crashes.
- Render failures report the frame number and the element id.
- The exporter refuses unsafe overwrites with an explicit message.

## 12. Testing

- **Model** (vitest): schema validation; `resolve()` with anchors across cuts, orphans, caption groups
  split by cuts, beats, frame rounding, and a variant applied virtually; every lint rule; `cutWords` /
  `restoreWords`; `decide()` for accept, reject and more, including history and step progression.
- **Renderer**: a generator script makes synthetic media (color bars, tone, a moving shape with a matte,
  a plate) and a synthetic project; stills at chosen frames are compared to reference images with a
  tolerance; a short export is checked with ffprobe (size, fps, duration, audio stream).
- **CapCut exporter** (pytest): export of the synthetic project; checks on tracks, overlaps, media
  presence, font fields, explicit photo sizes, the report, and the overwrite protections; one manual check
  in CapCut, documented.
- **Acceptance**: 1015 described in `project.json` (media outside the repo), rendered to MP4 and exported
  to CapCut, compared side by side with "1015 edit v2".

## 13. Risks and first tasks

1. **CapCut and alpha video**: unverified. First task: a short spike exporting one transparent overlay
   (WebM VP9 alpha and MOV ProRes 4444) and opening it in CapCut. The answer picks the fallback in
   section 10.
2. **HEVC sources**: the browser preview cannot rely on HEVC; the `edit` and `proxy` variants are H.264.
3. **Render speed**: Remotion renders through headless Chrome; expect 1 to 3 minutes per minute of video.
   Concurrency is tuned to the machine (12 threads; oversubscription was measured as harmful in the lab).
4. **pyJianYingDraft**: kept as an external dependency with the lab patches (text shadow fix, explicit
   photo size); upstream changes may require re-patching.

## 14. Guided workflow and variants

The creator keeps control over generation: the edit is built step by step, and every place where an
effect, a text or an image would go is offered as a proposal with three variants to accept or reject.

### 14.1 Steps

Steps run in a fixed order; a step opens only when every proposal of the previous step is decided,
because later choices depend on earlier ones.

| # | Step id | Proposals |
|---|---|---|
| 1 | `cuts` | one proposal for the whole cut plan, variants by tightness (for example tight, balanced, loose) |
| 2 | `structure` | one proposal: three framework and beat placements |
| 3 | `captions` | one proposal: three caption styles |
| 4 | `hook` | one proposal: three hook titles for the first 3 seconds |
| 5 | `beats` | one proposal per beat change: three transition treatments |
| 6 | `visuals` | one proposal per spot that calls for text, an image, a HUD element or a reference |
| 7 | `sound` | one proposal per sound placement, or one for the sound pass as a whole |
| 8 | `look` | one proposal: three grades |

```jsonc
"workflow": { "current": "visuals",
              "steps": { "cuts": "done", "structure": "done", "captions": "done", "hook": "done",
                         "beats": "done", "visuals": "open", "sound": "locked", "look": "locked" } }
```

### 14.2 Proposals

```jsonc
{ "id": "p12", "step": "visuals", "anchor": { "word": "clip02.w31" },
  "reason": "mention of jobless.fr",
  "variants": [
    { "key": "A", "label": "HUD window with a capture of the site", "patch": { /* 14.3 */ } },
    { "key": "B", "label": "Logo pop-up next to the caption", "patch": { } },
    { "key": "C", "label": "Site name as a big word behind the speaker", "patch": { } } ],
  "status": "pending",                     // "pending" | { "accepted": "B" } | "rejected"
  "history": [ { "variants": ["A", "B", "C"], "decision": "more", "note": "more sober" } ] }
```

A proposal has one to three variants (exactly three whenever alternatives make sense). The anchor places
it on the timeline for previews and review.

### 14.3 Patches

A patch is the set of changes a variant makes, expressed in the authoring model so it survives recuts:
`addElements`, `addCaptions`, `setStory` (cuts step), `setStructure`, `setStyle` (partial style
override, for captions and look) and `removeElements`. Patches never reference absolute output times
except through `{ "atMs" }` anchors, exactly like ordinary elements.

### 14.4 Decisions

`decide(project, proposalId, decision, note?)` is a pure model operation:
- `A`, `B` or `C`: applies the patch to the project content, sets `status` to `{ "accepted": key }`.
- `reject`: nothing is applied, `status` becomes `rejected`.
- `more`: the current variants move to `history` with the optional note; the proposal stays `pending`
  with no variants until new ones are written (by Claude, sub-project 3).

When the last proposal of the current step is decided, the step becomes `done` and the next one `open`.
Rejected variants and notes stay in `history`, so Claude can learn the creator's taste later.

### 14.5 Review output

`adam review` resolves the project once per variant with `options.apply`, renders a window of about
3 seconds centred on the proposal's anchor (whole-video proposals such as `look` use three fixed sample
moments), and writes to `renders/review/<proposalId>/`:
- `A.mp4`, `B.mp4`, `C.mp4`: the previews,
- `sheet.jpg`: one representative frame per variant side by side, labelled with the variant key and label,
- `index.json`: what was rendered, for the web app and for Claude.

Until the web app exists, the creator watches these files and answers in the chat; Claude runs
`adam decide`.
