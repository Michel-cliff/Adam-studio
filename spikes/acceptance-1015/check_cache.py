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
