import json
import subprocess
from pathlib import Path

FONT_ID = "7181740482383319553"
TITLE_FONT_ID = "7000000000000000001"
FONT_CANDIDATES = ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def system_font() -> str:
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    raise RuntimeError(f"no system font among {FONT_CANDIDATES}")


def timeline_dict(font: str) -> dict:
    """A resolved timeline shaped like the renderer's (4 s, 30 fps, 1080x1920)."""
    lint = {"minDurationMs": 0, "maxDurationMs": 60000, "maxPauseMs": 350, "fillers": []}
    return {
        "format": "9:16", "width": 1080, "height": 1920, "fps": 30, "durationFrames": 120,
        "clips": [
            {"id": "c1", "asset": "s", "fromFrame": 0, "durationFrames": 60, "sourceInMs": 0, "sourceOutMs": 2000,
             "framing": {"mode": "cover"}, "zoom": {"base": 1.08, "driftPerSec": 0.004},
             "transitionOut": {"kind": "subjectSlide", "durationMs": 600}, "volume": 1},
            {"id": "c2", "asset": "s", "fromFrame": 60, "durationFrames": 60, "sourceInMs": 2000, "sourceOutMs": 4000,
             "framing": {"mode": "fit", "background": "blur"}, "zoom": {"base": 1, "driftPerSec": 0},
             "transitionOut": {"kind": "cut"}, "volume": 0.8},
        ],
        "elements": [
            {"id": "behind", "kind": "image", "layer": "behind-subject", "fromFrame": 9, "durationFrames": 18, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {"asset": "m", "fit": "full"}},
            {"id": "pic", "kind": "image", "layer": "front", "fromFrame": 30, "durationFrames": 15, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {"asset": "m", "fit": "full", "intro": "fade", "outro": "glitch"}},
            {"id": "big", "kind": "text.behindSubject", "layer": "front", "fromFrame": 45, "durationFrames": 9, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {"text": "WOW", "color": "accent", "sizeScale": 1}},
            # A kind without a native mapping (HUD kinds come in sub-project 6): exported as an overlay.
            {"id": "hud1", "kind": "hud.window", "layer": "front", "fromFrame": 75, "durationFrames": 15, "trimStartMs": 0,
             "x": 0.5, "y": 0.5, "props": {}},
            {"id": "t1", "kind": "title", "layer": "front", "fromFrame": 90, "durationFrames": 24, "trimStartMs": 0, "x": 0.5, "y": 0.3,
             "props": {"kicker": "EPISODE 3", "phases": [
                 {"startMs": 0, "endMs": 400, "lines": [{"text": "QUI VEUT", "box": False, "sizeScale": 1}, {"text": "M'EMBAUCHER ?", "box": True, "sizeScale": 1}]},
                 {"startMs": 400, "endMs": 800, "lines": [{"text": "PERSONNE", "box": False, "sizeScale": 1.2}]},
             ]}},
        ],
        "captions": [{"id": "cap1", "fromFrame": 6, "durationFrames": 36, "text": "créé\nma boîte", "highlightRanges": [[8, 13]], "x": 0.5, "y": 0.76}],
        "beats": [],
        "audio": [
            {"id": "clip:c1", "asset": "s", "fromFrame": 0, "durationFrames": 60, "sourceInMs": 0, "volume": 1, "fadeInMs": 0, "fadeOutMs": 0},
            {"id": "clip:c2", "asset": "s", "fromFrame": 60, "durationFrames": 60, "sourceInMs": 2000, "volume": 0.8, "fadeInMs": 0, "fadeOutMs": 0},
            {"id": "beep", "asset": "b", "fromFrame": 30, "durationFrames": 9, "sourceInMs": 0, "volume": 0.5, "fadeInMs": 50, "fadeOutMs": 100},
        ],
        "orphans": [], "warnings": [],
        "style": {
            "name": "Test",
            "fonts": {"caption": {"family": "Caption", "file": font, "capcutResourceId": FONT_ID}, "title": {"family": "Title", "file": font, "capcutResourceId": TITLE_FONT_ID}},
            "colors": {"text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A"},
            "grade": {"warmth": 0.3, "contrast": 0.1, "saturation": 0.12, "brightness": -0.02, "vignette": 0.35},
            "caption": {"size": 0.052, "stroke": 0.08, "shadow": True, "maxCharsPerLine": 22, "intro": "miniZoom"},
            "slots": {"9:16": {}, "16:9": {}},
            "lint": {"9:16": lint, "16:9": lint},
        },
    }


def plan_dict(src: Path, font: str) -> dict:
    """capcut-plan.json as the prepare step writes it for the timeline above."""
    return {
        "name": "synthétique : test", "width": 1080, "height": 1920, "fps": 30,
        "bakes": [
            {"id": "b01", "fromFrame": 9, "toFrame": 27, "file": "bake/b01.mp4"},
            {"id": "b02", "fromFrame": 53, "toFrame": 71, "file": "bake/b02.mp4"},
        ],
        "overlays": [{"elementId": "hud1", "fromFrame": 75, "durationFrames": 15, "file": "overlay/o01.mov"}],
        "entries": [
            {"id": "transition:c1", "kind": "subjectSlide", "status": "baked", "reason": "person-only slide, baked into the main track"},
            {"id": "behind", "kind": "image", "status": "baked", "reason": "drawn behind the subject, baked into the main track"},
            {"id": "hud1", "kind": "hud.window", "status": "baked", "reason": "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)"},
        ],
        "sources": {
            "s": {"video": str(src / "edit.mp4"), "width": 1080, "height": 1920},
            "m": {"file": str(src / "magenta.png")},
            "b": {"file": str(src / "beep.wav")},
        },
        "fonts": {
            "caption": {"path": font, "family": "Caption", "resourceId": FONT_ID},
            "title": {"path": font, "family": "Title", "resourceId": TITLE_FONT_ID},
        },
    }


def center_pixel(video: Path) -> tuple[int, int, int]:
    """RGB of the center pixel of a video's first frame."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "crop=1:1:540:960", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    return raw[0], raw[1], raw[2]


def content_of(dest: Path, profiles) -> dict:
    return json.loads((dest / profiles.get_draft_profile().content_file).read_text(encoding="utf-8"))


def report_of(project: Path, name: str) -> dict:
    data = json.loads((project / "renders" / f"{name}.capcut-report.json").read_text(encoding="utf-8"))
    return {e["id"]: e for e in data["entries"]}
