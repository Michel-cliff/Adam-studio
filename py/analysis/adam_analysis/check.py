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
