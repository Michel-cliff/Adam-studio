"""The CapCut main track: native clip parts around the stretches Remotion baked."""


def main_track(timeline: dict, bakes: list[dict]) -> list[dict]:
    """Parts in time order, each bake once: {"kind": "clip", "clip", "from", "to"} or {"kind": "bake", "bake"}."""
    parts: list[dict] = []
    emitted: set[str] = set()
    ordered = sorted(bakes, key=lambda b: b["fromFrame"])
    for clip in timeline["clips"]:
        start, end = clip["fromFrame"], clip["fromFrame"] + clip["durationFrames"]
        cursor = start
        for b in ordered:
            if b["toFrame"] <= cursor or b["fromFrame"] >= end:
                continue
            if b["fromFrame"] > cursor:
                parts.append({"kind": "clip", "clip": clip, "from": cursor, "to": b["fromFrame"]})
            if b["id"] not in emitted:
                parts.append({"kind": "bake", "bake": b})
                emitted.add(b["id"])
            cursor = min(end, b["toFrame"])
        if cursor < end:
            parts.append({"kind": "clip", "clip": clip, "from": cursor, "to": end})
    return parts


def part_frames(part: dict) -> tuple[int, int]:
    if part["kind"] == "clip":
        return part["from"], part["to"]
    return part["bake"]["fromFrame"], part["bake"]["toFrame"]
