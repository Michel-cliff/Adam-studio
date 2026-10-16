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
