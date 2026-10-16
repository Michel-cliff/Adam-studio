# Adam Studio Analysis Pipeline Implementation Plan (sub-project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `adam new <dir> <videos...>` and `adam add <dir> <videos...>` turn rushes into a ready Adam Studio project; the heavy analysis (cut-out, clean plate) runs on demand when an edit needs it.

**Architecture:** A Python package `py/analysis` (`adam_analysis`, own venv) only reads videos and writes `cache/<assetId>/` files: `edit.mp4` and `probe.json`, `proxy.mp4`, `transcript.json`, `silences.json`, `subject.webm`, `plate.png`, plus `manifest.json` for freshness. It runs as `python -m adam_analysis run <projectDir> --video c01=<path> ... --steps ...`. The TypeScript side (`packages/render`) owns `project.json`: `adam new | add` assign ids, call the analysis, then merge probe and transcript into the project through the model; `render`, `review`, `studio` and `capcut-prep` compute what the timeline is missing and run the analysis for exactly that before linting.

**Tech Stack:** Python 3.12, faster-whisper 1.2.1, ctranslate2 4.8.3, torch 2.14.1 and torchvision 0.29.1 (CPU), opencv-python-headless 4.11.0.86, numpy 1.26.4, simple-lama-inpainting 0.1.2 (pins Pillow 9.5.0), pytest 9.0.3; ffmpeg/ffprobe; TypeScript (existing `packages/render`, vitest).

**Spec:** `docs/superpowers/specs/2026-10-16-adam-studio-analysis-design.md` (and the core spec section 9 for the cache contract).

## Global Constraints

- Python never edits `project.json`; TypeScript never decodes media (it reads `probe.json` and `transcript.json`).
- Every output is written as `tmp-<name>` then renamed. A step is redone when its output is missing, its version changed, the source size or mtime changed, a dependency was redone after it, or `--force`.
- Steps and dependencies: `edit` (none), `proxy` (edit), `transcript` (edit), `silences` (transcript), `subject` (edit), `plate` (edit). Cheap steps at import: `edit, proxy, transcript, silences`.
- Cache contract: edit.mp4 H.264 crf 18, canvas fps, source aspect kept with its longer side 1920, a keyframe every second (`-g <fps>`), no B-frames, AAC when the source has audio; proxy.mp4 half size, same GOP rule; subject.webm VP9 yuva420p, same size and frame count as edit.mp4, `-g <fps>`; plate.png same size as edit.mp4, from ungraded frames.
- Whisper: `large-v3-turbo`, CPU `int8`, beam 5, `vad_filter=False`, `condition_on_previous_text=False`, word timestamps, audio passed as numpy samples (faster-whisper 1.2.1 breaks with PyAV 19). RobustVideoMatting `mobilenetv3` via torch hub, `torch.set_num_threads(6)`.
- The analysis venv is `py/analysis/.venv` (never committed); the CLI finds its Python there or through `ADAM_ANALYSIS_PYTHON`; every subprocess uses argument arrays.
- No personal footage or speech in the repo: tests use ffmpeg lavfi sources and Windows speech synthesis.
- Python commands run from the repo root with `py/analysis/.venv/Scripts/python`. Docs and messages use no em dash characters. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A phone video stored landscape with a rotation flag: edit.mp4 is the displayed (portrait) orientation and probe.json reports the displayed size (Task 2 rotated source test).
- A take without audio, or with music and no speech: edit.mp4 has no audio stream and the transcript has no words, and the take still becomes a story clip covering the whole take (Task 2 no-audio test, Task 3 empty transcript, Task 5 `takeClip` test).
- Running `adam add` twice with the same video, or after an interrupted analysis: the video is not added twice, finished steps are kept, half-written files never count as done (Task 2 runner tests, Task 5 `addTakes` test).
- A project folder or video path with spaces and accents: the analysis runs and the project validates (Task 7 end-to-end in a folder named with a space and an accent).
- A render whose edit needs a cut-out the cache does not have: the analysis runs for that asset and step only, before lint, and `--no-analyze` refuses with the step to run (Task 6 tests).

---

### Task 1: Analysis package, probe and contract checks

**Files:**
- Create: `py/analysis/pyproject.toml`, `py/analysis/adam_analysis/__init__.py`, `py/analysis/adam_analysis/errors.py`, `py/analysis/adam_analysis/probe.py`, `py/analysis/adam_analysis/check.py`, `py/analysis/tests/media.py`
- Test: `py/analysis/tests/test_probe.py`, `py/analysis/tests/test_check.py`

**Interfaces:**
- Produces: `AnalysisError(Exception)`; `probe(path) -> {"durationMs", "width", "height", "fps", "hasAudio", "rotation"}` (width and height as displayed, after rotation); `max_keyframe_gap(path) -> float`; `check_edit(path, duration_ms, fps, has_audio) -> list[str]`, `check_proxy(path, fps)`, `check_subject(path, edit_info, fps)`, `check_plate(path, edit_info)` (problems, empty when the file meets the contract); test helper `tests/media.py`: `ffmpeg(*args)`, `color_video(path, size, seconds, fps=30, audio=True, color="gray")`.

- [ ] **Step 1: Create the package and the venv**

`py/analysis/pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "adam-analysis"
version = "0.1.0"
description = "Adam Studio analysis pipeline"
requires-python = ">=3.12"
dependencies = [
  "faster-whisper==1.2.1",
  "ctranslate2==4.8.3",
  "numpy==1.26.4",
  "opencv-python-headless==4.11.0.86",
  "simple-lama-inpainting==0.1.2",
]

[project.optional-dependencies]
dev = ["pytest==9.0.3"]

[tool.setuptools]
packages = ["adam_analysis", "adam_analysis.steps"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: downloads models or runs matting (minutes)"]
```

`py/analysis/adam_analysis/__init__.py`:
```python
"""Adam Studio analysis: python -m adam_analysis run <projectDir> --video c01=<path> --steps edit,proxy,..."""
```

`py/analysis/adam_analysis/errors.py`:
```python
class AnalysisError(Exception):
    """An expected failure, shown to the creator as is: names the asset, the step and the cause."""
```

Create `py/analysis/adam_analysis/steps/__init__.py` empty.

Run:
```bash
python -m venv py/analysis/.venv
py/analysis/.venv/Scripts/python -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
py/analysis/.venv/Scripts/python -m pip install -e "py/analysis[dev]"
```
Expected: exit code 0 each; `py/analysis/.venv/Scripts/python -c "import torch, faster_whisper, cv2, simple_lama_inpainting; print(torch.__version__)"` prints `2.14.1+cpu`.

- [ ] **Step 2: Write the failing tests**

`py/analysis/tests/media.py`:
```python
"""Synthetic test media made with ffmpeg (no personal footage in the repo)."""
import subprocess
from pathlib import Path


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def color_video(path: Path, size: str, seconds: float, fps: int = 30, audio: bool = True, color: str = "gray") -> Path:
    inputs = ["-f", "lavfi", "-i", f"color=c={color}:s={size}:r={fps}:d={seconds}"]
    if audio:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    ffmpeg(*inputs, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", *(["-c:a", "aac"] if audio else []), str(path))
    return path
```

`py/analysis/tests/test_probe.py`:
```python
from media import color_video, ffmpeg

from adam_analysis.probe import probe


def test_probe_reads_duration_size_fps_and_audio(tmp_path):
    info = probe(color_video(tmp_path / "a.mp4", "640x360", 2))
    assert (info["width"], info["height"], info["fps"], info["hasAudio"], info["rotation"]) == (640, 360, 30, True, 0)
    assert abs(info["durationMs"] - 2000) <= 50


def test_probe_reports_the_displayed_size_of_a_rotated_video(tmp_path):
    src = color_video(tmp_path / "landscape.mp4", "640x360", 1)
    rotated = tmp_path / "phone.mp4"
    ffmpeg("-display_rotation:v:0", "-90", "-i", str(src), "-c", "copy", str(rotated))
    info = probe(rotated)
    assert (info["width"], info["height"]) == (360, 640)
    assert info["rotation"] in (90, -90, 270)


def test_probe_without_audio(tmp_path):
    assert probe(color_video(tmp_path / "silent.mp4", "640x360", 1, audio=False))["hasAudio"] is False
```

`py/analysis/tests/test_check.py`:
```python
from media import color_video, ffmpeg

from adam_analysis.check import check_edit, check_plate, check_subject, max_keyframe_gap
from adam_analysis.probe import probe


def good_edit(path):
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path))
    return path


def test_a_good_edit_has_no_problem(tmp_path):
    edit = good_edit(tmp_path / "edit.mp4")
    assert abs(max_keyframe_gap(edit) - 1.0) < 0.05
    assert check_edit(edit, 3000, 30, True) == []


def test_edit_problems_are_named(tmp_path):
    bad = color_video(tmp_path / "edit.mp4", "1080x1920", 3, audio=False)  # x264 defaults: B-frames, one keyframe
    problems = check_edit(bad, 3000, 30, True)
    assert "edit.mp4 has B-frames" in problems
    assert "edit.mp4 has no audio" in problems
    assert any("between keyframes" in p for p in problems)


def test_subject_and_plate_must_match_the_edit(tmp_path):
    edit = good_edit(tmp_path / "edit.mp4")
    info = probe(edit)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(lt(X,100),255,0)'",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", "30", "-auto-alt-ref", "0", "-deadline", "realtime", "-cpu-used", "8",
           str(tmp_path / "subject.webm"))
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", str(tmp_path / "plate.png"))
    assert check_subject(tmp_path / "subject.webm", info, 30) == []
    assert check_plate(tmp_path / "plate.png", info) == []
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=100x100", "-frames:v", "1", str(tmp_path / "small.png"))
    assert check_plate(tmp_path / "small.png", info) == ["plate.png is 100x100, the edit 1080x1920"]
```

- [ ] **Step 3: Run them to see them fail**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_analysis.probe'` (and `adam_analysis.check`).

- [ ] **Step 4: Implement**

`py/analysis/adam_analysis/probe.py`:
```python
"""What a video is, as displayed: ffprobe with the rotation applied."""
import json
import subprocess
from pathlib import Path

from .errors import AnalysisError


def ffprobe_json(path: Path, *args: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", *args, "-of", "json", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise AnalysisError(f"cannot read {path}: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def probe(path: Path) -> dict:
    info = ffprobe_json(Path(path), "-show_entries", "stream=codec_type,width,height,avg_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration")
    video = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    if video is None:
        raise AnalysisError(f"{path} has no video stream")
    rotation = 0
    for side in video.get("side_data_list", []):
        if "rotation" in side:
            rotation = int(side["rotation"])
    if not rotation and "rotate" in video.get("tags", {}):
        rotation = int(video["tags"]["rotate"])
    w, h = int(video["width"]), int(video["height"])
    if abs(rotation) % 180 == 90:
        w, h = h, w
    num, den = (int(x) for x in video.get("avg_frame_rate", "30/1").split("/"))
    return {
        "durationMs": round(float(info["format"]["duration"]) * 1000),
        "width": w, "height": h,
        "fps": round(num / den) if den else 30,
        "hasAudio": any(s.get("codec_type") == "audio" for s in info["streams"]),
        "rotation": rotation,
    }
```

`py/analysis/adam_analysis/check.py`:
```python
"""The cache contract (core spec section 9), one check per file. Each returns the problems, empty when fine."""
from pathlib import Path

from .probe import ffprobe_json, probe


def video_stream(path: Path) -> dict:
    return ffprobe_json(path, "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,has_b_frames:stream_tags")["streams"][0]


def max_keyframe_gap(path: Path) -> float:
    """Longest time between two keyframes, or from the last keyframe to the end, in seconds."""
    info = ffprobe_json(path, "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags:format=duration")
    keys = sorted(float(p["pts_time"]) for p in info["packets"] if "K" in p.get("flags", "") and p.get("pts_time") not in (None, "N/A"))
    end = float(info["format"]["duration"])
    if not keys:
        return end
    return max([b - a for a, b in zip(keys, keys[1:])] + [end - keys[-1]])


def _gop(path: Path, fps: int) -> list[str]:
    gap = max_keyframe_gap(path)
    return [f"{path.name} has {gap:.2f} s between keyframes (GOP rule: 1 s)"] if gap > 1 + 1.5 / fps else []


def check_edit(path: Path, duration_ms: int, fps: int, has_audio: bool) -> list[str]:
    v = video_stream(path)
    problems = []
    if v["codec_name"] != "h264":
        problems.append(f"edit.mp4 is {v['codec_name']}, expected h264")
    if max(v["width"], v["height"]) != 1920:
        problems.append(f"edit.mp4 is {v['width']}x{v['height']}, its longer side must be 1920")
    if int(v.get("has_b_frames", 0)) != 0:
        problems.append("edit.mp4 has B-frames")
    if has_audio and not probe(path)["hasAudio"]:
        problems.append("edit.mp4 has no audio")
    lasts = probe(path)["durationMs"]
    if abs(lasts - duration_ms) > 100:
        problems.append(f"edit.mp4 lasts {lasts} ms, the source {duration_ms} ms")
    return problems + _gop(path, fps)


def check_proxy(path: Path, fps: int) -> list[str]:
    v = video_stream(path)
    return ([f"proxy.mp4 is {v['codec_name']}, expected h264"] if v["codec_name"] != "h264" else []) + _gop(path, fps)


def check_subject(path: Path, edit_info: dict, fps: int) -> list[str]:
    s = video_stream(path)
    problems = []
    if (s["codec_name"], s["width"], s["height"]) != ("vp9", edit_info["width"], edit_info["height"]):
        problems.append(f"subject.webm is {s['codec_name']} {s['width']}x{s['height']}, the edit {edit_info['width']}x{edit_info['height']}")
    if {k.lower(): v for k, v in s.get("tags", {}).items()}.get("alpha_mode") != "1":
        problems.append("subject.webm has no alpha channel")
    return problems + _gop(path, fps)


def check_plate(path: Path, edit_info: dict) -> list[str]:
    p = video_stream(path)
    if (p["width"], p["height"]) != (edit_info["width"], edit_info["height"]):
        return [f"plate.png is {p['width']}x{p['height']}, the edit {edit_info['width']}x{edit_info['height']}"]
    return []
```


- [ ] **Step 5: Run the tests**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add py/analysis
git commit -m "feat(analysis): package, probe with rotation, cache contract checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Edit and proxy steps, manifest and the runner

**Files:**
- Create: `py/analysis/adam_analysis/steps/edit.py`, `py/analysis/adam_analysis/manifest.py`, `py/analysis/adam_analysis/runner.py`, `py/analysis/adam_analysis/__main__.py`
- Test: `py/analysis/tests/test_edit.py`, `py/analysis/tests/test_runner.py`

**Interfaces:**
- Consumes: `probe`, checks (Task 1).
- Produces: `edit_size(w, h) -> (w, h)`; `make_edit(src, dst, fps)`, `make_proxy(edit, dst, fps)`; `manifest.STEPS = ["edit", "proxy", "transcript", "silences", "subject", "plate"]`, `DEPENDS`, `OUTPUTS`, `VERSIONS` (filled by each step module), `needs_run(cache, step, source, force, redone) -> bool`, `record(cache, step, source, seconds)`; `runner.run(project_dir, videos: dict[id, path], steps, fps=30, lang=None, force=False) -> dict[id, list[str]]` (steps run per asset); CLI `python -m adam_analysis run <projectDir> --video c01=<path> [--video ...] --steps edit,proxy [--fps 30] [--lang fr] [--force]`. A registry `runner.STEP_FUNCS: dict[str, callable(cache, source, ctx)]` that Tasks 3 and 4 extend.

- [ ] **Step 1: Write the failing tests**

`py/analysis/tests/test_edit.py`:
```python
from media import color_video, ffmpeg

from adam_analysis.check import check_edit, check_proxy
from adam_analysis.probe import probe
from adam_analysis.steps.edit import edit_size, make_edit, make_proxy


def test_edit_size_keeps_the_aspect_with_a_1920_long_side():
    assert edit_size(2160, 3840) == (1080, 1920)
    assert edit_size(3840, 2160) == (1920, 1080)
    assert edit_size(1440, 1080) == (1920, 1440)


def test_edit_follows_the_contract(tmp_path):
    src = color_video(tmp_path / "src.mp4", "540x960", 3)
    make_edit(src, tmp_path / "edit.mp4", 30)
    info = probe(tmp_path / "edit.mp4")
    assert (info["width"], info["height"], info["fps"]) == (1080, 1920, 30)
    assert check_edit(tmp_path / "edit.mp4", 3000, 30, True) == []
    make_proxy(tmp_path / "edit.mp4", tmp_path / "proxy.mp4", 30)
    assert (probe(tmp_path / "proxy.mp4")["width"], probe(tmp_path / "proxy.mp4")["height"]) == (540, 960)
    assert check_proxy(tmp_path / "proxy.mp4", 30) == []


def test_a_rotated_phone_video_is_edited_upright(tmp_path):
    src = color_video(tmp_path / "landscape.mp4", "960x540", 1)
    phone = tmp_path / "phone.mp4"
    ffmpeg("-display_rotation:v:0", "-90", "-i", str(src), "-c", "copy", str(phone))
    make_edit(phone, tmp_path / "edit.mp4", 30)
    info = probe(tmp_path / "edit.mp4")
    assert (info["width"], info["height"], info["rotation"]) == (1080, 1920, 0)


def test_a_silent_source_gives_a_silent_edit(tmp_path):
    make_edit(color_video(tmp_path / "s.mp4", "540x960", 1, audio=False), tmp_path / "edit.mp4", 30)
    assert probe(tmp_path / "edit.mp4")["hasAudio"] is False
```

`py/analysis/tests/test_runner.py`:
```python
import json
import os
import time

from media import color_video

from adam_analysis.runner import run


def test_runs_steps_writes_probe_and_manifest(tmp_path):
    src = color_video(tmp_path / "take one é.mp4", "540x960", 2)
    done = run(tmp_path / "project", {"c01": src}, ["proxy"])
    cache = tmp_path / "project" / "cache" / "c01"
    assert done == {"c01": ["edit", "proxy"]}
    assert (cache / "edit.mp4").is_file() and (cache / "proxy.mp4").is_file()
    assert json.loads((cache / "probe.json").read_text(encoding="utf-8"))["width"] == 1080
    manifest = json.loads((cache / "manifest.json").read_text(encoding="utf-8"))
    assert set(manifest["steps"]) == {"edit", "proxy"}
    assert not list(cache.glob("tmp-*"))


def test_a_second_run_keeps_finished_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["proxy"])
    assert run(tmp_path / "p", {"c01": src}, ["proxy"]) == {"c01": []}


def test_a_changed_source_redoes_its_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["proxy"])
    later = time.time() + 5
    os.utime(src, (later, later))
    assert run(tmp_path / "p", {"c01": src}, ["proxy"]) == {"c01": ["edit", "proxy"]}


def test_force_redoes_the_asked_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["edit"])
    assert run(tmp_path / "p", {"c01": src}, ["edit"], force=True) == {"c01": ["edit"]}
```

- [ ] **Step 2: Run them to see them fail**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: FAIL with `ModuleNotFoundError` for `adam_analysis.steps.edit` and `adam_analysis.runner`.

- [ ] **Step 3: Implement**

`py/analysis/adam_analysis/steps/edit.py`:
```python
"""edit.mp4: the take as the renderer reads it; proxy.mp4: half size for previews."""
import subprocess
from pathlib import Path

from ..errors import AnalysisError

VERSION = 1
LONG_SIDE = 1920


def edit_size(w: int, h: int) -> tuple[int, int]:
    """Source aspect kept, longer side 1920, even sizes."""
    if w >= h:
        return LONG_SIDE, round(h * LONG_SIDE / w / 2) * 2
    return round(w * LONG_SIDE / h / 2) * 2, LONG_SIDE


def ffmpeg(args: list[str], what: str) -> None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise AnalysisError(f"{what} failed: {r.stderr.strip()[-400:]}")


def encode(fps: int, audio_kbps: int) -> list[str]:
    return ["-r", str(fps), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-g", str(fps), "-bf", "0",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", f"{audio_kbps}k"]


def make_edit(src: Path, dst: Path, fps: int) -> None:
    from ..probe import probe

    info = probe(src)
    w, h = edit_size(info["width"], info["height"])
    # ffmpeg applies the rotation flag itself; no -shortest, so the video keeps its last partial frame.
    ffmpeg(["-i", str(src), "-vf", f"scale={w}:{h}:flags=lanczos", *encode(fps, 192), str(dst)], f"edit.mp4 from {src}")


def make_proxy(edit: Path, dst: Path, fps: int) -> None:
    ffmpeg(["-i", str(edit), "-vf", "scale=trunc(iw/4)*2:trunc(ih/4)*2", *encode(fps, 128), str(dst)], "proxy.mp4")
```

`py/analysis/adam_analysis/manifest.py`:
```python
"""cache/<assetId>/manifest.json: which steps ran, from which source, at which version."""
import json
import time
from pathlib import Path

STEPS = ["edit", "proxy", "transcript", "silences", "subject", "plate"]
DEPENDS = {"edit": None, "proxy": "edit", "transcript": "edit", "silences": "transcript", "subject": "edit", "plate": "edit"}
OUTPUTS = {"edit": ["edit.mp4", "probe.json"], "proxy": ["proxy.mp4"], "transcript": ["transcript.json"],
           "silences": ["silences.json"], "subject": ["subject.webm"], "plate": ["plate.png"]}
VERSIONS: dict[str, int] = {}  # filled by the runner from each step module


def load(cache: Path) -> dict:
    f = cache / "manifest.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {"source": None, "steps": {}}


def source_stamp(source: Path) -> dict:
    st = Path(source).stat()
    return {"path": str(source), "size": st.st_size, "mtimeMs": int(st.st_mtime * 1000)}


def needs_run(cache: Path, step: str, source: Path, force: bool, redone: set[str]) -> bool:
    m = load(cache)
    entry = m["steps"].get(step)
    stamp = source_stamp(source)
    return (force or entry is None or entry.get("version") != VERSIONS.get(step)
            or any(not (cache / f).is_file() for f in OUTPUTS[step])
            or m.get("source") is None or (m["source"]["size"], m["source"]["mtimeMs"]) != (stamp["size"], stamp["mtimeMs"])
            or (DEPENDS[step] is not None and DEPENDS[step] in redone))


def record(cache: Path, step: str, source: Path, seconds: float) -> None:
    m = load(cache)
    m["source"] = source_stamp(source)
    m["steps"][step] = {"version": VERSIONS.get(step), "finishedAt": int(time.time() * 1000), "seconds": round(seconds, 1)}
    (cache / "manifest.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
```

`py/analysis/adam_analysis/runner.py`:
```python
"""Runs the asked steps (and what they depend on) for each video, skipping fresh results."""
import json
import time
from pathlib import Path
from typing import Callable

from . import manifest
from .errors import AnalysisError
from .probe import probe
from .steps import edit as edit_step

Ctx = dict  # {"fps": int, "lang": str | None}


def _edit(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-edit.mp4"
    edit_step.make_edit(source, tmp, ctx["fps"])
    tmp.replace(cache / "edit.mp4")
    info = probe(cache / "edit.mp4") | {"sourceHasAudio": probe(source)["hasAudio"]}
    (cache / "probe.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")


def _proxy(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-proxy.mp4"
    edit_step.make_proxy(cache / "edit.mp4", tmp, ctx["fps"])
    tmp.replace(cache / "proxy.mp4")


STEP_FUNCS: dict[str, Callable[[Path, Path, Ctx], None]] = {"edit": _edit, "proxy": _proxy}
manifest.VERSIONS.update({"edit": edit_step.VERSION, "proxy": edit_step.VERSION})


def with_dependencies(steps: list[str]) -> list[str]:
    wanted = set()
    for s in steps:
        while s is not None:
            wanted.add(s)
            s = manifest.DEPENDS[s]
    return [s for s in manifest.STEPS if s in wanted]


def run(project_dir, videos: dict, steps: list[str], fps: int = 30, lang: str | None = None, force: bool = False) -> dict:
    for s in steps:
        if s not in STEP_FUNCS:
            raise AnalysisError(f'unknown step "{s}" (known: {", ".join(STEP_FUNCS)})')
    done = {}
    for asset, source in videos.items():
        source = Path(source)
        if not source.is_file():
            raise AnalysisError(f"{asset}: source video {source} not found")
        cache = Path(project_dir) / "cache" / asset
        cache.mkdir(parents=True, exist_ok=True)
        redone: set[str] = set()
        for step in with_dependencies(steps):
            if not manifest.needs_run(cache, step, source, force and step in steps, redone):
                continue
            t0 = time.time()
            try:
                STEP_FUNCS[step](cache, source, {"fps": fps, "lang": lang})
            except AnalysisError as e:
                raise AnalysisError(f"{asset} {step}: {e}") from None
            seconds = time.time() - t0
            manifest.record(cache, step, source, seconds)
            redone.add(step)
            print(f"{asset} {step}: {seconds:.0f} s", flush=True)
        done[asset] = [s for s in manifest.STEPS if s in redone]
    return done
```

`py/analysis/adam_analysis/__main__.py`:
```python
"""python -m adam_analysis run <projectDir> --video c01=<path> [--video ...] --steps edit,proxy [--fps 30] [--lang fr] [--force]"""
import argparse
import sys

from .errors import AnalysisError
from .runner import run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m adam_analysis")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("project_dir")
    r.add_argument("--video", action="append", required=True, help="assetId=path, repeatable")
    r.add_argument("--steps", required=True)
    r.add_argument("--fps", type=int, default=30)
    r.add_argument("--lang")
    r.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    try:
        videos = dict(v.split("=", 1) for v in args.video)
        run(args.project_dir, videos, [s for s in args.steps.split(",") if s], fps=args.fps, lang=args.lang, force=args.force)
    except (AnalysisError, ValueError) as e:
        print(e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add py/analysis
git commit -m "feat(analysis): edit and proxy steps, manifest freshness and the step runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Transcript and silences

**Files:**
- Create: `py/analysis/adam_analysis/steps/transcript.py`, `py/analysis/adam_analysis/steps/silences.py`
- Modify: `py/analysis/adam_analysis/runner.py`
- Test: `py/analysis/tests/test_silences.py`, `py/analysis/tests/test_transcript.py`

**Interfaces:**
- Produces: `transcribe(edit, lang) -> {"lang", "langProbability", "words": [{text, startMs, endMs, p}]}`; `pauses_from_words(words, min_ms=350)`, `parse_silencedetect(stderr) -> [{startMs, endMs}]`, `make_silences(edit, words) -> {"pauses", "quiet"}`; runner steps `transcript` and `silences`.

- [ ] **Step 1: Write the failing tests**

`py/analysis/tests/test_silences.py`:
```python
from adam_analysis.steps.silences import parse_silencedetect, pauses_from_words


def test_pauses_are_gaps_between_words_longer_than_350_ms():
    words = [{"startMs": 0, "endMs": 400}, {"startMs": 500, "endMs": 900}, {"startMs": 1400, "endMs": 1600}]
    assert pauses_from_words(words) == [{"startMs": 900, "endMs": 1400}]


def test_silencedetect_output_is_parsed():
    stderr = ("[silencedetect @ 0x1] silence_start: 1.25\n"
              "[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.25\n"
              "[silencedetect @ 0x1] silence_start: 4\n")
    assert parse_silencedetect(stderr, 5000) == [{"startMs": 1250, "endMs": 2500}, {"startMs": 4000, "endMs": 5000}]
```

`py/analysis/tests/test_transcript.py`:
```python
import shutil
import subprocess
import sys

import pytest
from media import ffmpeg

from adam_analysis.runner import run


def speak(text: str, wav):
    script = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
              "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'fr*' } | Select-Object -First 1; "
              "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; "
              f"$s.SetOutputToWaveFile('{wav}'); $s.Speak('{text}'); $s.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)


@pytest.mark.slow
@pytest.mark.skipif(sys.platform != "win32" or not shutil.which("powershell"), reason="Windows speech synthesis")
def test_words_come_with_increasing_timings(tmp_path):
    wav = tmp_path / "voice.wav"
    speak("Bonjour, ceci est un essai de transcription pour Adam Studio.", wav)
    video = tmp_path / "talk.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=540x960:r=30", "-i", str(wav), "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-c:a", "aac", str(video))
    run(tmp_path / "p", {"c01": video}, ["silences"], lang="fr")
    import json

    t = json.loads((tmp_path / "p" / "cache" / "c01" / "transcript.json").read_text(encoding="utf-8"))
    words = t["words"]
    assert len(words) >= 5 and t["lang"] == "fr"
    assert all(w["text"] == w["text"].strip() and w["endMs"] >= w["startMs"] for w in words)
    assert [w["startMs"] for w in words] == sorted(w["startMs"] for w in words)
    assert any("adam" in w["text"].lower() for w in words)
    assert (tmp_path / "p" / "cache" / "c01" / "silences.json").is_file()


@pytest.mark.slow
def test_a_take_without_speech_has_no_words(tmp_path):
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=540x960:r=30:d=2", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(tmp_path / "quiet.mp4"))
    run(tmp_path / "p", {"c01": tmp_path / "quiet.mp4"}, ["transcript"], lang="fr")
    import json

    assert json.loads((tmp_path / "p" / "cache" / "c01" / "transcript.json").read_text(encoding="utf-8"))["words"] == []
```

- [ ] **Step 2: Run them to see them fail**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'adam_analysis.steps.silences'`.

- [ ] **Step 3: Implement**

`py/analysis/adam_analysis/steps/transcript.py`:
```python
"""transcript.json: words with timings, in the spoken language (faster-whisper large-v3-turbo on CPU)."""
import subprocess
from pathlib import Path

import numpy as np

from ..errors import AnalysisError

VERSION = 1
MODEL = "large-v3-turbo"
_model = None


def model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel

            _model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        except Exception as e:  # first use downloads about 1.6 GB
            raise AnalysisError(f"cannot load Whisper {MODEL} (the first run downloads it, network needed): {e}") from None
    return _model


def audio_samples(edit: Path) -> np.ndarray:
    """16 kHz mono float samples decoded by ffmpeg (faster-whisper 1.2.1's own decoder breaks with PyAV 19)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(edit), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True)
    if r.returncode != 0:
        raise AnalysisError(f"cannot decode the audio of {edit}: {r.stderr.decode(errors='replace')[-300:]}")
    return np.frombuffer(r.stdout, dtype="<i2").astype(np.float32) / 32768.0


def transcribe(edit: Path, lang: str | None, has_audio: bool) -> dict:
    if not has_audio:
        return {"lang": lang, "langProbability": None, "words": []}
    audio = audio_samples(edit)
    if audio.size == 0:
        return {"lang": lang, "langProbability": None, "words": []}
    segments, info = model().transcribe(audio, language=lang, word_timestamps=True, beam_size=5, vad_filter=False,
                                        condition_on_previous_text=False)
    words = []
    for s in segments:
        for w in s.words or []:
            text = w.word.strip()
            if not text:
                continue
            start = round(w.start * 1000)
            words.append({"text": text, "startMs": start, "endMs": max(start, round(w.end * 1000)), "p": round(w.probability, 3)})
    return {"lang": info.language, "langProbability": round(info.language_probability, 3), "words": words}
```

`py/analysis/adam_analysis/steps/silences.py`:
```python
"""silences.json: pauses between words and quiet stretches of the audio."""
import re
import subprocess
from pathlib import Path

VERSION = 1


def pauses_from_words(words: list[dict], min_ms: int = 350) -> list[dict]:
    return [{"startMs": a["endMs"], "endMs": b["startMs"]} for a, b in zip(words, words[1:]) if b["startMs"] - a["endMs"] > min_ms]


def parse_silencedetect(stderr: str, duration_ms: int) -> list[dict]:
    out, start = [], None
    for line in stderr.splitlines():
        if m := re.search(r"silence_start: (-?[\d.]+)", line):
            start = max(0, round(float(m.group(1)) * 1000))
        elif (m := re.search(r"silence_end: ([\d.]+)", line)) and start is not None:
            out.append({"startMs": start, "endMs": round(float(m.group(1)) * 1000)})
            start = None
    if start is not None:
        out.append({"startMs": start, "endMs": duration_ms})
    return out


def make_silences(edit: Path, words: list[dict], duration_ms: int, has_audio: bool) -> dict:
    quiet = []
    if has_audio:
        r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(edit), "-vn", "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
                           capture_output=True, text=True, errors="replace")
        quiet = parse_silencedetect(r.stderr, duration_ms)
    return {"pauses": pauses_from_words(words), "quiet": quiet}
```

In `py/analysis/adam_analysis/runner.py`, add `from .steps import silences as silences_step` and `from .steps import transcript as transcript_step` to the imports, add after `_proxy`:
```python
def _transcript(cache: Path, source: Path, ctx: Ctx) -> None:
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    result = transcript_step.transcribe(cache / "edit.mp4", ctx["lang"], info["hasAudio"])
    tmp = cache / "tmp-transcript.json"
    tmp.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(cache / "transcript.json")


def _silences(cache: Path, source: Path, ctx: Ctx) -> None:
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    words = json.loads((cache / "transcript.json").read_text(encoding="utf-8"))["words"]
    result = silences_step.make_silences(cache / "edit.mp4", words, info["durationMs"], info["hasAudio"])
    tmp = cache / "tmp-silences.json"
    tmp.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    tmp.replace(cache / "silences.json")
```
and replace the two registry lines with:
```python
STEP_FUNCS: dict[str, Callable[[Path, Path, Ctx], None]] = {"edit": _edit, "proxy": _proxy, "transcript": _transcript, "silences": _silences}
manifest.VERSIONS.update({"edit": edit_step.VERSION, "proxy": edit_step.VERSION, "transcript": transcript_step.VERSION,
                          "silences": silences_step.VERSION})
```

- [ ] **Step 4: Run the tests**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: 18 tests PASS (the two transcript tests load Whisper: about a minute; the first run on a machine without the model downloads it).

- [ ] **Step 5: Commit**

```bash
git add py/analysis
git commit -m "feat(analysis): Whisper word transcript and silences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cut-out and clean plate

**Files:**
- Create: `py/analysis/adam_analysis/steps/matting.py`
- Modify: `py/analysis/adam_analysis/runner.py`
- Test: `py/analysis/tests/test_matting.py`

**Interfaces:**
- Produces: `make_subject(edit, dst, fps) -> frames`, `make_plate(edit, dst)`; runner steps `subject` and `plate`.

- [ ] **Step 1: Write the failing test**

`py/analysis/tests/test_matting.py`:
```python
import json

import cv2
import pytest
from media import ffmpeg

from adam_analysis.check import check_plate, check_subject
from adam_analysis.runner import run


@pytest.mark.slow
def test_subject_and_plate_follow_the_contract_and_the_plate_hides_what_moves(tmp_path):
    # A blue background with a white square crossing it: the median over time is the background.
    src = tmp_path / "moving.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=540x960:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
           "-vf", "drawbox=x='t*120':y=400:w=120:h=120:color=white:t=fill", "-c:v", "libx264", "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-c:a", "aac", str(src))
    run(tmp_path / "p", {"c01": src}, ["subject", "plate"])
    cache = tmp_path / "p" / "cache" / "c01"
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    assert check_subject(cache / "subject.webm", info, 30) == []
    assert check_plate(cache / "plate.png", info) == []
    plate = cv2.imread(str(cache / "plate.png"))
    b, g, r = plate[int(460 * 2), int(300 * 2)]  # on the square's path, in edit.mp4 coordinates (2x the source)
    assert b > 150 and r < 80, f"the plate shows the background, got {(r, g, b)}"
```

- [ ] **Step 2: Run it to see it fail**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis/tests/test_matting.py -q`
Expected: FAIL with `AnalysisError: unknown step "subject"`.

- [ ] **Step 3: Implement**

`py/analysis/adam_analysis/steps/matting.py` (adapted from `spikes/acceptance-1015/build_cache.py`, frame size read from the edit):
```python
"""subject.webm (RobustVideoMatting cut-out with alpha) and plate.png (the room without the person)."""
import subprocess
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from ..errors import AnalysisError
from ..probe import probe

VERSION = 1
torch.set_num_threads(6)  # lab measurement: 6 threads about 5x faster than 12 on this CPU (oversubscription)
_rvm = None


def rvm():
    global _rvm
    if _rvm is None:
        try:
            _rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "mobilenetv3", trust_repo=True).eval()
        except Exception as e:
            raise AnalysisError(f"cannot load RobustVideoMatting (the first run downloads it, network needed): {e}") from None
    return _rvm


def frames(src: Path, w: int, h: int):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.stdout.close()
    if p.wait() != 0:
        raise AnalysisError(f"cannot decode {src}")


class Matter:
    """Stateful matting (RVM is recurrent: feed consecutive frames) at reduced size, upsampled."""

    def __init__(self, w: int, h: int, scale: float = 0.5, ratio: float = 0.375):
        self.rec = [None] * 4
        self.size, self.small, self.ratio = (w, h), (max(2, int(w * scale)), max(2, int(h * scale))), ratio

    @torch.inference_mode()
    def __call__(self, rgb):
        small = cv2.resize(rgb, self.small, interpolation=cv2.INTER_AREA)
        src = torch.from_numpy(small).permute(2, 0, 1).float().unsqueeze(0) / 255.0
        _, pha, *self.rec = rvm()(src, *self.rec, downsample_ratio=self.ratio)
        return cv2.resize(pha[0, 0].numpy(), self.size, interpolation=cv2.INTER_LINEAR)


def make_subject(edit: Path, dst: Path, fps: int) -> int:
    info = probe(edit)
    w, h = info["width"], info["height"]
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", str(fps), "-auto-alt-ref", "0",
         "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", str(dst)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    matter, n = Matter(w, h), 0
    for f in frames(edit, w, h):
        alpha = (np.clip(matter(f), 0, 1) * 255).astype(np.uint8)
        enc.stdin.write(np.dstack([f, alpha]).tobytes())
        n += 1
    enc.stdin.close()
    if enc.wait() != 0:
        raise AnalysisError(f"ffmpeg failed writing subject.webm: {enc.stderr.read().decode(errors='replace')[-300:]}")
    return n


def make_plate(edit: Path, dst: Path) -> None:
    """Per-pixel median of unoccluded samples, LaMa for the never-seen part (ungraded frames)."""
    info = probe(edit)
    w, h = info["width"], info["height"]
    matter = Matter(w, h, scale=0.25, ratio=1.0)  # coarse matte is enough: it gets dilated anyway
    samples, masks = [], []
    for i, f in enumerate(frames(edit, w, h)):
        if i % 3:
            continue
        a = matter(f)
        if i % 6 == 0 and i > 8:  # let the recurrent matte settle first
            samples.append(f)
            masks.append(cv2.dilate((a > 0.03).astype(np.uint8), np.ones((31, 31), np.uint8)))
    if not samples:
        raise AnalysisError("the take is too short for a clean plate (under half a second)")
    stack = np.stack(samples)
    occluded = np.stack(masks).astype(bool)
    med = np.zeros((h, w, 3), np.float32)
    for r0 in range(0, h, 96):  # median in strips: float copies stay around 100 MB
        s = stack[:, r0:r0 + 96].astype(np.float32)
        s[occluded[:, r0:r0 + 96]] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med[r0:r0 + 96] = np.nanmedian(s, axis=0)
    hole = np.isnan(med[..., 0])
    med = np.nan_to_num(med).astype(np.uint8)
    if hole.any():
        from simple_lama_inpainting import SimpleLama

        mask = cv2.dilate(hole.astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
        filled = np.array(SimpleLama()(Image.fromarray(med), Image.fromarray(mask).convert("L")).convert("RGB"))[:h, :w]
        med = np.where(mask[..., None] > 0, filled, med)
    Image.fromarray(med).save(dst, format="PNG")
```

In `py/analysis/adam_analysis/runner.py`, add `from .steps import matting as matting_step`, add after `_silences`:
```python
def _subject(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-subject.webm"
    matting_step.make_subject(cache / "edit.mp4", tmp, ctx["fps"])
    tmp.replace(cache / "subject.webm")


def _plate(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-plate.png"
    matting_step.make_plate(cache / "edit.mp4", tmp)
    tmp.replace(cache / "plate.png")
```
and extend the registry and versions with `"subject": _subject, "plate": _plate` and `"subject": matting_step.VERSION, "plate": matting_step.VERSION`.

- [ ] **Step 4: Run the tests**

Run: `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`
Expected: 19 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add py/analysis
git commit -m "feat(analysis): RobustVideoMatting cut-out and clean plate steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `adam new` and `adam add`

**Files:**
- Create: `packages/render/src/takes.ts`, `packages/render/src/analysis.ts`, `packages/render/src/commands/new.ts`
- Modify: `packages/render/src/cli.ts`
- Test: `packages/render/tests/unit/takes.test.ts`, `packages/render/tests/unit/analysis.test.ts`

**Interfaces:**
- Consumes: `parseProject`, `ProjectInput`, `Project` (model), `loadProject`, `saveProject`, `CliError` (project-io).
- Produces: `takes.ts`: `type Take = { path; probe: { durationMs; width; height; hasAudio }; transcript: { lang; words: { text; startMs; endMs }[] } }`, `nextAssetIds(existing: string[], n)`, `takeClip(id, words, durationMs)`, `addTakes(project: ProjectInput, takes: Take[]): ProjectInput`, `defaultStyle(fontFile)`, `findSystemFont()`; `analysis.ts`: `CHEAP_STEPS`, `analysisPython()`, `analysisArgs(projectDir, videos: Record<string, string>, steps, opts: { fps; lang?; force? })`, `runAnalysis(projectDir, videos, steps, opts)`, `readTake(projectDir, id, path): Take`; `commands/new.ts`: `newCommand(dir, videos, opts)`, `addCommand(dir, videos, opts)`.

- [ ] **Step 1: Write the failing tests**

`packages/render/tests/unit/takes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseProject } from "@adam-studio/model";
import { addTakes, nextAssetIds, takeClip, type Take } from "../../src/takes";

const take = (path: string, words: [string, number, number][] = [["bonjour", 400, 800], ["tout", 900, 1200]], durationMs = 3000): Take => ({
  path,
  probe: { durationMs, width: 1080, height: 1920, hasAudio: true },
  transcript: { lang: "fr", words: words.map(([text, startMs, endMs]) => ({ text, startMs, endMs })) },
});

const empty = { version: 1 as const, name: "demo", canvas: { format: "9:16" as const, fps: 30 }, style: "style.json", assets: [], story: [] };

describe("nextAssetIds", () => {
  it("continues after the highest cNN", () => {
    expect(nextAssetIds([], 2)).toEqual(["c01", "c02"]);
    expect(nextAssetIds(["c01", "c07", "hud_frame"], 2)).toEqual(["c08", "c09"]);
  });
});

describe("takeClip", () => {
  it("runs from 150 ms before the first word to 250 ms after the last", () => {
    expect(takeClip("c01", [{ startMs: 400, endMs: 800 }, { startMs: 900, endMs: 1200 }], 3000)).toEqual({ id: "c01", asset: "c01", inMs: 250, outMs: 1450 });
  });
  it("covers the whole take without words, and stays inside it", () => {
    expect(takeClip("c02", [], 3000)).toEqual({ id: "c02", asset: "c02", inMs: 0, outMs: 3000 });
    expect(takeClip("c03", [{ startMs: 50, endMs: 2900 }], 3000)).toEqual({ id: "c03", asset: "c03", inMs: 0, outMs: 3000 });
  });
});

describe("addTakes", () => {
  it("adds assets, word ids and story clips, and the result is a valid project", () => {
    const p = addTakes(empty, [take("C:/rushes/a é.mp4"), take("C:/rushes/b.mp4", [])]);
    expect(p.assets!.map((a) => [a.id, a.path, a.meta])).toEqual([
      ["c01", "C:/rushes/a é.mp4", { durationMs: 3000, width: 1080, height: 1920, hasAudio: true }],
      ["c02", "C:/rushes/b.mp4", { durationMs: 3000, width: 1080, height: 1920, hasAudio: true }],
    ]);
    expect(p.transcript!.words!.c01).toEqual([
      { id: "c01.w0", text: "bonjour", startMs: 400, endMs: 800 },
      { id: "c01.w1", text: "tout", startMs: 900, endMs: 1200 },
    ]);
    expect(p.story.map((c) => c.id)).toEqual(["c01", "c02"]);
    expect(parseProject(p).ok).toBe(true);
  });
  it("skips a video already in the project", () => {
    const once = addTakes(empty, [take("C:/rushes/a.mp4")]);
    expect(addTakes(once, [take("C:/rushes/a.mp4")]).assets).toHaveLength(1);
  });
});
```

`packages/render/tests/unit/analysis.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { analysisArgs } from "../../src/analysis";

describe("analysisArgs", () => {
  it("passes every video as an argument, never through a shell", () => {
    expect(analysisArgs("C:/My Projects/démo", { c01: "C:/rushes/a é.mp4", c02: "D:/b.mp4" }, ["edit", "proxy"], { fps: 30, lang: "fr" })).toEqual([
      "-m", "adam_analysis", "run", "C:/My Projects/démo", "--video", "c01=C:/rushes/a é.mp4", "--video", "c02=D:/b.mp4",
      "--steps", "edit,proxy", "--fps", "30", "--lang", "fr",
    ]);
  });
  it("adds --force when asked", () => {
    expect(analysisArgs("p", { c01: "a.mp4" }, ["subject"], { fps: 25, force: true }).slice(-2)).toEqual(["25", "--force"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL, cannot resolve `../../src/takes` and `../../src/analysis`.

- [ ] **Step 3: Implement**

`packages/render/src/takes.ts`:
```ts
import { existsSync } from "node:fs";
import type { ProjectInput } from "@adam-studio/model";

export type Take = {
  path: string;
  probe: { durationMs: number; width: number; height: number; hasAudio: boolean };
  transcript: { lang: string | null; words: { text: string; startMs: number; endMs: number }[] };
};

export function nextAssetIds(existing: string[], n: number): string[] {
  const max = Math.max(0, ...existing.map((id) => /^c(\d+)$/.exec(id)).filter((m) => m).map((m) => Number(m![1])));
  return Array.from({ length: n }, (_, i) => `c${String(max + i + 1).padStart(2, "0")}`);
}

/** One story clip per take: from 150 ms before the first word to 250 ms after the last, the whole take without words. */
export function takeClip(id: string, words: { startMs: number; endMs: number }[], durationMs: number) {
  if (words.length === 0) return { id, asset: id, inMs: 0, outMs: durationMs };
  return { id, asset: id, inMs: Math.max(0, words[0]!.startMs - 150), outMs: Math.min(durationMs, words[words.length - 1]!.endMs + 250) };
}

export function addTakes(project: ProjectInput, takes: Take[]): ProjectInput {
  const known = new Set((project.assets ?? []).map((a) => a.path));
  const fresh = takes.filter((t) => !known.has(t.path));
  for (const t of takes) if (known.has(t.path)) console.log(`already in the project, skipped: ${t.path}`);
  const ids = nextAssetIds((project.assets ?? []).map((a) => a.id), fresh.length);
  const words = { ...(project.transcript?.words ?? {}) };
  const assets = [...(project.assets ?? [])];
  const story = [...project.story];
  fresh.forEach((t, i) => {
    const id = ids[i]!;
    assets.push({ id, kind: "video", path: t.path, meta: { ...t.probe } });
    words[id] = t.transcript.words.map((w, n) => ({ id: `${id}.w${n}`, text: w.text, startMs: w.startMs, endMs: w.endMs }));
    story.push(takeClip(id, t.transcript.words, t.probe.durationMs));
  });
  const lang = project.transcript?.lang ?? fresh.find((t) => t.transcript.lang)?.transcript.lang ?? "fr";
  return { ...project, assets, story, transcript: { lang, words } };
}

const FONTS = ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"];

export function findSystemFont(): string {
  const f = FONTS.find((p) => existsSync(p));
  if (!f) throw new Error(`no font found among ${FONTS.join(", ")}: pass --style with your own style.json`);
  return f;
}

export function defaultStyle(fontFile: string) {
  const font = { family: "Default", file: fontFile };
  const slots = { caption: { x: 0.5, y: 0.76 }, title: { x: 0.5, y: 0.31 }, center: { x: 0.5, y: 0.5 } };
  return {
    name: "Default",
    fonts: { caption: font, title: font },
    colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" },
    grade: { warmth: 0, contrast: 0, saturation: 0, brightness: 0, vignette: 0 },
    caption: { size: 0.0525, stroke: 0.08, shadow: true, maxCharsPerLine: 22, intro: "miniZoom" },
    slots: { "9:16": slots, "16:9": { caption: { x: 0.5, y: 0.86 }, title: { x: 0.5, y: 0.22 }, center: { x: 0.5, y: 0.5 } } },
    lint: { "9:16": { minDurationMs: 0, maxDurationMs: 90000 }, "16:9": { minDurationMs: 0, maxDurationMs: 1200000 } },
  };
}
```

`packages/render/src/analysis.ts`:
```ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./project-io";
import type { Take } from "./takes";

export const CHEAP_STEPS = ["edit", "proxy", "transcript", "silences"];
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function analysisPython(): string {
  if (process.env.ADAM_ANALYSIS_PYTHON) return process.env.ADAM_ANALYSIS_PYTHON;
  for (const p of [join(REPO, "py/analysis/.venv/Scripts/python.exe"), join(REPO, "py/analysis/.venv/bin/python")]) if (existsSync(p)) return p;
  throw new CliError("The analysis environment is missing. Create it (see README, Analysis):\n  python -m venv py/analysis/.venv\n  ...");
}

export function analysisArgs(projectDir: string, videos: Record<string, string>, steps: string[], opts: { fps: number; lang?: string; force?: boolean }): string[] {
  return [
    "-m", "adam_analysis", "run", projectDir,
    ...Object.entries(videos).flatMap(([id, path]) => ["--video", `${id}=${path}`]),
    "--steps", steps.join(","), "--fps", String(opts.fps),
    ...(opts.lang ? ["--lang", opts.lang] : []),
    ...(opts.force ? ["--force"] : []),
  ];
}

export function runAnalysis(projectDir: string, videos: Record<string, string>, steps: string[], opts: { fps: number; lang?: string; force?: boolean }): void {
  if (Object.keys(videos).length === 0 || steps.length === 0) return;
  const r = spawnSync(analysisPython(), analysisArgs(projectDir, videos, steps, opts), { stdio: "inherit" });
  if (r.status !== 0) throw new CliError("The analysis failed: see the message above.");
}

export function readTake(projectDir: string, id: string, path: string): Take {
  const cache = join(projectDir, "cache", id);
  const probe = JSON.parse(readFileSync(join(cache, "probe.json"), "utf8"));
  const transcript = JSON.parse(readFileSync(join(cache, "transcript.json"), "utf8"));
  return {
    path,
    probe: { durationMs: probe.durationMs, width: probe.width, height: probe.height, hasAudio: probe.sourceHasAudio ?? probe.hasAudio },
    transcript: { lang: transcript.lang, words: transcript.words },
  };
}
```

`packages/render/src/commands/new.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import { parseProject, type ProjectInput } from "@adam-studio/model";
import { CHEAP_STEPS, readTake, runAnalysis } from "../analysis";
import { CliError, formatErrors, loadProject } from "../project-io";
import { addTakes, defaultStyle, findSystemFont, nextAssetIds } from "../takes";

type Opts = { lang?: string; format?: string; style?: string; name?: string };

/** Analyzes the videos not yet in the project (cheap steps), merges them, validates and writes project.json. */
function analyzeAndAdd(dir: string, project: ProjectInput, videos: string[], opts: Opts): ProjectInput {
  const paths = videos.map((v) => resolvePath(v));
  for (const p of paths) if (!existsSync(p)) throw new CliError(`video not found: ${p}`);
  const known = new Set((project.assets ?? []).map((a) => a.path));
  for (const p of paths) if (known.has(p)) console.log(`already in the project, skipped: ${p}`);
  const fresh = [...new Set(paths.filter((p) => !known.has(p)))];
  const ids = nextAssetIds((project.assets ?? []).map((a) => a.id), fresh.length);
  runAnalysis(dir, Object.fromEntries(fresh.map((p, i) => [ids[i]!, p])), CHEAP_STEPS, { fps: project.canvas.fps, lang: opts.lang });
  const next = addTakes(project, fresh.map((p, i) => readTake(dir, ids[i]!, p)));
  const parsed = parseProject(next);
  if (!parsed.ok) throw new CliError(formatErrors("project.json", parsed.errors));
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function newCommand(dir: string, videos: string[], opts: Opts): void {
  if (videos.length === 0) throw new CliError("adam new needs at least one video");
  if (existsSync(join(dir, "project.json"))) throw new CliError(`${dir} already has a project.json: use adam add`);
  const format = opts.format ?? "9:16";
  if (format !== "9:16" && format !== "16:9") throw new CliError(`--format must be 9:16 or 16:9, got "${format}"`);
  mkdirSync(dir, { recursive: true });
  const style = opts.style ? JSON.parse(readFileSync(resolvePath(opts.style), "utf8")) : defaultStyle(findSystemFont());
  writeFileSync(join(dir, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  const project: ProjectInput = { version: 1, name: opts.name ?? basename(dir), canvas: { format, fps: 30 }, style: "style.json", assets: [], story: [] };
  const done = analyzeAndAdd(dir, project, videos, opts);
  console.log(`${dir}: ${done.assets!.length} takes, ${Object.values(done.transcript!.words!).flat().length} words`);
}

export function addCommand(dir: string, videos: string[], opts: Opts): void {
  if (videos.length === 0) throw new CliError("adam add needs at least one video");
  const { project } = loadProject(dir);
  const done = analyzeAndAdd(dir, project, videos, opts);
  console.log(`${dir}: ${done.assets!.length} takes`);
}
```

In `packages/render/src/cli.ts`: add the import `import { addCommand, newCommand } from "./commands/new";`; add to the `USAGE` lines:
```
  new <dir> <videos...> [--lang fr] [--format 9:16|16:9] [--style style.json] [--name name]
  add <dir> <videos...> [--lang fr]
```
add the options `lang: { type: "string" }, format: { type: "string" }, style: { type: "string" }, name: { type: "string" }, assets: { type: "string" }, steps: { type: "string" }, "no-analyze": { type: "boolean" }` to `parseArgs` (keep `step` for review), and these cases before `default:`:
```ts
    case "new":
      newCommand(dir, rest.map((v) => resolve(base, v)), { lang: values.lang, format: values.format, style: values.style ? resolve(base, values.style) : undefined, name: values.name });
      return;
    case "add":
      addCommand(dir, rest.map((v) => resolve(base, v)), { lang: values.lang });
      return;
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -w @adam-studio/render` then `npm run typecheck -w @adam-studio/render`
Expected: all PASS (68 + 7 = 75); typecheck exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): adam new, add and analyze with the analysis package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Heavy steps on demand

**Files:**
- Modify: `packages/render/src/media.ts`, `packages/render/src/analysis.ts`, `packages/render/src/commands/render.ts`, `packages/render/src/commands/review.ts`, `packages/render/src/commands/studio.ts`, `packages/render/src/commands/capcut.ts`, `packages/render/src/cli.ts`
- Test: `packages/render/tests/unit/on-demand.test.ts`

**Interfaces:**
- Produces: `analyzeCommand(dir, opts)` in `commands/new.ts` and the CLI `adam analyze <dir> [--assets c01,c02] [--steps subject,plate] [--force]`; `missingAnalysis(projectDir, project, timeline): { asset: string; step: "edit" | "subject" | "plate" }[]` in `media.ts`; `ensureAnalysis(projectDir, project, timeline, opts: { analyze: boolean; run?: typeof runAnalysis })` in `analysis.ts` (runs exactly the missing pairs, edit first; with `analyze: false` throws a `CliError` naming the command to run). `render`, `review`, `studio`, `capcut-prep` take `analyze` (default true; `--no-analyze` sets false) and call `ensureAnalysis` before `lintGate`.

- [ ] **Step 1: Write the failing test**

`packages/render/tests/unit/on-demand.test.ts`:
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { ensureAnalysis } from "../../src/analysis";
import { missingAnalysis } from "../../src/media";
import { CliError } from "../../src/project-io";
import { projectInput, styleInput } from "./helpers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adam on demand-"));
  mkdirSync(join(dir, "cache", "s"), { recursive: true });
  writeFileSync(join(dir, "cache", "s", "edit.mp4"), "x");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function load() {
  const p = parseProject(projectInput());
  const s = parseStyle(styleInput);
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, timeline: resolve(p.value, s.value) };
}

describe("missingAnalysis", () => {
  it("lists the cut-out and the plate the edit needs and the cache lacks", () => {
    const { project, timeline } = load();
    expect(missingAnalysis(dir, project, timeline)).toEqual([{ asset: "s", step: "subject" }, { asset: "s", step: "plate" }]);
    writeFileSync(join(dir, "cache", "s", "subject.webm"), "x");
    writeFileSync(join(dir, "cache", "s", "plate.png"), "x");
    expect(missingAnalysis(dir, project, timeline)).toEqual([]);
  });
});

describe("ensureAnalysis", () => {
  it("runs exactly the missing steps for the assets that need them", () => {
    const { project, timeline } = load();
    const calls: [Record<string, string>, string[]][] = [];
    ensureAnalysis(dir, project, timeline, { analyze: true, run: (_d, videos, steps) => calls.push([videos, steps]) });
    expect(calls).toEqual([[{ s: "cache/s/edit.mp4" }, ["subject"]], [{ s: "cache/s/edit.mp4" }, ["plate"]]]);
  });
  it("refuses with the command to run when analysis is turned off", () => {
    const { project, timeline } = load();
    expect(() => ensureAnalysis(dir, project, timeline, { analyze: false })).toThrow(CliError);
    expect(() => ensureAnalysis(dir, project, timeline, { analyze: false })).toThrow("adam analyze");
  });
});
```

(The synthetic project's asset `s` has path `cache/s/edit.mp4`; `ensureAnalysis` passes each asset's own path.)

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @adam-studio/render`
Expected: FAIL on `missingAnalysis is not a function` / `ensureAnalysis is not a function`.

- [ ] **Step 3: Implement**

In `packages/render/src/media.ts`, add:
```ts
/** Cache files the timeline needs that the analysis has not produced yet (edit for every clip asset, cut-out and plate where used). */
export function missingAnalysis(projectDir: string, project: Project, timeline: Timeline): { asset: string; step: "edit" | "subject" | "plate" }[] {
  const has = (asset: string, file: string) => existsSync(join(projectDir, "cache", asset, file));
  const out: { asset: string; step: "edit" | "subject" | "plate" }[] = [];
  const videos = new Set<string>();
  for (const c of timeline.clips) {
    videos.add(c.asset);
    if (c.framing.mode === "split") videos.add(c.framing.asset);
  }
  for (const id of videos) if (!has(id, "edit.mp4")) out.push({ asset: id, step: "edit" });
  for (const id of new Set(subjectWindows(timeline).map((w) => w.asset))) if (!has(id, "subject.webm")) out.push({ asset: id, step: "subject" });
  const clipAsset = new Map(timeline.clips.map((c) => [c.id, c.asset]));
  for (const id of new Set(slideWindows(timeline).map((w) => clipAsset.get(w.clipId)!))) if (!has(id, "plate.png")) out.push({ asset: id, step: "plate" });
  void project;
  return out;
}
```

In `packages/render/src/analysis.ts`, add (with `import type { Project, Timeline } from "@adam-studio/model";` and `import { missingAnalysis } from "./media";`):
```ts
/** Runs the analysis the timeline still needs, or refuses with the command when analysis is off. */
export function ensureAnalysis(projectDir: string, project: Project, timeline: Timeline,
  opts: { analyze: boolean; run?: (dir: string, videos: Record<string, string>, steps: string[], o: { fps: number }) => void }): void {
  const missing = missingAnalysis(projectDir, project, timeline);
  if (missing.length === 0) return;
  if (!opts.analyze) {
    const list = missing.map((m) => `${m.asset} ${m.step}`).join(", ");
    throw new CliError(`The cache lacks: ${list}. Run: npm run adam -- analyze ${projectDir}`);
  }
  const run = opts.run ?? runAnalysis;
  const paths = new Map(project.assets.map((a) => [a.id, a.path]));
  for (const step of ["edit", "subject", "plate"] as const) {
    const ids = missing.filter((m) => m.step === step).map((m) => m.asset);
    if (ids.length) run(projectDir, Object.fromEntries(ids.map((id) => [id, paths.get(id)!])), [step], { fps: project.canvas.fps });
  }
}
```

In each of `commands/render.ts`, `commands/capcut.ts`, `commands/review.ts` and `commands/studio.ts`: add `analyze?: boolean` to the options (default true) and call, right after the timeline is resolved and before `lintGate` (review: once per variant timeline, before planning; studio: before planMedia):
```ts
  ensureAnalysis(dir, project, timeline, { analyze: opts.analyze ?? true });
```
(importing `ensureAnalysis` from `../analysis`). `studioCommand(projectDir)` becomes `studioCommand(projectDir, opts: { analyze?: boolean } = {})`.

Append to `packages/render/src/commands/new.ts` (add `resolve` to its model import and `import { missingAnalysis } from "../media";`):
```ts
/** Runs the analysis for what the timeline needs, or for the asked assets and steps. */
export function analyzeCommand(dir: string, opts: { assets?: string; steps?: string; force?: boolean; lang?: string }): void {
  const { project, style } = loadProject(dir);
  const videos = Object.fromEntries(project.assets.filter((a) => a.kind === "video").map((a) => [a.id, a.path]));
  const wanted = opts.assets ? opts.assets.split(",") : Object.keys(videos);
  for (const id of wanted) if (!videos[id]) throw new CliError(`no video asset "${id}" in the project`);
  if (opts.steps) {
    runAnalysis(dir, Object.fromEntries(wanted.map((id) => [id, videos[id]!])), opts.steps.split(","), { fps: project.canvas.fps, lang: opts.lang, force: opts.force });
    return;
  }
  const missing = missingAnalysis(dir, project, resolve(project, style)).filter((m) => wanted.includes(m.asset));
  for (const step of ["edit", "subject", "plate"] as const) {
    const ids = missing.filter((m) => m.step === step).map((m) => m.asset);
    if (ids.length) runAnalysis(dir, Object.fromEntries(ids.map((id) => [id, videos[id]!])), [step], { fps: project.canvas.fps, force: opts.force });
  }
  if (missing.length === 0) console.log("Nothing to analyze: the cache has what the edit needs.");
}
```

In `packages/render/src/cli.ts`, import `analyzeCommand` from `./commands/new`, add the usage line `  analyze <dir> [--assets c01,c02] [--steps subject,plate] [--force]` and this case before `default:`:
```ts
    case "analyze":
      analyzeCommand(dir, { assets: values.assets, steps: values.steps, force: values.force ?? false, lang: values.lang });
      return;
```
Then pass `analyze: !values["no-analyze"]` to `renderCommand`, `reviewCommand`, `studioCommand` and `capcutPrepCommand`, and add ` [--no-analyze]` to their usage lines.

- [ ] **Step 4: Run the tests, the typecheck and the end-to-end suite**

Run: `npm test -w @adam-studio/render`, `npm run typecheck -w @adam-studio/render`, `npm run test:e2e -w @adam-studio/render`
Expected: 78 unit tests PASS; typecheck exit code 0; 14 end-to-end tests PASS (their synthetic projects have every cache file, so no analysis runs).

- [ ] **Step 5: Commit**

```bash
git add packages/render
git commit -m "feat(render): run the cut-out and plate analysis on demand before render, review, studio and CapCut export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End to end, docs and the 1015 spike

**Files:**
- Create: `packages/render/tests/e2e/new.test.ts`
- Modify: `README.md`, `spikes/acceptance-1015/README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the end-to-end test**

`packages/render/tests/e2e/new.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCommand, newCommand } from "../../src/commands/new";
import { renderCommand } from "../../src/commands/render";
import { analysisPython } from "../../src/analysis";

const hasAnalysis = (() => { try { analysisPython(); return true; } catch { return false; } })();

function rush(path: string, color: string) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=540x960:r=30:d=2`, "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", path]);
}

describe.skipIf(!hasAnalysis)("adam new and add", () => {
  it("turns rushes into a project the renderer accepts", async () => {
    const root = mkdtempSync(join(tmpdir(), "adam new-"));
    const dir = join(root, "projet démo");
    rush(join(root, "take a.mp4"), "red");
    rush(join(root, "take b.mp4"), "blue");
    newCommand(dir, [join(root, "take a.mp4")], { lang: "fr" });
    addCommand(dir, [join(root, "take b.mp4"), join(root, "take a.mp4")], { lang: "fr" });
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    expect(project.assets.map((a: { id: string }) => a.id)).toEqual(["c01", "c02"]);
    expect(project.story).toHaveLength(2);
    for (const f of ["edit.mp4", "proxy.mp4", "probe.json", "transcript.json", "silences.json", "manifest.json"]) {
      expect(existsSync(join(dir, "cache", "c02", f)), f).toBe(true);
    }
    const out = await renderCommand(dir, { force: false });
    expect(existsSync(out)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -w @adam-studio/render`
Expected: 15 end-to-end tests PASS (the new one runs Whisper on two 2 s takes: about a minute).

- [ ] **Step 3: Document**

In `README.md`, under Packages add:
```markdown
- `py/analysis`: the analysis pipeline (`python -m adam_analysis run`), called by `npm run adam -- new | add | analyze`.
```
and add a section after Development:
````markdown
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
````

In `spikes/acceptance-1015/README.md`, add after the first paragraph:
```markdown
Superseded for new projects by `npm run adam -- new` (sub-project 2); kept as the record of the 1015 acceptance.
```

- [ ] **Step 4: Run every suite and commit**

Run: `npm test`, `npm run typecheck`, `npm run test:e2e -w @adam-studio/render`, `py/analysis/.venv/Scripts/python -m pytest py/analysis -q`, `py/capcut/.venv/Scripts/python -m pytest py/capcut -q`
Expected: all PASS.

```bash
git add packages/render README.md spikes/acceptance-1015/README.md
git commit -m "test(analysis): adam new and add end to end; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
