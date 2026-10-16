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
- `py/analysis`: the analysis pipeline (`python -m adam_analysis run`), called by `npm run adam -- new | add | analyze`.
- `py/capcut`: the CapCut exporter (`python -m adam_capcut export <projectDir>`).

## Development

Requirements: Node 24 or later.

    npm install
    npm test
    npm run typecheck
    npm run export-schemas -w @adam-studio/model

Projects and media live outside this repository; never commit footage or third-party assets.

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
