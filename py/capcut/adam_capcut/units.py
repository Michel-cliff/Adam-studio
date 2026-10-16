"""Conversions from the resolved timeline (frames, normalized positions) to CapCut (microseconds,
half-canvas offsets from the center with +Y up, scales relative to CapCut's fit-to-canvas size)."""
import re

from .errors import ExportError

US = 1_000_000


def frame_us(frame: int, fps: int) -> int:
    return round(frame * US / fps)


def span_us(from_frame: int, to_frame: int, fps: int) -> tuple[int, int]:
    """Start and duration of frames [from_frame, to_frame), from accumulated positions (no drift)."""
    start = frame_us(from_frame, fps)
    return start, frame_us(to_frame, fps) - start


def ms_us(ms: float) -> int:
    return round(ms * 1000)


# CSS color names the renderer accepts and styles are likely to use.
CSS_COLORS = {
    "white": "#FFFFFF", "black": "#000000", "red": "#FF0000", "green": "#008000", "lime": "#00FF00", "blue": "#0000FF",
    "yellow": "#FFFF00", "orange": "#FFA500", "gray": "#808080", "grey": "#808080", "magenta": "#FF00FF",
    "fuchsia": "#FF00FF", "cyan": "#00FFFF", "aqua": "#00FFFF", "purple": "#800080", "pink": "#FFC0CB",
}
_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def to_hex(color: str) -> str:
    """#RRGGBB from #RGB, #RRGGBB, #RRGGBBAA (alpha dropped) or a CSS color name."""
    c = CSS_COLORS.get(color.strip().lower(), color.strip())
    m = _HEX.match(c)
    if not m:
        raise ExportError(f'unsupported color "{color}": use #RRGGBB or a CSS color name')
    digits = m.group(1)
    if len(digits) == 3:
        digits = "".join(d * 2 for d in digits)
    return "#" + digits[:6].upper()


def hex_rgb(color: str) -> tuple[float, float, float]:
    c = to_hex(color).lstrip("#")
    return int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255


def place(x: float, y: float) -> tuple[float, float]:
    """A normalized canvas point (0, 0 at the top left) as a CapCut transform."""
    return (x - 0.5) * 2, (0.5 - y) * 2


def fit_factor(source: tuple[int, int], canvas: tuple[int, int]) -> float:
    """How CapCut sizes media at scale 1: fitted inside the canvas."""
    return min(canvas[0] / source[0], canvas[1] / source[1])


def cover_scale(source: tuple[int, int], canvas: tuple[int, int]) -> float:
    return max(canvas[0] / source[0], canvas[1] / source[1]) / fit_factor(source, canvas)


def crop_rect_at(framing: dict, source_ms: float) -> dict:
    """Crop rect at a source time: `rect` at 0, keyframes in source time, linear, held after the last (renderer cropRectAt)."""
    points = sorted([{"atMs": 0, "rect": framing["rect"]}, *framing.get("keyframes", [])], key=lambda p: p["atMs"])
    prev = points[0]
    for p in points[1:]:
        if source_ms < p["atMs"]:
            t = min(1.0, max(0.0, (source_ms - prev["atMs"]) / max(1, p["atMs"] - prev["atMs"])))
            return {k: prev["rect"][k] + (p["rect"][k] - prev["rect"][k]) * t for k in ("x", "y", "w", "h")}
        prev = p
    return prev["rect"]


def crop_transform(rect: dict, source: tuple[int, int], canvas: tuple[int, int], zoom: float = 1.0) -> tuple[float, float, float]:
    """CapCut scale and position so the normalized source rect covers the canvas, centered (the renderer's
    cropBox), then zoomed about the canvas center."""
    sw, sh = source
    cw, ch = canvas
    s = max(cw / (rect["w"] * sw), ch / (rect["h"] * sh))
    dx = sw * s * (0.5 - (rect["x"] + rect["w"] / 2))
    dy = sh * s * (0.5 - (rect["y"] + rect["h"] / 2))
    return s / fit_factor(source, canvas) * zoom, dx * zoom / (cw / 2), -dy * zoom / (ch / 2)


def image_scale(size: tuple[int, int], canvas: tuple[int, int]) -> float:
    """CapCut scale of an image the renderer draws at its natural size, capped at 90% of the canvas."""
    w, h = size
    cw, ch = canvas
    shown = min(1.0, 0.9 * cw / w, 0.9 * ch / h)
    return shown / fit_factor(size, canvas)


def zoom_at(zoom: dict, elapsed_ms: float) -> float:
    return zoom["base"] + zoom["driftPerSec"] * elapsed_ms / 1000


_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(name: str) -> str:
    """The renderer's fileSafeName: characters Windows forbids become "-" (a ":" would write an NTFS stream)."""
    return _FORBIDDEN.sub("-", name).rstrip(". ").strip() or "edit"


def warmth_filter(warmth: float) -> str:
    """The renderer's warmth color matrix as an ffmpeg filter (red up, green slightly, blue down)."""
    return f"colorchannelmixer=rr={round(1 + 0.12 * warmth, 4)}:gg={round(1 + 0.02 * warmth, 4)}:bb={round(1 - 0.14 * warmth, 4)}"
