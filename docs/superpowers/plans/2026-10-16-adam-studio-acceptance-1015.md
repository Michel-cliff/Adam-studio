# Adam Studio 1015 Acceptance Implementation Plan (sub-project 1, plan 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe the creator's "1015" video as an Adam Studio project, render it to MP4 and export it to CapCut, and compare it with the lab's "1015 edit v2".

**Architecture:** One-off acceptance scripts in `spikes/acceptance-1015/`, adapted from the ClaudeCapcut lab (spec section 9: "produced once by adapting the lab scripts"): `build_cache.py` makes the analysis cache (edit.mp4, subject.webm with RobustVideoMatting, ungraded plate.png) and `check_cache.py` holds it to the cache contract; `convert.py` turns the lab's manifest, Whisper transcript and `plan_v2.json` into `project.json` and `style.json` (word-anchored captions, title, behind-subject words, HUD images, sound effects), written by `make_project.py`; `compare.py` builds a side-by-side sheet against the lab's baked v2 shots. The project lives in `C:\Users\miche\AdamStudioProjects\1015` (outside the repo); rendering and export use the existing `npm run adam -- render` and `python -m adam_capcut export`. A small renderer and exporter fix comes first: title lines use the text color, boxed lines ink on the accent box (as in v2).

**Tech Stack:** Python 3.12 (system and the lab's `.tools` venv with torch, cv2, simple-lama-inpainting), ffmpeg/ffprobe, the existing `packages/render` (Remotion) and `py/capcut`.

**Spec:** `docs/superpowers/specs/2026-10-16-adam-studio-core-design.md` (sections 4, 7, 9, 12).

## Global Constraints

- No footage, transcript text or third-party asset is committed: the scripts read the lab (`--lab`, default `~/ClaudeCapcut/work`) and write the project (`--project`, default `~/AdamStudioProjects/1015`). Tests use small invented data; the one test reading the real lab only checks counts and skips when the lab is absent.
- Cache contract (spec section 9): `cache/<assetId>/edit.mp4` (H.264 1080x1920, 30 fps, audio, a keyframe every second, no B-frames), `subject.webm` (VP9 alpha, same timing and size, a keyframe every second), `plate.png` (1080x1920, the room without the person, ungraded: the renderer grades it).
- `build_cache.py` runs with the lab's `.tools` venv: `C:\Users\miche\ClaudeCapcut\.tools\Scripts\python.exe`, torch with 6 threads (lab measurement). Other scripts and tests run with `py/capcut/.venv/Scripts/python`.
- Asset ids: takes `c01`..`c08`, HUD images `hud_<name>`, sounds `sfx_<name>`; word ids `c01.w0`; story clip ids `k01`..`k13` (the lab's keeps, in order).
- The lab's v2 choices are kept: alternating punch-in (1.0, 1.08) with a 0.004/s drift, person-only slides of 540 ms where the lab baked a slide, captions in English anchored on the French words they cover, title "ÉPISODE 01" in two phases, 4 behind-subject words, 25 HUD images with their sounds, the hook and transition sounds.
- Docs and messages use no em dash characters. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A caption whose time range falls in a pause (no word inside it): anchored on the words it overlaps, or reported as skipped, never a crash (Task 4 `captions_from_plan` tests).
- An overlay placed at a source moment that was cut, or whose nearest word was cut: an explicit error for a cut moment, an output-time anchor when the word is gone (Task 4 `anchor_at` tests).
- A cache file that breaks the GOP rule or lost its alpha: `check_cache.py` names the file and the rule (Task 2 tests).
- A Whisper word that ends before it starts: clamped so `endMs >= startMs`, the model's word rule, instead of a schema error on the whole project (Task 4 words test).
- The lab's sound starting 0.8 s into its file (`src_start`): a trimmed copy in the project, since sfx elements have no source offset (Task 4 `sound_elements` test, Task 5 trimming).

---

### Task 1: Title lines in the text color, boxed lines in ink

**Files:**
- Modify: `packages/render/src/lib/text.ts`, `packages/render/src/components/Title.tsx`, `py/capcut/adam_capcut/titles.py`
- Test: `packages/render/tests/unit/text.test.ts`, `py/capcut/tests/test_titles.py`

**Interfaces:**
- Produces: `titleLineColor(box, style)` in `lib/text.ts`; Python `title_texts` returns `"color": "text"` for plain lines and `"ink"` for boxed lines.

- [ ] **Step 1: Write the failing tests**

In `packages/render/tests/unit/text.test.ts`, add `titleLineColor` to the import from `../../src/lib/text` and append:
```ts
describe("titleLineColor", () => {
  const style = { colors: { text: "#FFFFFF", highlight: "#FFD100", accent: "#FF6B35", ink: "#0E0C0A" } };
  it("draws plain title lines in the text color and boxed lines in ink on the accent box", () => {
    expect(titleLineColor(false, style)).toBe("#FFFFFF");
    expect(titleLineColor(true, style)).toBe("#0E0C0A");
  });
});
```

In `py/capcut/tests/test_titles.py`, replace the expected rows of `test_title_lines_are_stacked_like_the_renderer_and_start_with_their_reveal`:
```python
        ("line", "QUI VEUT", 92, 102, False, "ink"),
        ("line", "M'EMBAUCHER ?", 97, 102, True, "ink"),
        ("line", "PERSONNE", 104, 114, False, "ink"),
```
with:
```python
        ("line", "QUI VEUT", 92, 102, False, "text"),
        ("line", "M'EMBAUCHER ?", 97, 102, True, "ink"),
        ("line", "PERSONNE", 104, 114, False, "text"),
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @adam-studio/render` then `py/capcut/.venv/Scripts/python -m pytest py/capcut -q`
Expected: the vitest run FAILS on `titleLineColor is not a function`; pytest FAILS on the title rows (`'ink' != 'text'`).

- [ ] **Step 3: Implement**

In `packages/render/src/lib/text.ts`, add after `colorOf`:
```ts
/** Title lines are drawn in the text color; boxed lines in ink on the accent box (the lab's v2 title). */
export function titleLineColor(box: boolean, style: Pick<Style, "colors">): string {
  return box ? style.colors.ink : style.colors.text;
}
```
In `packages/render/src/components/Title.tsx`, change the import from `../lib/text` to:
```ts
import { exitOpacity, fitFontSize, glitchAmount, lineReveal, titleLineColor } from "../lib/text";
```
and replace `color: style.colors.ink,` with `color: titleLineColor(line.box, style),`.

In `py/capcut/adam_capcut/titles.py`, replace `"color": "ink", "intro": REVEAL_MS,` with `"color": "ink" if line.get("box", False) else "text", "intro": REVEAL_MS,`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @adam-studio/render`, `npm run typecheck -w @adam-studio/render`, `py/capcut/.venv/Scripts/python -m pytest py/capcut -q`
Expected: 69 vitest tests PASS, typecheck exit code 0, 45 pytest tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/render py/capcut
git commit -m "fix(render,capcut): title lines in the text color, boxed lines in ink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cache contract checker

**Files:**
- Create: `spikes/acceptance-1015/check_cache.py`, `spikes/acceptance-1015/tests/conftest.py`
- Test: `spikes/acceptance-1015/tests/test_check_cache.py`

**Interfaces:**
- Produces: `max_keyframe_gap(path) -> float` (seconds), `check_asset(cache_dir, duration_ms, fps=30) -> list[str]` (problems, empty when the asset meets the contract), CLI `python spikes/acceptance-1015/check_cache.py [--project DIR]` (exit 1 when a video asset has problems).

- [ ] **Step 1: Write the failing test**

`spikes/acceptance-1015/tests/conftest.py`:
```python
import sys
from pathlib import Path

# The acceptance scripts are plain modules next to this folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

`spikes/acceptance-1015/tests/test_check_cache.py`:
```python
import subprocess

import pytest

from check_cache import check_asset, max_keyframe_gap

SIZE = "1080x1920"


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="module")
def good(tmp_path_factory):
    d = tmp_path_factory.mktemp("good")
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", str(d / "edit.mp4"))
    ffmpeg("-f", "lavfi", "-i", f"color=c=black:s={SIZE}:r=30:d=3", "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(lt(X,540),255,0)'",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", "30", "-auto-alt-ref", "0", "-deadline", "realtime", "-cpu-used", "8",
           str(d / "subject.webm"))
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}", "-frames:v", "1", str(d / "plate.png"))
    return d


def test_an_asset_meeting_the_contract_has_no_problem(good):
    assert max_keyframe_gap(good / "edit.mp4") == pytest.approx(1.0, abs=0.05)
    assert check_asset(good, 3000) == []


def test_names_each_broken_rule(good, tmp_path):
    for f in ("subject.webm",):
        (tmp_path / f).write_bytes((good / f).read_bytes())
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}:r=30:d=3", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
           str(tmp_path / "edit.mp4"))
    problems = check_asset(tmp_path, 3000)
    assert "plate.png is missing" in problems
    assert problems == ["plate.png is missing"]  # missing files are reported first, alone
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}", "-frames:v", "1", str(tmp_path / "plate.png"))
    problems = check_asset(tmp_path, 3000)
    assert "edit.mp4 has B-frames" in problems
    assert "edit.mp4 has no audio" in problems
    assert any(p.startswith("edit.mp4 has") and "between keyframes" in p for p in problems)


def test_a_matte_without_alpha_is_reported(good, tmp_path):
    for f in ("edit.mp4", "plate.png"):
        (tmp_path / f).write_bytes((good / f).read_bytes())
    ffmpeg("-f", "lavfi", "-i", f"color=c=black:s={SIZE}:r=30:d=3", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-g", "30",
           "-deadline", "realtime", "-cpu-used", "8", str(tmp_path / "subject.webm"))
    assert check_asset(tmp_path, 3000) == ["subject.webm has no alpha channel"]
```

- [ ] **Step 2: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'check_cache'`.

- [ ] **Step 3: Implement**

`spikes/acceptance-1015/check_cache.py`:
```python
"""Checks a project's analysis cache against the cache contract (spec section 9).

Usage: python spikes/acceptance-1015/check_cache.py [--project DIR]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

W, H = 1080, 1920


def ffprobe_json(path: Path, *args: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", *args, "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


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


def check_asset(cache: Path, duration_ms: int, fps: int = 30) -> list[str]:
    edit, subject, plate = cache / "edit.mp4", cache / "subject.webm", cache / "plate.png"
    missing = [f"{f.name} is missing" for f in (edit, subject, plate) if not f.is_file()]
    if missing:
        return missing
    problems = []
    v = video_stream(edit)
    if (v["codec_name"], v["width"], v["height"]) != ("h264", W, H):
        problems.append(f"edit.mp4 is {v['codec_name']} {v['width']}x{v['height']}, expected h264 {W}x{H}")
    if int(v.get("has_b_frames", 0)) != 0:
        problems.append("edit.mp4 has B-frames")
    if not ffprobe_json(edit, "-select_streams", "a", "-show_entries", "stream=codec_type")["streams"]:
        problems.append("edit.mp4 has no audio")
    lasts = float(ffprobe_json(edit, "-show_entries", "format=duration")["format"]["duration"]) * 1000
    if abs(lasts - duration_ms) > 100:
        problems.append(f"edit.mp4 lasts {lasts:.0f} ms, the source {duration_ms} ms")
    limit = 1 + 1.5 / fps
    for f in (edit, subject):
        gap = max_keyframe_gap(f)
        if gap > limit:
            problems.append(f"{f.name} has {gap:.2f} s between keyframes (GOP rule: 1 s)")
    s = video_stream(subject)
    if (s["codec_name"], s["width"], s["height"]) != ("vp9", W, H):
        problems.append(f"subject.webm is {s['codec_name']} {s['width']}x{s['height']}, expected vp9 {W}x{H}")
    tags = {k.lower(): v for k, v in s.get("tags", {}).items()}
    if tags.get("alpha_mode") != "1":
        problems.append("subject.webm has no alpha channel")
    p = video_stream(plate)
    if (p["width"], p["height"]) != (W, H):
        problems.append(f"plate.png is {p['width']}x{p['height']}, expected {W}x{H}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(Path.home() / "AdamStudioProjects" / "1015"))
    args = parser.parse_args()
    project = Path(args.project)
    data = json.loads((project / "project.json").read_text(encoding="utf-8"))
    bad = 0
    for a in data["assets"]:
        if a["kind"] != "video":
            continue
        problems = check_asset(project / "cache" / a["id"], a["meta"]["durationMs"], data["canvas"]["fps"])
        print(f"{a['id']}: {'ok' if not problems else '; '.join(problems)}")
        bad += bool(problems)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/acceptance-1015
git commit -m "test(acceptance): cache contract checker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The 1015 analysis cache

**Files:**
- Create: `spikes/acceptance-1015/build_cache.py`

**Interfaces:**
- Consumes: `check_asset` (Task 2) to verify the result.
- Produces: `C:\Users\miche\AdamStudioProjects\1015\cache\c01..c08\{edit.mp4, subject.webm, plate.png}`; the CLI `C:\Users\miche\ClaudeCapcut\.tools\Scripts\python.exe spikes/acceptance-1015/build_cache.py [--project DIR] [--lab DIR] [--force]`.

- [ ] **Step 1: Write the builder**

`spikes/acceptance-1015/build_cache.py`:
```python
"""Builds the analysis cache of the 1015 project (spec section 9), adapting the lab's compose.py.

For each lab clip: edit.mp4 (1080x1920, 30 fps, a keyframe every second, no B-frames, audio), subject.webm
(the person cut out with RobustVideoMatting, VP9 alpha, same timing and size) and plate.png (the room without
the person, from ungraded frames: the renderer grades it). Finished files are skipped unless --force.

Run with the lab's .tools venv (torch, cv2, simple-lama-inpainting):
  C:\\Users\\miche\\ClaudeCapcut\\.tools\\Scripts\\python.exe spikes/acceptance-1015/build_cache.py
"""
import argparse
import json
import subprocess
import sys
import time
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

W, H, FPS = 1080, 1920, 30
torch.set_num_threads(6)  # lab measurement: 6 threads about 5x faster than 12 on this CPU (oversubscription)


def make_edit(src: Path, dst: Path) -> None:
    """The take at canvas size, following the GOP rule. No -shortest: the video keeps its last partial frame."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", f"scale={W}:{H}:flags=lanczos", "-r", str(FPS),
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-g", str(FPS), "-bf", "0", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", str(dst)],
        check=True,
    )


def frames(src: Path):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = W * H * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    p.stdout.close()
    p.wait()


_rvm = None


def rvm():
    global _rvm
    if _rvm is None:
        _rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "mobilenetv3", trust_repo=True).eval()
    return _rvm


class Matter:
    """Stateful matting (RVM is recurrent: feed consecutive frames) at reduced size, upsampled (lab: compose.py)."""

    def __init__(self, res=(540, 960), ratio=0.375):
        self.rec = [None] * 4
        self.res, self.ratio = res, ratio

    @torch.inference_mode()
    def __call__(self, rgb):
        small = cv2.resize(rgb, self.res, interpolation=cv2.INTER_AREA)
        src = torch.from_numpy(small).permute(2, 0, 1).float().unsqueeze(0) / 255.0
        _, pha, *self.rec = rvm()(src, *self.rec, downsample_ratio=self.ratio)
        return cv2.resize(pha[0, 0].numpy(), (W, H), interpolation=cv2.INTER_LINEAR)


def make_subject(edit: Path, dst: Path) -> int:
    """The take with the matte as alpha, VP9 with a keyframe every second."""
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", str(FPS), "-auto-alt-ref", "0",
         "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", str(dst)],
        stdin=subprocess.PIPE,
    )
    matter, n = Matter(), 0
    for f in frames(edit):
        alpha = (np.clip(matter(f), 0, 1) * 255).astype(np.uint8)
        enc.stdin.write(np.dstack([f, alpha]).tobytes())
        n += 1
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed writing {dst}")
    return n


def make_plate(edit: Path, dst: Path) -> None:
    """The room without the person: per-pixel median of unoccluded samples, LaMa for the never-seen part (lab: compose.py
    clean_plate, here on ungraded frames)."""
    matter = Matter(res=(270, 480), ratio=1.0)  # coarse matte is enough: it gets dilated anyway
    samples, masks = [], []
    for i, f in enumerate(frames(edit)):
        if i % 3:
            continue
        a = matter(f)
        if i % 6 == 0 and i > 8:  # let the recurrent matte settle first
            samples.append(f)
            masks.append(cv2.dilate((a > 0.03).astype(np.uint8), np.ones((31, 31), np.uint8)))
    stack = np.stack(samples)
    occluded = np.stack(masks).astype(bool)
    med = np.zeros((H, W, 3), np.float32)
    for r0 in range(0, H, 96):  # median in strips: float copies stay around 100 MB
        s = stack[:, r0:r0 + 96].astype(np.float32)
        s[occluded[:, r0:r0 + 96]] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med[r0:r0 + 96] = np.nanmedian(s, axis=0)
    hole = np.isnan(med[..., 0])
    med = np.nan_to_num(med).astype(np.uint8)
    from simple_lama_inpainting import SimpleLama

    hole_mask = cv2.dilate(hole.astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
    filled = np.array(SimpleLama()(Image.fromarray(med), Image.fromarray(hole_mask).convert("L")).convert("RGB"))[:H, :W]
    Image.fromarray(np.where(hole_mask[..., None] > 0, filled, med)).save(dst)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(Path.home() / "AdamStudioProjects" / "1015"))
    parser.add_argument("--lab", default=str(Path.home() / "ClaudeCapcut" / "work"))
    parser.add_argument("--force", action="store_true", help="rebuild files that already exist")
    args = parser.parse_args()
    manifest = json.loads((Path(args.lab) / "1015" / "manifest.json").read_text(encoding="utf-8"))
    for clip in manifest:
        cache = Path(args.project) / "cache" / f"c{clip['i']:02d}"
        cache.mkdir(parents=True, exist_ok=True)
        steps = (("edit.mp4", lambda d: make_edit(Path(clip["file"]), d)),
                 ("subject.webm", lambda d: make_subject(cache / "edit.mp4", d)),
                 ("plate.png", lambda d: make_plate(cache / "edit.mp4", d)))
        for name, make in steps:
            dst = cache / name
            if dst.exists() and not args.force:
                print(f"{cache.name}/{name}: kept")
                continue
            t0 = time.time()
            tmp = dst.with_name("tmp-" + name)
            make(tmp)
            tmp.replace(dst)  # a file only exists once complete: an interrupted run resumes cleanly
            print(f"{cache.name}/{name}: {time.time() - t0:.0f} s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Build the cache**

Run: `C:/Users/miche/ClaudeCapcut/.tools/Scripts/python.exe spikes/acceptance-1015/build_cache.py` (in the background; about 20 to 40 minutes on CPU)
Expected: 24 lines `cNN/<file>: <seconds> s`, exit code 0.

- [ ] **Step 3: Check the cache against the contract**

`check_cache.py` reads `project.json`, which Task 5 writes. Until then, check each asset of the manifest directly:
```bash
py/capcut/.venv/Scripts/python - <<'EOF'
import json, sys
from pathlib import Path
sys.path.insert(0, "spikes/acceptance-1015")
from check_cache import check_asset
for c in json.loads((Path.home() / "ClaudeCapcut/work/1015/manifest.json").read_text(encoding="utf-8")):
    print(f"c{c['i']:02d}", check_asset(Path.home() / "AdamStudioProjects/1015/cache" / f"c{c['i']:02d}", round(c["dur"] * 1000)))
EOF
```
Expected: 8 lines, each ending with `[]`.

- [ ] **Step 4: Look at the mattes and plates**

Run (the libvpx decoder is forced before the matte input, since ffmpeg's native VP9 decoder drops alpha):
```bash
mkdir -p C:/Users/miche/AdamStudioProjects/1015/renders
ffmpeg -v error -y -f lavfi -i color=c=magenta:s=1080x1920 -c:v libvpx-vp9 -ss 2 -i C:/Users/miche/AdamStudioProjects/1015/cache/c02/subject.webm \
  -i C:/Users/miche/AdamStudioProjects/1015/cache/c02/plate.png \
  -filter_complex "[0][1]overlay=format=auto:shortest=1,scale=360:-2[a];[2]scale=360:-2[b];[a][b]hstack" -frames:v 1 \
  C:/Users/miche/AdamStudioProjects/1015/renders/matte_check.jpg
```
Expected: `matte_check.jpg` shows the creator cut out over magenta (left) and the room without him (right). Open it: no person left in the plate, no room left around the person.

- [ ] **Step 5: Commit**

```bash
git add spikes/acceptance-1015/build_cache.py
git commit -m "feat(acceptance): build the 1015 analysis cache from the lab clips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: From the lab's v2 plan to an Adam Studio project

**Files:**
- Create: `spikes/acceptance-1015/convert.py`
- Test: `spikes/acceptance-1015/tests/test_convert.py`

**Interfaces:**
- Produces (all pure): `asset_id(clip) -> "cNN"`, `words_from_transcript(transcript) -> {assetId: [word]}`, `story_from_keeps(keeps, look) -> [clip]`, `output_starts(story) -> [ms]`, `anchor_at(words, story, asset, ms) -> anchor`, `captions_from_plan(captions, words) -> (captions, skipped)`, `title_element(baked)`, `behind_words(baked)`, `trimmed_name(name, src_start)`, `overlay_elements(overlays, words, story, durations)`, `sound_elements(sfx, keeps, story, durations)`, `sfx_used(plan) -> {name: (file, src_start)}`, `style_1015(font)`, `build_project(manifest, transcript, plan, durations, hud_dir, sfx_dir, trimmed_dir) -> (project, skipped)`.

- [ ] **Step 1: Write the failing test**

`spikes/acceptance-1015/tests/test_convert.py`:
```python
import json
from pathlib import Path

import pytest

from convert import (
    anchor_at, behind_words, build_project, captions_from_plan, output_starts, overlay_elements, sfx_used, sound_elements,
    story_from_keeps, style_1015, title_element, trimmed_name, words_from_transcript,
)

TRANSCRIPT = [
    {"clip": 1, "words": [{"w": " A", "start": 0.4, "end": 0.68}, {"w": " 23", "start": 0.68, "end": 0.88},
                          {"w": " ans", "start": 0.88, "end": 1.12}, {"w": " je", "start": 1.12, "end": 1.18}]},
    {"clip": 2, "words": [{"w": " Pour", "start": 0.7, "end": 0.9}, {"w": " le", "start": 2.2, "end": 2.4},
                          {"w": " contexte", "start": 2.9, "end": 3.4}]},
]
KEEPS = [{"clip": 1, "start": 0.5, "end": 1.2, "transition": "Blur"}, {"clip": 2, "start": 0.6, "end": 1.3}, {"clip": 2, "start": 2.1, "end": 3.5}]
LOOK = {"punch_in": 1.08, "drift": 0.004}
DURATIONS = {"tick": 120, "whoosh": 600, "glitch": 300, "swell_thump_800": 1500}


@pytest.fixture
def words():
    return words_from_transcript(TRANSCRIPT)


@pytest.fixture
def story():
    return story_from_keeps(KEEPS, LOOK)


def test_words_get_ids_text_and_milliseconds(words):
    assert words["c01"][1] == {"id": "c01.w1", "text": "23", "startMs": 680, "endMs": 880}
    assert [w["id"] for w in words["c02"]] == ["c02.w0", "c02.w1", "c02.w2"]


def test_a_word_ending_before_it_starts_is_clamped():
    assert words_from_transcript([{"clip": 3, "words": [{"w": " x", "start": 1.2, "end": 1.1}]}])["c03"][0]["endMs"] == 1200


def test_keeps_become_story_clips_with_alternating_punch_in_and_slides(story):
    assert [(c["id"], c["asset"], c["inMs"], c["outMs"], c["zoom"]["base"]) for c in story] == [
        ("k01", "c01", 500, 1200, 1.0), ("k02", "c02", 600, 1300, 1.08), ("k03", "c02", 2100, 3500, 1.0)]
    assert story[0]["transitionOut"] == {"kind": "subjectSlide", "durationMs": 540}
    assert "transitionOut" not in story[1]
    assert output_starts(story) == [0, 700, 1400]


def test_anchor_on_the_last_word_of_the_same_keep(words, story):
    assert anchor_at(words, story, "c02", 2950) == {"word": "c02.w2", "offsetMs": 50}


def test_anchor_falls_back_to_output_time_when_no_word_of_the_keep_precedes(words, story):
    assert anchor_at(words, story, "c02", 2150) == {"atMs": 1450}


def test_anchor_in_a_cut_part_is_an_error(words, story):
    with pytest.raises(ValueError, match="cut"):
        anchor_at(words, story, "c02", 1500)


def test_captions_are_anchored_on_the_words_they_cover(words):
    caps, skipped = captions_from_plan([
        {"clip": 1, "start": 0.55, "end": 1.12, "text": "At 23,", "yellow": ["23"]},
        {"clip": 2, "start": 0.8, "end": 1.0, "text": "For"},
        {"clip": 2, "start": 1.0, "end": 2.0, "text": "nothing here"},
    ], words)
    assert caps == [
        {"words": ["c01.w1", "c01.w2"], "text": "At 23,", "lang": "en", "highlight": ["23"]},
        {"words": ["c02.w0", "c02.w0"], "text": "For", "lang": "en"},
    ]
    assert skipped == ["nothing here"]


def test_title_and_behind_words():
    baked = {"title": {"kicker": "EPISODE 01", "phases": [
        {"start": 0.0, "end": 1.85, "lines": [{"text": "ONE"}, {"text": "TWO"}]},
        {"start": 1.85, "end": 3.6, "lines": [{"text": "THREE", "box": [255, 107, 53]}]}]},
        "words": [{"text": "CONTEXT", "start": 5.16, "end": 6.75}]}
    assert title_element(baked) == {
        "id": "title", "kind": "title", "anchor": {"atMs": 0}, "durationMs": 3600, "slot": "title",
        "props": {"kicker": "EPISODE 01", "phases": [
            {"startMs": 0, "endMs": 1850, "lines": [{"text": "ONE", "box": False}, {"text": "TWO", "box": False}]},
            {"startMs": 1850, "endMs": 3600, "lines": [{"text": "THREE", "box": True}]}]},
    }
    assert behind_words(baked) == [{
        "id": "word1", "kind": "text.behindSubject", "layer": "behind-subject", "anchor": {"atMs": 5160}, "durationMs": 1590,
        "position": {"x": 0.5, "y": 0.378}, "props": {"text": "CONTEXT", "color": "accent"},
    }]


def test_overlays_become_full_frame_images_with_their_sounds_in_track_order(words, story):
    overlays = [
        {"asset": "m1", "track": "2_ov_a", "at": 0.1, "end": 0.6, "intro": "RGB_Scanlines", "sfx": "tick", "sfx_volume": 0.45},
        {"asset": "frame", "track": "1_hud", "at": 0.0, "end": "total", "intro": "RGB_Scanlines"},
        {"asset": "n1", "track": "3_ov_b", "clip": 2, "t": 2.95, "dur": 0.5, "intro": "CRT_Bands", "outro": "Fade_Out"},
    ]
    els = overlay_elements(overlays, words, story, DURATIONS)
    assert [e["id"] for e in els] == ["hud01", "hud02", "hud02.sfx", "hud03"]
    assert els[0] == {"id": "hud01", "kind": "image", "anchor": {"atMs": 0}, "untilEnd": True,
                      "props": {"asset": "hud_frame", "fit": "full", "intro": "glitch"}}
    assert els[1]["durationMs"] == 500 and els[1]["anchor"] == {"atMs": 100}
    assert els[2] == {"id": "hud02.sfx", "kind": "sfx", "anchor": {"atMs": 100}, "durationMs": 120,
                      "props": {"asset": "sfx_tick", "volume": 0.45}}
    assert els[3]["anchor"] == {"word": "c02.w2", "offsetMs": 50}
    assert (els[3]["props"]["intro"], els[3]["props"]["outro"], els[3]["durationMs"]) == ("glitch", "fade", 500)


def test_sounds_hook_transitions_and_accents(story):
    sfx = {"hook": {"name": "swell_thump", "volume": 0.5, "src_start": 0.8},
           "transition": {"name": "whoosh", "volume": 0.4, "lead_s": 0.25},
           "accents": [{"at": 1.0, "name": "glitch", "volume": 0.28}, {"at": 2.0, "name": "swell_thump", "volume": 0.42, "src_start": 0.8}]}
    els = sound_elements(sfx, KEEPS, story, DURATIONS)
    assert [(e["id"], e["anchor"]["atMs"], e["props"]["asset"], e["durationMs"]) for e in els] == [
        ("sfx.hook", 0, "sfx_swell_thump_800", 1500),
        ("sfx.whoosh1", 450, "sfx_whoosh", 600),
        ("sfx.accent1", 1000, "sfx_glitch", 300),
        ("sfx.accent2", 2000, "sfx_swell_thump_800", 1500),
    ]
    assert trimmed_name("swell_thump", 0.8) == "swell_thump_800"
    plan = {"sfx": sfx, "overlays": [{"asset": "m1", "sfx": "tick"}]}
    assert sfx_used(plan) == {"swell_thump_800": ("swell_thump", 0.8), "whoosh": ("whoosh", 0.0), "glitch": ("glitch", 0.0), "tick": ("tick", 0.0)}


def test_style_uses_the_lab_look():
    s = style_1015("C:/fonts/indivisible.ttf")
    assert s["fonts"]["caption"] == {"family": "Indivisible", "file": "C:/fonts/indivisible.ttf", "capcutResourceId": "7181740482383319553"}
    assert (s["grade"]["vignette"], s["caption"]["size"], s["slots"]["9:16"]["caption"]) == (0.25, 0.0525, {"x": 0.5, "y": 0.76})


LAB = Path.home() / "ClaudeCapcut" / "work"


@pytest.mark.skipif(not (LAB / "1015" / "plan_v2.json").exists(), reason="the ClaudeCapcut lab is not on this machine")
def test_the_real_lab_plan_converts_completely(tmp_path):
    lab = LAB / "1015"
    read = lambda f: json.loads((lab / f).read_text(encoding="utf-8"))
    plan = read("plan_v2.json")
    durations = {name: 500 for name in sfx_used(plan)}
    project, skipped = build_project(read("manifest.json"), read("transcript.json"), plan, durations, lab / "hud", LAB / "sfx", tmp_path)
    assert len(project["story"]) == 13
    assert len(project["captions"]) + len(skipped) == 51
    assert sum(e["kind"] == "image" for e in project["elements"]) == 25
    assert sum(e["kind"] == "text.behindSubject" for e in project["elements"]) == 4
    assert {a["kind"] for a in project["assets"]} == {"video", "image", "audio"}
```

Expected values: c02's third keep starts at output 1400 ms, so the source moment 2150 ms plays at 1450 ms; "contexte" starts at 2900 ms, 50 ms before 2950 ms. The transition sound comes 250 ms before the cut into clip 2 at 700 ms. The behind-subject word sat at y 610 px with a 230 px height in the lab: its center is (610 + 115) / 1920 = 0.378.

- [ ] **Step 2: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'convert'`.

- [ ] **Step 3: Implement**

`spikes/acceptance-1015/convert.py`:
```python
"""Turns the lab's 1015 edit (ClaudeCapcut/work/1015: manifest, Whisper transcript, plan_v2.json) into an Adam
Studio project. Pure functions: make_project.py does the file work."""
from pathlib import Path

SLIDE_MS = 540  # the lab's person-only slide: 0.22 s out, 0.32 s in
BEHIND_Y = 0.378  # the lab's behind-subject words: top at 610 px, 230 px tall, on 1920
PRESETS = {"RGB_Scanlines": "glitch", "CRT_Bands": "glitch", "Fade_In": "fade", "Fade_Out": "fade"}


def asset_id(clip: int) -> str:
    return f"c{clip:02d}"


def ms(seconds: float) -> int:
    return round(seconds * 1000)


def words_from_transcript(transcript: list[dict]) -> dict[str, list[dict]]:
    out = {}
    for entry in transcript:
        a = asset_id(entry["clip"])
        out[a] = [{"id": f"{a}.w{i}", "text": w["w"].strip(), "startMs": ms(w["start"]), "endMs": max(ms(w["start"]), ms(w["end"]))}
                  for i, w in enumerate(entry["words"])]
    return out


def story_from_keeps(keeps: list[dict], look: dict) -> list[dict]:
    """The lab's keeps: cover framing, punch-in alternating 1.0 and 1.08 with a slow drift, a slide where the lab baked one."""
    story = []
    for i, k in enumerate(keeps):
        clip = {"id": f"k{i + 1:02d}", "asset": asset_id(k["clip"]), "inMs": ms(k["start"]), "outMs": ms(k["end"]),
                "zoom": {"base": look["punch_in"] if i % 2 else 1.0, "driftPerSec": look["drift"]}}
        if k.get("transition"):
            clip["transitionOut"] = {"kind": "subjectSlide", "durationMs": SLIDE_MS}
        story.append(clip)
    return story


def output_starts(story: list[dict]) -> list[int]:
    starts, t = [], 0
    for c in story:
        starts.append(t)
        t += c["outMs"] - c["inMs"]
    return starts


def anchor_at(words: dict, story: list[dict], asset: str, t_ms: int) -> dict:
    """An anchor for a source moment: the last word of the same keep starting at or before it, else its output time."""
    for c, start in zip(story, output_starts(story)):
        if c["asset"] == asset and c["inMs"] <= t_ms < c["outMs"]:
            before = [w for w in words.get(asset, []) if c["inMs"] <= w["startMs"] <= t_ms]
            if before:
                return {"word": before[-1]["id"], "offsetMs": t_ms - before[-1]["startMs"]}
            return {"atMs": start + t_ms - c["inMs"]}
    raise ValueError(f"{asset} at {t_ms} ms was cut from the edit")


def captions_from_plan(captions: list[dict], words: dict) -> tuple[list[dict], list[str]]:
    """English captions anchored on the French words they cover (same clip, by time), or that overlap them in a pause."""
    out, skipped = [], []
    for c in captions:
        ws, s, e = words.get(asset_id(c["clip"]), []), ms(c["start"]), ms(c["end"])
        inside = [w for w in ws if w["startMs"] >= s - 50 and w["endMs"] <= e + 50] or [w for w in ws if w["endMs"] > s and w["startMs"] < e]
        if not inside:
            skipped.append(c["text"])
            continue
        cap = {"words": [inside[0]["id"], inside[-1]["id"]], "text": c["text"], "lang": "en"}
        if c.get("yellow"):
            cap["highlight"] = c["yellow"]
        out.append(cap)
    return out, skipped


def title_element(baked: dict) -> dict:
    t = baked["title"]
    phases = [{"startMs": ms(p["start"]), "endMs": ms(p["end"]), "lines": [{"text": l["text"], "box": "box" in l} for l in p["lines"]]}
              for p in t["phases"]]
    return {"id": "title", "kind": "title", "anchor": {"atMs": 0}, "durationMs": phases[-1]["endMs"], "slot": "title",
            "props": {"kicker": t["kicker"], "phases": phases}}


def behind_words(baked: dict) -> list[dict]:
    return [{"id": f"word{i + 1}", "kind": "text.behindSubject", "layer": "behind-subject", "anchor": {"atMs": ms(w["start"])},
             "durationMs": ms(w["end"]) - ms(w["start"]), "position": {"x": 0.5, "y": BEHIND_Y},
             "props": {"text": w["text"], "color": "accent"}} for i, w in enumerate(baked["words"])]


def trimmed_name(name: str, src_start: float) -> str:
    return f"{name}_{ms(src_start)}" if src_start else name


def overlay_elements(overlays: list[dict], words: dict, story: list[dict], durations: dict) -> list[dict]:
    """The lab's HUD overlays as full-frame images in track order (later tracks on top), each with its sound."""
    els = []
    for i, o in enumerate(sorted(overlays, key=lambda o: o.get("track", "")), 1):
        if "at" in o:
            start, anchor = ms(o["at"]), {"atMs": ms(o["at"])}
        else:
            asset = asset_id(o["clip"])
            anchor = anchor_at(words, story, asset, ms(o["t"]))
            c, s = next((c, s) for c, s in zip(story, output_starts(story)) if c["asset"] == asset and c["inMs"] <= ms(o["t"]) < c["outMs"])
            start = s + ms(o["t"]) - c["inMs"]
        el = {"id": f"hud{i:02d}", "kind": "image", "anchor": anchor, "props": {"asset": f"hud_{o['asset']}", "fit": "full"}}
        if o.get("end") == "total":
            el["untilEnd"] = True
        elif "end" in o:
            el["durationMs"] = ms(o["end"]) - start
        else:
            el["durationMs"] = ms(o["dur"])
        if o.get("intro") in PRESETS:
            el["props"]["intro"] = PRESETS[o["intro"]]
        if o.get("outro") in PRESETS:
            el["props"]["outro"] = PRESETS[o["outro"]]
        els.append(el)
        if o.get("sfx"):
            els.append({"id": f"hud{i:02d}.sfx", "kind": "sfx", "anchor": dict(anchor), "durationMs": durations[o["sfx"]],
                        "props": {"asset": f"sfx_{o['sfx']}", "volume": o.get("sfx_volume", 0.3)}})
    return els


def sound_elements(sfx: dict, keeps: list[dict], story: list[dict], durations: dict) -> list[dict]:
    """The hook sound, a whoosh before each cut into a new clip after a lab transition, and the accents."""
    def sound(id_, at_ms, name, volume, src_start=0.0):
        n = trimmed_name(name, src_start)
        return {"id": id_, "kind": "sfx", "anchor": {"atMs": max(0, at_ms)}, "durationMs": durations[n], "props": {"asset": f"sfx_{n}", "volume": volume}}

    hook = sfx["hook"]
    els = [sound("sfx.hook", 0, hook["name"], hook["volume"], hook.get("src_start", 0.0))]
    starts, t = output_starts(story), sfx["transition"]
    n = 0
    for i in range(1, len(keeps)):
        if keeps[i - 1]["clip"] != keeps[i]["clip"] and keeps[i - 1].get("transition"):
            n += 1
            els.append(sound(f"sfx.whoosh{n}", starts[i] - ms(t["lead_s"]), t["name"], t["volume"]))
    for j, a in enumerate(sfx.get("accents", []), 1):
        els.append(sound(f"sfx.accent{j}", ms(a["at"]), a["name"], a["volume"], a.get("src_start", 0.0)))
    return els


def sfx_used(plan: dict) -> dict[str, tuple[str, float]]:
    """Every sound the project needs: {asset name: (lab file name, seconds to skip at its start)}."""
    used = {}
    s = plan["sfx"]
    for entry in [s["hook"], s["transition"], *s.get("accents", [])]:
        used[trimmed_name(entry["name"], entry.get("src_start", 0.0))] = (entry["name"], entry.get("src_start", 0.0))
    for o in plan.get("overlays", []):
        if o.get("sfx"):
            used[o["sfx"]] = (o["sfx"], 0.0)
    return used


def style_1015(font: str) -> dict:
    indivisible = {"family": "Indivisible", "file": font, "capcutResourceId": "7181740482383319553"}
    slots = {"caption": {"x": 0.5, "y": 0.76}, "title": {"x": 0.5, "y": 0.31}, "center": {"x": 0.5, "y": 0.5}}
    return {
        "name": "Project Adam",
        "fonts": {"caption": indivisible, "title": indivisible},
        "colors": {"text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A"},
        "grade": {"warmth": 0.6, "contrast": 0.1, "saturation": 0.12, "brightness": -0.02, "vignette": 0.25},
        "caption": {"size": 0.0525, "stroke": 0.08, "shadow": True, "maxCharsPerLine": 22, "intro": "miniZoom"},
        "slots": {"9:16": slots, "16:9": slots},
        "lint": {"9:16": {"minDurationMs": 15000, "maxDurationMs": 90000}, "16:9": {"minDurationMs": 15000, "maxDurationMs": 1200000}},
    }


def build_project(manifest, transcript, plan, durations, hud_dir: Path, sfx_dir: Path, trimmed_dir: Path) -> tuple[dict, list[str]]:
    words = words_from_transcript(transcript)
    story = story_from_keeps(plan["keeps"], plan["look"])
    captions, skipped = captions_from_plan(plan["captions"], words)
    assets = [{"id": asset_id(c["i"]), "kind": "video", "path": c["file"],
               "meta": {"durationMs": ms(c["dur"]), "width": 1080, "height": 1920, "hasAudio": True}} for c in manifest]
    assets += [{"id": f"hud_{name}", "kind": "image", "path": str(Path(hud_dir) / f"{name}.png")}
               for name in sorted({o["asset"] for o in plan["overlays"]})]
    for name, (file, src_start) in sorted(sfx_used(plan).items()):
        folder = Path(trimmed_dir) if src_start else Path(sfx_dir)
        assets.append({"id": f"sfx_{name}", "kind": "audio", "path": str(folder / f"{name if src_start else file}.wav")})
    elements = [title_element(plan["baked"]), *behind_words(plan["baked"]),
                *overlay_elements(plan["overlays"], words, story, durations), *sound_elements(plan["sfx"], plan["keeps"], story, durations)]
    project = {"version": 1, "name": "1015", "canvas": {"format": "9:16", "fps": 30}, "style": "style.json", "assets": assets,
               "transcript": {"lang": "fr", "words": words}, "story": story, "elements": elements, "captions": captions}
    return project, skipped
```

- [ ] **Step 4: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: 15 tests PASS (3 from Task 2, 12 here; the last one reads the real lab).

- [ ] **Step 5: Commit**

```bash
git add spikes/acceptance-1015
git commit -m "feat(acceptance): convert the lab's 1015 v2 plan into an Adam Studio project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Write the 1015 project and validate it with the model

**Files:**
- Create: `spikes/acceptance-1015/make_project.py`

**Interfaces:**
- Consumes: `build_project`, `sfx_used`, `style_1015` (Task 4), `check_cache.py` (Task 2), `loadProject` (packages/render/src/project-io.ts).
- Produces: `C:\Users\miche\AdamStudioProjects\1015\{project.json, style.json, assets-src/<trimmed sounds>.wav}`; CLI `py/capcut/.venv/Scripts/python spikes/acceptance-1015/make_project.py [--lab DIR] [--project DIR]`.

- [ ] **Step 1: Write the script**

`spikes/acceptance-1015/make_project.py`:
```python
"""Writes the 1015 Adam Studio project (project.json, style.json, trimmed sounds) from the lab.

Usage: py/capcut/.venv/Scripts/python spikes/acceptance-1015/make_project.py [--lab DIR] [--project DIR]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

from convert import build_project, sfx_used, style_1015

FONT = "%LOCALAPPDATA%/CapCut/User Data/Cache/effect/7181740482383319553/8f72e39497fcb7bc0b6cf6a100e09d24/IndivisibleApp-Bold.ttf"


def duration_ms(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out) * 1000)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lab", default=str(Path.home() / "ClaudeCapcut" / "work"))
    parser.add_argument("--project", default=str(Path.home() / "AdamStudioProjects" / "1015"))
    args = parser.parse_args()
    lab, project_dir = Path(args.lab), Path(args.project)
    read = lambda f: json.loads((lab / "1015" / f).read_text(encoding="utf-8"))
    plan = read("plan_v2.json")
    trimmed_dir = project_dir / "assets-src"
    trimmed_dir.mkdir(parents=True, exist_ok=True)
    durations = {}
    for name, (file, src_start) in sfx_used(plan).items():
        src = lab / "sfx" / f"{file}.wav"
        if src_start:
            # sfx elements have no source offset: the lab's late start becomes a trimmed copy.
            dst = trimmed_dir / f"{name}.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(src_start), "-i", str(src), str(dst)], check=True)
            src = dst
        durations[name] = duration_ms(src)
    project, skipped = build_project(read("manifest.json"), read("transcript.json"), plan, durations,
                                     lab / "1015" / "hud", lab / "sfx", trimmed_dir)
    (project_dir / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (project_dir / "style.json").write_text(json.dumps(style_1015(FONT), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{project_dir / 'project.json'}: {len(project['story'])} clips, {len(project['captions'])} captions, "
          f"{len(project['elements'])} elements; captions skipped: {skipped or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Write the project**

Run: `py/capcut/.venv/Scripts/python spikes/acceptance-1015/make_project.py` (Python puts the script folder on its path, so `convert` imports)
Expected: `...\1015\project.json: 13 clips, 51 captions, <n> elements; captions skipped: none` (a skipped caption is listed by its text: note it for the acceptance report).

- [ ] **Step 3: Validate with the model and check the cache**

Run: `npx tsx -e "import('./packages/render/src/project-io.ts').then(m => { const p = m.loadProject(process.argv[1]); console.log('valid:', p.project.story.length, 'clips') })" C:/Users/miche/AdamStudioProjects/1015` then `py/capcut/.venv/Scripts/python spikes/acceptance-1015/check_cache.py`
Expected: `valid: 13 clips` (a schema error names its path: fix `convert.py` with a failing test first); 8 lines `cNN: ok`.

- [ ] **Step 4: Commit**

```bash
git add spikes/acceptance-1015/make_project.py
git commit -m "feat(acceptance): write the 1015 project and style from the lab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Render, export, compare and report

**Files:**
- Create: `spikes/acceptance-1015/compare.py`, `spikes/acceptance-1015/README.md`, `docs/decisions/0003-1015-acceptance.md`
- Test: `spikes/acceptance-1015/tests/test_compare.py`

**Interfaces:**
- Consumes: the 1015 project (Tasks 3 and 5), `npm run adam -- render`, `python -m adam_capcut export`.
- Produces: `keep_at(story, t_ms) -> (index, offset_ms) | None`; `C:\Users\miche\AdamStudioProjects\1015\renders\{1015.mp4, compare_v2.jpg, 1015 adam.capcut-report.json}`; the CapCut project "1015 adam"; the acceptance report.

- [ ] **Step 1: Write the failing test**

`spikes/acceptance-1015/tests/test_compare.py`:
```python
from compare import keep_at

STORY = [{"inMs": 500, "outMs": 1200}, {"inMs": 600, "outMs": 1300}, {"inMs": 2100, "outMs": 3500}]


def test_finds_the_keep_playing_at_an_output_time():
    assert keep_at(STORY, 0) == (0, 0)
    assert keep_at(STORY, 800) == (1, 100)
    assert keep_at(STORY, 2700) == (2, 1300)
    assert keep_at(STORY, 2800) is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'compare'`.

- [ ] **Step 3: Implement the comparison sheet**

`spikes/acceptance-1015/compare.py`:
```python
"""Side by side at chosen moments: the lab's baked v2 shot (left: grade, title, behind-subject words, slides; no HUD or
captions, which v2 added in CapCut) and the Adam Studio MP4 (right: everything).

Usage: py/capcut/.venv/Scripts/python spikes/acceptance-1015/compare.py [--lab DIR] [--project DIR] [--times 1000,5500,...]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

TIMES = [1000, 2700, 5500, 23600, 40500, 57500]


def keep_at(story: list[dict], t_ms: int) -> tuple[int, int] | None:
    """Index of the story clip playing at an output time, and how far into it."""
    start = 0
    for i, c in enumerate(story):
        length = c["outMs"] - c["inMs"]
        if t_ms < start + length:
            return i, t_ms - start
        start += length
    return None


def frame(src: Path, at_ms: int, dst: Path) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at_ms / 1000:.3f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=360:-2", str(dst)], check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lab", default=str(Path.home() / "ClaudeCapcut" / "work"))
    parser.add_argument("--project", default=str(Path.home() / "AdamStudioProjects" / "1015"))
    parser.add_argument("--times", default=",".join(map(str, TIMES)))
    args = parser.parse_args()
    project = Path(args.project)
    story = json.loads((project / "project.json").read_text(encoding="utf-8"))["story"]
    tmp = project / "renders" / "compare"
    tmp.mkdir(parents=True, exist_ok=True)
    rows = []
    for t in map(int, args.times.split(",")):
        hit = keep_at(story, t)
        if hit is None:
            continue
        index, offset = hit
        left, right = tmp / f"{t}-v2.png", tmp / f"{t}-adam.png"
        frame(Path(args.lab) / "1015" / "plates" / f"k{index:02d}.mp4", offset, left)
        frame(project / "renders" / "1015.mp4", t, right)
        rows.append((left, right))
    inputs = [arg for pair in rows for f in pair for arg in ("-i", str(f))]
    pairs = ";".join(f"[{2 * i}][{2 * i + 1}]hstack[r{i}]" for i in range(len(rows)))
    stack = "".join(f"[r{i}]" for i in range(len(rows))) + f"vstack=inputs={len(rows)}[out]" if len(rows) > 1 else "[r0]copy[out]"
    out = project / "renders" / "compare_v2.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", f"{pairs};{stack}", "-map", "[out]", str(out)], check=True)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests**

Run: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests -q`
Expected: 16 tests PASS.

- [ ] **Step 5: Render the MP4 and the comparison**

Run (timed): `npm run adam -- render C:/Users/miche/AdamStudioProjects/1015` then `py/capcut/.venv/Scripts/python spikes/acceptance-1015/compare.py`
Expected: the lint warnings are printed (note them for the report), `wrote ...\renders\1015.mp4`; ffprobe shows 1080x1920, 30 fps, about 64.7 s, an audio stream; `compare_v2.jpg` written. Open the sheet: the warmth of the right column should match the left; if it is visibly cooler or warmer, change `warmth` in `style.json` (0.1 steps), render again, and record the final value.

- [ ] **Step 6: Export to CapCut**

Run (timed): `py/capcut/.venv/Scripts/python -m adam_capcut export C:/Users/miche/AdamStudioProjects/1015 --name "1015 adam"`
Expected: the CapCut projects folder path printed; `renders/1015 adam.capcut-report.json` lists the baked stretches, the native clips, captions, title, HUD photos and sounds.

- [ ] **Step 7: Write the README and the acceptance report**

`spikes/acceptance-1015/README.md`:
````markdown
# 1015 acceptance

Rebuilds the creator's "1015 edit v2" (made in the ClaudeCapcut lab) as an Adam Studio project, then renders it
and exports it to CapCut (spec section 12). Nothing personal lives in this folder: the scripts read the lab and
write the project outside the repo.

```
C:\Users\miche\ClaudeCapcut\.tools\Scripts\python.exe spikes/acceptance-1015/build_cache.py   # analysis cache (20 to 40 min)
py/capcut/.venv/Scripts/python spikes/acceptance-1015/make_project.py
py/capcut/.venv/Scripts/python spikes/acceptance-1015/check_cache.py
npm run adam -- render C:/Users/miche/AdamStudioProjects/1015
py/capcut/.venv/Scripts/python spikes/acceptance-1015/compare.py
py/capcut/.venv/Scripts/python -m adam_capcut export C:/Users/miche/AdamStudioProjects/1015 --name "1015 adam"
```

Tests: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests`.
````

`docs/decisions/0003-1015-acceptance.md` (fill the measured values and lists from Steps 2, 5 and 6):
```markdown
# 0003: 1015 acceptance

Context: spec section 12 accepts the edit core when the creator's "1015" is described in `project.json`,
rendered to MP4 and exported to CapCut, and compared side by side with the lab's "1015 edit v2".

Built with `spikes/acceptance-1015` (see its README) on <date>.

| Measure | Value |
|---|---|
| Analysis cache build (8 clips) | <minutes> |
| Project | 13 clips, <n> captions (skipped: <list or none>), <n> elements |
| Lint | <warnings, one per line> |
| Render 1015.mp4 (64.7 s) | <minutes>, 1080x1920, 30 fps |
| CapCut export "1015 adam" | <minutes>; report: <n> baked, <n> native, <n> skipped |
| Warmth that matches v2 | <value> |

Known differences from v2, by design or model gap:
- The end card: v2 showed it 2.8 s past the last word over black; the story sets the video length, so it lasts until the end of the last clip.
- The final fade to black of v2 (0.5 s) has no equivalent in the model.
- HUD intro and outro durations: the renderer's presets (fade 250 ms, glitch 200 ms) replace v2's per-overlay durations.
- Captions start and end with the words they cover, not at v2's hand-set times.

Creator comparison ("1015 adam" next to "1015 edit v2" in CapCut, and 1015.mp4):

| Check | Result |
|---|---|
| Cuts and pacing | to fill |
| Grade and warmth | to fill |
| Title, behind-subject words, slides | to fill |
| Captions (English, yellow words, size) | to fill |
| HUD and sounds | to fill |

Decision: filled in with the creator (accepted, or the gaps to fix before sub-project 2).
```

- [ ] **Step 8: Commit**

```bash
git add spikes/acceptance-1015 docs/decisions/0003-1015-acceptance.md
git commit -m "feat(acceptance): render, export and compare 1015, acceptance report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
