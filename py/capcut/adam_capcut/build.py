"""Builds the CapCut script from the resolved timeline and the prepared plan."""
from pathlib import Path

from .layout import main_track
from .units import cover_scale, crop_rect_at, crop_transform, ms_us, span_us, zoom_at


def entry(id_: str, kind: str, status: str, reason: str) -> dict:
    return {"id": id_, "kind": kind, "status": status, "reason": reason}


class Builder:
    def __init__(self, pjd, timeline: dict, plan: dict, media: dict):
        self.p = pjd
        self.tl = timeline
        self.plan = plan
        self.media = media
        self.fps = timeline["fps"]
        self.canvas = (timeline["width"], timeline["height"])
        self.script = pjd.Script_file(timeline["width"], timeline["height"], fps=self.fps)
        self.entries: list[dict] = []
        self.materials: dict = {}

    def span(self, from_frame: int, to_frame: int):
        start, duration = span_us(from_frame, to_frame, self.fps)
        return self.p.Timerange(start, duration)

    def video_material(self, key, path: Path, info: tuple[float, int, int]):
        if key not in self.materials:
            m = self.p.Video_material("video", path=str(path), duration=info[0], width=info[1], height=info[2])
            self.script.add_material(m)
            self.materials[key] = m
        return self.materials[key]

    def grade(self, seg) -> None:
        """Brightness, contrast and saturation on every main track segment, baked or native."""
        g = self.tl["style"]["grade"]
        for prop in ("brightness", "contrast", "saturation"):
            if g[prop]:
                seg.add_keyframe(getattr(self.p.Keyframe_property, prop), 0, g[prop])

    def main_track(self) -> None:
        p = self.p
        self.script.add_track(p.Track_type.video, "main")
        for part in main_track(self.tl, self.plan["bakes"]):
            if part["kind"] == "bake":
                b = part["bake"]
                path, info = self.media["bakes"][b["id"]]
                tr = self.span(b["fromFrame"], b["toFrame"])
                seg = p.Video_segment(self.video_material(("bake", b["id"]), path, info), tr, source_timerange=p.Timerange(0, tr.duration))
                self.entries.append(entry(f"bake:{b['id']}", "main track", "baked", f"frames {b['fromFrame']} to {b['toFrame'] - 1} rendered by Remotion"))
            else:
                seg = self.clip_part(part)
            self.grade(seg)
            self.script.add_segment(seg, "main")
        for c in self.tl["clips"]:
            if c["framing"]["mode"] != "split":
                self.entries.append(entry(f"clip:{c['id']}", "clip", "native", f"{c['framing']['mode']} framing"))

    def clip_part(self, part: dict):
        p, c = self.p, part["clip"]
        path, info = self.media["videos"][c["asset"]]
        source = (info[1], info[2])
        tr = self.span(part["from"], part["to"])
        offset_ms = (part["from"] - c["fromFrame"]) * 1000 / self.fps
        end_ms = offset_ms + tr.duration / 1000
        seg = p.Video_segment(self.video_material(("video", c["asset"]), path, info), tr,
                              source_timerange=p.Timerange(ms_us(c["sourceInMs"] + offset_ms), tr.duration), volume=c["volume"])
        framing = c["framing"]
        times = [offset_ms, end_ms]
        if framing["mode"] == "crop":
            times += [k["atMs"] - c["sourceInMs"] for k in framing.get("keyframes", []) if offset_ms < k["atMs"] - c["sourceInMs"] < end_ms]
        for elapsed in sorted(set(times)):
            t_us = min(tr.duration, ms_us(elapsed - offset_ms))
            z = zoom_at(c["zoom"], elapsed)
            if framing["mode"] == "crop":
                scale, x, y = crop_transform(crop_rect_at(framing, c["sourceInMs"] + elapsed), source, self.canvas, z)
                seg.add_keyframe(p.Keyframe_property.position_x, t_us, x)
                seg.add_keyframe(p.Keyframe_property.position_y, t_us, y)
            else:
                scale = (cover_scale(source, self.canvas) if framing["mode"] == "cover" else 1.0) * z
            seg.add_keyframe(p.Keyframe_property.uniform_scale, t_us, scale)
        if framing["mode"] == "fit":
            if framing.get("background", "blur") == "blur":
                seg.add_background_filling("blur", 0.0625)
            else:
                color = framing.get("color") or "#000000"
                seg.add_background_filling("color", color=color if len(color) == 9 else f"{color}FF")
        return seg


def build_script(pjd, timeline: dict, plan: dict, media: dict):
    b = Builder(pjd, timeline, plan, media)
    b.main_track()
    return b.script, b.entries
