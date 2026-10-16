"""Copies every file the CapCut project uses into its media folder: the project stays self-contained."""
import json
import shutil
import subprocess
from pathlib import Path

from .errors import ExportError


def probe(path: Path) -> tuple[float, int, int]:
    """Duration in seconds, width and height, from ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(out)
    stream = next((s for s in info.get("streams", []) if "width" in s), {})
    duration = info.get("format", {}).get("duration")
    return float(duration) if duration not in (None, "N/A") else 0.0, int(stream.get("width", 0)), int(stream.get("height", 0))


def copy_media(timeline: dict, plan: dict, prep: Path, media_dir: Path) -> dict:
    sources = plan["sources"]
    out: dict = {"videos": {}, "files": {}, "bakes": {}, "overlays": {}}

    def copy(src: Path, name: str) -> Path:
        if not src.is_file():
            raise ExportError(f"{src} is missing: run the prepare step again")
        dst = media_dir / f"{name}{src.suffix.lower()}"
        shutil.copy2(src, dst)
        return dst

    for i, asset in enumerate(sorted({c["asset"] for c in timeline["clips"]}), 1):
        video = sources.get(asset, {}).get("video")
        if not video:
            raise ExportError(f'no video file for asset "{asset}" in the prepared plan')
        dst = copy(Path(video), f"v{i:02d}")
        out["videos"][asset] = (dst, probe(dst))
    wanted = [e["props"]["asset"] for e in timeline["elements"] if e["kind"] == "image" and e["layer"] == "front"]
    wanted += [a["asset"] for a in timeline["audio"] if not a["id"].startswith("clip:")]
    for i, asset in enumerate(dict.fromkeys(wanted), 1):
        file = sources.get(asset, {}).get("file")
        if not file:
            raise ExportError(f'no file for asset "{asset}" in the prepared plan')
        out["files"][asset] = copy(Path(file), f"f{i:02d}")
    for b in plan["bakes"]:
        dst = copy(prep / b["file"], f"bake-{b['id']}")
        out["bakes"][b["id"]] = (dst, probe(dst))
    for i, o in enumerate(plan["overlays"], 1):
        dst = copy(prep / o["file"], f"overlay-{i:02d}")
        out["overlays"][o["elementId"]] = (dst, probe(dst))
    return out
