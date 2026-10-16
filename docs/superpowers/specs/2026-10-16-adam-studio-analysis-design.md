# Adam Studio, sub-project 2: the analysis pipeline

## 1. Context

Sub-project 1 (the edit core) defined the analysis cache contract (core spec section 9) and filled it once for
the 1015 acceptance with one-off lab scripts (`spikes/acceptance-1015`). This sub-project replaces those scripts
with a pipeline that ships with Adam Studio: new rushes become a ready project with one command, and the heavy
analysis runs only when an edit needs it.

Decisions taken with the creator on 2026-10-16:
- Commands: `adam new` creates a project from videos, `adam add` brings more takes into an existing one.
- Cheap analysis at import, heavy analysis on demand (cut-out and clean plate only for clips whose edit uses them).
- Transcription only, in the spoken language; translated captions are written later by Claude in the guided
  workflow, anchored on those words (as in 1015).
- The analysis code lives in the repo as a Python package with its own environment, independent of the lab.

Success: one command turns rushes into a project that `adam render`, `adam review` and the CapCut export accept
without manual fixes; every cache file meets the contract; an interrupted analysis resumes where it stopped.

## 2. Scope

In scope: `py/analysis` (package `adam_analysis`), the TypeScript commands `adam new`, `adam add`, `adam analyze`,
on-demand heavy steps in `render`, `review`, `studio` and `capcut-prep`, the cache manifest, tests.

Out of scope: translation, speaker diarization, GPU support, a GUI (sub-project 4), automatic cutting of fillers
and pauses (the guided workflow's cuts step uses the transcript and silences produced here).

## 3. Layout

```
py/analysis/
  pyproject.toml          adam-analysis, Python 3.12, pinned deps (versions proven in the lab)
  adam_analysis/
    __main__.py           python -m adam_analysis run <project> --assets c01,c02 --steps edit,proxy,...
    probe.py              ffprobe: duration, size, rotation, fps, audio
    steps/edit.py         edit.mp4 and proxy.mp4
    steps/transcript.py   faster-whisper words
    steps/silences.py     pauses from words and ffmpeg silencedetect
    steps/subject.py      RobustVideoMatting cut-out
    steps/plate.py        clean plate (median and LaMa)
    manifest.py           per-asset manifest: source fingerprint, step versions
    check.py              the cache contract checker (from spikes/acceptance-1015/check_cache.py)
  tests/
packages/render/src/commands/new.ts, add.ts, analyze.ts   project document side (model functions)
```

The environment is `py/analysis/.venv` (never committed), created like `py/capcut/.venv`. Dependencies:
faster-whisper, torch and torchvision CPU builds, opencv-python-headless, numpy, simple-lama-inpainting, pytest;
versions pinned to those working in the lab's `.tools` venv. Model weights download on first use into the
user caches (Hugging Face for Whisper large-v3-turbo, torch hub for RobustVideoMatting mobilenetv3).

The TypeScript CLI finds the analysis Python at `py/analysis/.venv/Scripts/python` (or `bin/python`), overridable
with `ADAM_ANALYSIS_PYTHON`, and calls it with argument arrays (paths with spaces and accents are safe).

## 4. Division of work

- **Python (`adam_analysis`)** only reads source videos and writes cache files. It never edits `project.json`.
- **TypeScript (`adam new | add | analyze`)** owns the project document: it assigns asset ids, runs the analysis,
  then reads the cache (probe results, transcript) and updates `project.json` through the model (word ids
  `<assetId>.w<n>`, assets, story clips), validating with `parseProject` before writing.

## 5. Commands

- `adam new <projectDir> <videos...> [--lang fr] [--format 9:16|16:9] [--style <style.json>] [--name <name>]`:
  refuses an existing `project.json`; writes `style.json` (a copy of `--style`, or the default template with a
  font found on the system), a `project.json` with no assets, then runs `add`.
- `adam add <projectDir> <videos...> [--lang fr]`: each video becomes a video asset `cNN` (next free number; a
  video already in the project by path is skipped with a message), with `path` pointing at the original file
  (nothing copied). Runs the cheap steps (`edit`, `proxy`, `transcript`, `silences`), merges the words into
  `transcript.words`, sets `meta` (durationMs, width and height of edit.mp4, hasAudio), and appends one story
  clip per take from 150 ms before its first word to 250 ms after its last word (the whole take if no word).
- `adam analyze <projectDir> [--assets c01,c03] [--steps subject,plate] [--force]`: runs steps explicitly
  (default: every step every video asset needs for the current timeline).
- On demand: `render`, `review`, `studio` and `capcut-prep` compute the media plan first; when files are missing,
  they run `adam analyze` for exactly those assets and steps, then continue. The plan's `MediaError` carries the
  missing (asset, step) pairs for that purpose. `--no-analyze` turns this off.

## 6. Steps and outputs (`cache/<assetId>/`)

| Step | Output | Method |
|---|---|---|
| `edit` | `edit.mp4` | H.264 crf 18, canvas fps, source aspect kept with its longer side equal to the canvas's longer side (1920), a keyframe every second (`-g <fps>`), no B-frames, AAC 192k; rotation applied |
| `proxy` | `proxy.mp4` | from edit.mp4, half size, same GOP rule, AAC 128k |
| `transcript` | `transcript.json` | faster-whisper large-v3-turbo, CPU int8, word timestamps, audio decoded by ffmpeg to 16 kHz mono float samples (passed as numpy: faster-whisper 1.2.1 breaks with PyAV 19); `{lang, langProbability, words: [{text, startMs, endMs, p}]}`, text stripped, endMs clamped to at least startMs |
| `silences` | `silences.json` | `{pauses: [{startMs, endMs}]}` from gaps between words longer than 350 ms, and `{quiet: [{startMs, endMs}]}` from ffmpeg `silencedetect=noise=-35dB:d=0.35` |
| `subject` | `subject.webm` | RobustVideoMatting mobilenetv3 on edit.mp4 frames at half size (downsample ratio 0.375), matte upsampled, VP9 yuva420p, `-g <fps>`, torch with 6 threads |
| `plate` | `plate.png` | per-pixel median of unoccluded samples from ungraded edit.mp4 frames (coarse matte dilated 31 px), LaMa for never-seen pixels |

Every output is written to `tmp-<name>` then renamed, so a file exists only once complete.

## 7. Manifest and freshness

`cache/<assetId>/manifest.json`: `{source: {path, size, mtimeMs}, steps: {<step>: {version, finishedAt, seconds}}}`.
A step is redone when its output is missing, its version changed (a constant in the step's module), the source
size or mtime changed, or `--force`. `subject` and `plate` depend on `edit` and are redone when it is.

## 8. Errors and progress

- Progress: one line per asset and step with its duration; long steps print a percentage every 10%.
- Errors name the asset, the step, the source file and the cause (ffmpeg's last stderr lines, a missing model
  download, a missing environment with the command to create it). No tracebacks for expected failures.
- After a run, the contract checker runs on the touched assets; a violation fails the command.

## 9. Testing

- Unit (pytest, fast): probe parsing, story-clip bounds from words, silence extraction from words and from
  silencedetect output, manifest freshness rules, the contract checker (moved from the 1015 spike with its tests).
- Media steps on synthetic sources (ffmpeg lavfi, 3 to 5 s): edit and proxy (size, aspect, GOP, audio, rotation
  with a rotated source), subject and plate on a moving shape over a static background (alpha present, plate
  without the shape).
- Transcript: a short French phrase produced by Windows speech synthesis at test time (skipped elsewhere),
  checked for a few expected words and increasing timings. No personal footage in the repo.
- TypeScript (vitest): `new` and `add` on a synthetic project with a stub analysis (a fake Python that writes
  fixture cache files), checking ids, words, meta, story clips and the on-demand trigger.
- End to end (marked slow): `adam new` on synthetic rushes, then `adam render`.

## 10. Risks

1. CPU time: subject and plate take about 1 to 2 minutes per minute of footage each; on demand keeps them rare.
2. Model downloads (about 1.6 GB for Whisper large-v3-turbo) need the network once; the error says so.
3. Pillow 9.5, pinned by simple-lama-inpainting, crashes with fonts next to torch: the analysis never draws text.
4. Whisper on music or silence returns no words: the take still becomes a story clip, flagged in the output.
