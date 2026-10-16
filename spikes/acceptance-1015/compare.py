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
