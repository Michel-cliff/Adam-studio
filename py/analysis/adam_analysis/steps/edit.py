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
