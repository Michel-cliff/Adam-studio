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
