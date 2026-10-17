# Adam Studio

An open source video editing system driven by Claude: describe the edit, review three variants at every
step, render the final MP4 yourself, or export a native CapCut project to finish by hand.

Status: sub-project 1 (the edit core) in progress. See `docs/superpowers/specs/` for the design.

## Packages

- `packages/model`: the project format (zod schemas), `resolve()` from word-anchored edits to a frame
  timeline, `lint()` for the reels rules (hook in 3 s, pauses, fillers, duration, narrative beats),
  transcript editing (`cutWords`, `restoreWords`, `trimToWords`), and the guided workflow (`decide()`).
- `packages/render`: the Remotion composition and the `adam` CLI (`npm run adam -- render | review | decide |
  studio | capcut-prep <projectDir>`).
- `packages/library`: the Inspiration folder, online asset search, Pinterest.
- `packages/insights`: TikTok and Instagram numbers related to the edits.
- `packages/mcp`: the MCP server Claude Code edits projects through.
- `packages/web`: the control panel in the browser (`npm run ui`).
- `py/analysis`: the analysis pipeline (`python -m adam_analysis run`), called by `npm run adam -- new | add | analyze`.
- `py/capcut`: the CapCut exporter (`python -m adam_capcut export <projectDir>`).

## Development

Requirements: Node 24 or later.

    npm install
    npm test
    npm run typecheck
    npm run export-schemas -w @adam-studio/model

Projects and media live outside this repository; never commit footage or third-party assets.

## Editor, series, effects, library, insights

- **Editor** (panel, project page, **Open editor**): live Remotion preview, timeline of clips, elements and captions
  (click to inspect and edit as JSON; nudge clip in and out points), transcript (click a word to jump, shift+click to
  select, **Cut** removes the passage and its pause, **Tighten** shortens long pauses), **Undo**.
- **Series** (`~/AdamStudioSeries/<name>/series.json`): a style, shared assets and treatments, element templates
  placed at the start, at each cut, at each structure beat and at the end, with `{{project.name}}`, `{{beat.word}}`
  and the series' own vars. `npm run adam -- series list | save <dir> <name> | apply <dir> <name>`,
  `adam new ... --series <name>`, the panel's **Apply series**, or the MCP tools. Re-applying replaces the series
  elements and keeps the project's own.
- **Effects**: element kinds `hud.panel` (typed HUD window), `hud.stat` (counter), `lottie`, `camera.zoom`
  (punch-in on the main track), transitions `flash`, `whip`, `zoom`, and the style's `motion.speed` (below 1 slows
  every animation). In CapCut, zooms and these transitions are baked into the main track, HUD and Lottie come as
  transparent overlays.
- **Library** (panel **Library**, MCP `search_assets`, `look_at`, `import_asset`): your Inspiration folder
  (`~/AdamStudioInspiration`: folder and file names are tags, a `<file>.txt` adds notes) first, then Openverse, Pexels,
  Pixabay and Freesound; imports land in `<project>/assets/` with `CREDITS.md`. Pinterest boards sync into the
  Inspiration folder.
- **Insights** (panel **Insights**, MCP `insights`): your TikTok and Instagram videos ranked by views and engagement,
  linked to their projects, with medians by edit choice (length, cuts per minute, hook length, framework, series).

Keys and sign-ins: [docs/connections.md](docs/connections.md).

## Claude Code (MCP)

    claude mcp add --scope user adam-studio -- node <repo>/node_modules/tsx/dist/cli.mjs <repo>/packages/mcp/src/server.ts

Claude then reads projects (`get_project`, `get_transcript`, `get_reference`), edits them (`apply_patch`, `update_item`,
`set_value`, every write validated and backed up, `undo` to go back), proposes A/B/C variants and records decisions
(`propose`, `decide`, `close_step`), looks at the result (`still` renders frames it can see) and runs analyze, render,
review and the CapCut export (`run`, shown live in the control panel when it is open). `npm run adam -- still <dir>
--at 500,1500 [--variant p1:B]` renders the same frames from the terminal.

## Control panel

    npm run ui

or double-click `Adam Studio.cmd`. It opens `http://127.0.0.1:4317` (`ADAM_UI_PORT` changes the port) on your
projects (`~/AdamStudioProjects`, changeable on the home page). Create a project from rushes picked on your disk,
add rushes, then Analyze, Render, Review (watch the variants, choose, reject or ask for more), Export to CapCut and
Open Studio, each with a live log and a Stop button. Edits still go through Claude; the page follows the changes to
`project.json`. It only answers your own machine. Tests: `npm test -w packages/web`, `npm run test:e2e -w packages/web`.

## Analysis

Turns rushes into a project: the edit and proxy videos, the word transcript (Whisper large-v3-turbo) and the
silences at import; the cut-out (RobustVideoMatting) and the clean plate on demand, when an edit needs them.

    python -m venv py/analysis/.venv
    py/analysis/.venv/Scripts/python -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
    py/analysis/.venv/Scripts/python -m pip install -e "py/analysis[dev]"
    npm run adam -- new <projectDir> <videos...> [--lang fr] [--format 9:16]
    npm run adam -- add <projectDir> <videos...>
    npm run adam -- analyze <projectDir> [--assets c01] [--steps subject,plate] [--force]

The first run downloads the models (about 1.6 GB for Whisper). `render`, `review`, `studio` and `capcut-prep` run
the missing analysis themselves; `--no-analyze` turns that off. Tests: `py/analysis/.venv/Scripts/python -m pytest
py/analysis` (`-m "not slow"` skips Whisper and matting).

## Export to CapCut

The exporter writes a CapCut Desktop project: native clips, editable titles and captions (one CapCut
text per title line, with the style fonts), photos and sound effects where CapCut has an equivalent, and
Remotion renders for the rest (behind-subject effects and person-only slides baked into the main track,
kinds without a native equivalent as transparent ProRes 4444 overlays). The style's warmth is applied to
the copied takes; brightness, contrast, saturation and vignette stay adjustable in CapCut. It needs the
patched pyJianYingDraft of the ClaudeCapcut lab (`ADAM_CAPCUT_LAB`, default `~/ClaudeCapcut/VectCutAPI`).

    python -m venv py/capcut/.venv
    py/capcut/.venv/Scripts/python -m pip install -e "py/capcut[dev]"
    py/capcut/.venv/Scripts/python -m adam_capcut export <projectDir> [--name "1015 edit"]

It never overwrites a CapCut project it did not create, nor one open in CapCut. Every export writes
`renders/<name>.capcut-report.json`, listing each item as `native`, `baked` or `skipped` with the reason.
Tests: `py/capcut/.venv/Scripts/python -m pytest py/capcut` (add `-m e2e` for the full chain).

## A note on Remotion

The renderer uses Remotion, which is free for individuals and companies of up
to 3 people. Larger companies reusing Adam Studio need their own Remotion company license.

## License

MIT
