"""The renderer's titles as CapCut texts: one editable text per line, laid out like the renderer's Title and BigWord."""
import math

GLYPH_EM = 0.6
REVEAL_DELAY_MS = 80
STAGGER_MS = 160
REVEAL_MS = 240


def js_round(x: float) -> int:
    """Math.round of the renderer (Python's round() rounds halves to even)."""
    return math.floor(x + 0.5)


def fit_font_size(text: str, max_width: float, max_size: float, glyph_em: float = GLYPH_EM) -> float:
    """The renderer's fitFontSize: the longest line fits max_width, capped at max_size."""
    longest = max(1, *(len(line) for line in text.split("\n")))
    return min(max_size, math.floor(max_width / (longest * glyph_em)))


def title_texts(el: dict, width: int, height: int, fps: int) -> list[dict]:
    """Per phase: the kicker (first phase only) and one text per line, stacked and centered on the element's
    point, each starting when its reveal starts and ending with its phase."""
    props = el["props"]
    start, end = el["fromFrame"], el["fromFrame"] + el["durationFrames"]

    def frame(ms: float) -> int:
        return start + js_round((ms - el["trimStartMs"]) * fps / 1000)

    out: list[dict] = []
    for n, phase in enumerate(props["phases"]):
        p_from, p_to = max(start, frame(phase["startMs"])), min(end, frame(phase["endMs"]))
        if p_to <= p_from:
            continue
        rows = []
        if n == 0 and props.get("kicker"):
            rows.append({"role": "kicker", "text": props["kicker"], "px": width * 0.03, "gap": width * 0.01, "box": False,
                         "color": "accent", "intro": 0, "from": p_from})
        for i, line in enumerate(phase["lines"]):
            px = fit_font_size(line["text"], width * 0.9, width * 0.14 * line.get("sizeScale", 1))
            reveal = frame(phase["startMs"] + REVEAL_DELAY_MS + i * STAGGER_MS)
            rows.append({"role": "line", "text": line["text"], "px": px, "gap": 0, "box": line.get("box", False),
                         "color": "ink" if line.get("box", False) else "text", "intro": REVEAL_MS, "from": min(p_to - 1, max(p_from, reveal))})
        top = el["y"] * height - sum(r["px"] + r["gap"] for r in rows) / 2
        for r in rows:
            out.append({"role": r["role"], "text": r["text"], "px": r["px"], "box": r["box"], "color": r["color"], "intro": r["intro"],
                        "x": el["x"], "y": (top + r["px"] / 2) / height, "from": r["from"], "to": p_to})
            top += r["px"] + r["gap"]
    return out


def big_word_text(el: dict, width: int, height: int) -> dict:
    """The renderer's BigWord (text.behindSubject drawn in front) as one CapCut text."""
    props = el["props"]
    px = fit_font_size(props["text"], width * 0.92, width * 0.21 * props.get("sizeScale", 1))
    return {"role": "word", "text": props["text"], "px": px, "box": False, "color": props.get("color", "accent"), "intro": 250,
            "x": el["x"], "y": el["y"], "from": el["fromFrame"], "to": el["fromFrame"] + el["durationFrames"]}
