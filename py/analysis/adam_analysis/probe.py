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
