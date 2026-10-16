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
