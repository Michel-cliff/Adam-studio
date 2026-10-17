"""Builds the CapCut script from the resolved timeline and the prepared plan."""
import uuid
from pathlib import Path

from .layout import main_track
from .media import probe
from .titles import big_word_text, title_texts
from .tracks import allocate
from .units import cover_scale, crop_rect_at, crop_transform, hex_rgb, image_scale, ms_us, place, span_us, to_hex, zoom_at

# CapCut font size per unit of text size as a fraction of the canvas width: the lab's captions were 10.5 for
# about 0.052. Provisional, checked in CapCut (docs/decisions/0002-capcut-export-check.md).
CAPTION_SIZE_K = 200
# CapCut border width per unit of the style's stroke (a fraction of the font size): the lab used 40 for 0.08.
BORDER_K = 500
# Renderer presets to CapCut animations, with their renderer durations in ms.
INTRO = {"fade": ("Fade_In", 250), "pop": ("Mini_Zoom", 200), "glitch": ("RGB_Scanlines", 200)}
OUTRO = {"fade": ("Fade_Out", 250), "pop": ("Mini_Zoom", 200), "glitch": ("RGB_Scanlines", 200)}
APPROX = {"glitch": "glitch approximated by RGB Scanlines"}
TITLE_OUTRO_MS = 160


def color_of(name: str, colors: dict) -> str:
    """A style color by name ("accent", "ink", "text", "highlight"), or the value itself (the renderer's colorOf)."""
    return to_hex(colors.get(name, name))

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
        self.text_roles: dict[str, str] = {}
        self.text_tracks = 0

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
                seg.add_background_filling("color", color=f"{to_hex(framing.get('color') or '#000000')}FF")
        return seg


    def text_track(self, name: str) -> str:
        """Text tracks stack in creation order: titles first, captions above them (as in the renderer)."""
        self.script.add_track(self.p.Track_type.text, name, relative_index=self.text_tracks)
        self.text_tracks += 1
        return name

    def titles(self) -> None:
        """Titles and front big words as editable CapCut texts, one per line."""
        p, style, (w, h) = self.p, self.tl["style"], self.canvas
        texts = []
        for e in self.tl["elements"]:
            if e["layer"] != "front":
                continue
            if e["kind"] == "title":
                texts += title_texts(e, w, h, self.fps)
                self.entries.append(entry(e["id"], "title", "native", "CapCut text, one per line (the reveal is approximated by Glitch intros)"))
            elif e["kind"] == "text.behindSubject":
                texts.append(big_word_text(e, w, h))
                self.entries.append(entry(e["id"], e["kind"], "native", "CapCut text"))
        texts.sort(key=lambda t: t["from"])
        tracks = allocate([(t["from"], t["to"]) for t in texts])
        names = [self.text_track(f"titles{i + 1}") for i in range(max(tracks, default=-1) + 1)]
        for t, k in zip(texts, tracks):
            x, y = place(t["x"], t["y"])
            tr = self.span(t["from"], t["to"])
            seg = p.Text_segment(
                t["text"], tr,
                style=p.Text_style(size=t["px"] / w * CAPTION_SIZE_K, color=hex_rgb(color_of(t["color"], style["colors"])), align=1),
                background=p.Text_background(color=style["colors"]["accent"]) if t["box"] else None,
                clip_settings=p.Clip_settings(transform_x=x, transform_y=y),
            )
            if t["intro"]:
                seg.add_animation(p.CapCut_Text_intro.Glitch, duration=min(ms_us(t["intro"]), tr.duration // 2))
            seg.add_animation(p.CapCut_Text_outro.Glitch, duration=min(ms_us(TITLE_OUTRO_MS), tr.duration // 2))
            self.text_roles[seg.material_id] = "title"
            self.script.add_segment(seg, names[k])

    def captions(self) -> None:
        p, style = self.p, self.tl["style"]
        cap = style["caption"]
        size = cap["size"] * CAPTION_SIZE_K
        border = p.Text_border(color=(0.0, 0.0, 0.0), width=cap["stroke"] * BORDER_K)
        shadow = p.Text_shadow(has_shadow=True, alpha=0.55, distance=4.0, smoothing=0.6, angle=-60.0) if cap["shadow"] else None
        caps = sorted(self.tl["captions"], key=lambda c: c["fromFrame"])
        tracks = allocate([(c["fromFrame"], c["fromFrame"] + c["durationFrames"]) for c in caps])
        names = [self.text_track(f"captions{i + 1}") for i in range(max(tracks, default=-1) + 1)]
        for c, k in zip(caps, tracks):
            x, y = place(c["x"], c["y"])
            tr = self.span(c["fromFrame"], c["fromFrame"] + c["durationFrames"])
            seg = p.Text_segment(c["text"], tr, style=p.Text_style(size=size, color=hex_rgb(style["colors"]["text"]), align=1),
                                 border=border, shadow=shadow, clip_settings=p.Clip_settings(transform_x=x, transform_y=y))
            # Same offsets as the renderer; identical to Python indices for text without emoji.
            for a, b in c["highlightRanges"]:
                seg.add_text_style(p.text_segment.TextStyleRange(
                    a, b, p.Text_style(size=size, color=hex_rgb(style["colors"]["highlight"]), align=1), border=border))
            if cap["intro"] == "miniZoom":
                seg.add_animation(p.CapCut_Text_intro.Mini_Zoom, duration=min(150_000, tr.duration // 3))
            self.text_roles[seg.material_id] = "caption"
            self.script.add_segment(seg, names[k])
            self.entries.append(entry(c["id"], "caption", "native", "CapCut text"))

    def front(self) -> None:
        """Front images (native photos) and overlays (transparent MOV), one video track per overlap level."""
        p = self.p
        items = []
        for e in self.tl["elements"]:
            if e["layer"] != "front":
                continue
            if e["kind"] == "image":
                items.append(("image", e))
            elif e["id"] in self.media["overlays"]:
                items.append(("overlay", e))
        items.sort(key=lambda it: it[1]["fromFrame"])
        tracks = allocate([(e["fromFrame"], e["fromFrame"] + e["durationFrames"]) for _, e in items])
        for i in range(max(tracks, default=-1) + 1):
            self.script.add_track(p.Track_type.video, f"front{i + 1}", relative_index=i + 1)
        for (kind, e), k in zip(items, tracks):
            tr = self.span(e["fromFrame"], e["fromFrame"] + e["durationFrames"])
            if kind == "overlay":
                path, info = self.media["overlays"][e["id"]]
                seg = p.Video_segment(self.video_material(("overlay", e["id"]), path, info), tr, source_timerange=p.Timerange(0, tr.duration), volume=0.0)
            else:
                seg = self.image(e, tr)
            self.script.add_segment(seg, f"front{k + 1}")

    def image(self, e: dict, tr):
        p, props = self.p, e["props"]
        full = props.get("fit", "full") == "full"
        key = ("photo", props["asset"], full)
        mat = self.materials.get(key)
        if mat is None:
            path = self.media["files"][props["asset"]]
            mat = p.Video_material("photo", path=str(path))
            # pyJianYingDraft leaves photos at 0x0 (it expects a download step): set the size CapCut must use.
            if full:
                mat.width, mat.height = self.canvas
            else:
                _, mat.width, mat.height = probe(path)
                # The material id derives from the file name: a contained use of an image also used full would
                # share the full one's material, and its size, in CapCut.
                mat.material_id = uuid.uuid3(uuid.NAMESPACE_URL, f"{path}#contain").hex
            self.script.add_material(mat)
            self.materials[key] = mat
        scale = 1.0 if full else image_scale((mat.width, mat.height), self.canvas)
        x, y = (0.0, 0.0) if full else place(e["x"], e["y"])
        seg = p.Video_segment(mat, tr, clip_settings=p.Clip_settings(scale_x=scale, scale_y=scale, transform_x=x, transform_y=y))
        notes = []
        for prop, table, kinds in (("intro", INTRO, p.CapCut_Intro_type), ("outro", OUTRO, p.CapCut_Outro_type)):
            preset = props.get(prop)
            if not preset:
                continue
            if preset not in table:
                notes.append(f'{prop} "{preset}" has no CapCut mapping')
                continue
            name, ms = table[preset]
            seg.add_animation(getattr(kinds, name), duration=min(ms_us(ms), tr.duration // 2))
            if preset in APPROX:
                notes.append(APPROX[preset])
        self.entries.append(entry(e["id"], "image", "native", "photo" + (f" ({'; '.join(notes)})" if notes else "")))
        return seg

    def sounds(self) -> None:
        p = self.p
        sfx = sorted((a for a in self.tl["audio"] if not a["id"].startswith("clip:") and a["durationFrames"] > 0), key=lambda a: a["fromFrame"])
        tracks = allocate([(a["fromFrame"], a["fromFrame"] + a["durationFrames"]) for a in sfx])
        for i in range(max(tracks, default=-1) + 1):
            self.script.add_track(p.Track_type.audio, f"sfx{i + 1}")
        for a, k in zip(sfx, tracks):
            key = ("audio", a["asset"])
            path = self.media["files"][a["asset"]]
            if key not in self.materials:
                m = p.Audio_material(path=str(path))
                self.script.add_material(m)
                self.materials[key] = m
                self.materials[("audio length", a["asset"])] = round(probe(path)[0] * 1_000_000)
            tr = self.span(a["fromFrame"], a["fromFrame"] + a["durationFrames"])
            # Never past the end of the file: CapCut's handling of a source range beyond the media is unknown.
            available = self.materials[("audio length", a["asset"])] - ms_us(a["sourceInMs"])
            note = ""
            if 0 < available < tr.duration:
                tr = p.Timerange(tr.start, available)
                note = f" (shortened to the file's length, {available // 1000} ms)"
            seg = p.Audio_segment(self.materials[key], tr, source_timerange=p.Timerange(ms_us(a["sourceInMs"]), tr.duration), volume=a["volume"])
            if a["fadeInMs"] or a["fadeOutMs"]:
                seg.add_fade(ms_us(a["fadeInMs"]), ms_us(a["fadeOutMs"]))
            self.script.add_segment(seg, f"sfx{k + 1}")
            self.entries.append(entry(a["id"], "sfx", "native", "audio segment" + note))

    def look(self) -> None:
        p, g = self.p, self.tl["style"]["grade"]
        adjusted = [k for k in ("brightness", "contrast", "saturation") if g[k]]
        if adjusted:
            self.entries.append(entry("grade", "grade", "native", f"{', '.join(adjusted)} keyframes on the main track"))
        if g["vignette"] > 0:
            self.script.add_track(p.Track_type.effect, "fx")
            self.script.add_effect(p.CapCut_Video_scene_effect_type.Vignette, self.span(0, self.tl["durationFrames"]), "fx",
                                   params=[round(g["vignette"] * 100)])
            self.entries.append(entry("grade.vignette", "grade", "native", "Vignette effect over the whole video"))
        if g["warmth"]:
            self.entries.append(entry("grade.warmth", "grade", "baked",
                                      f"warmth {g['warmth']} applied to the copied takes and the baked stretches with the renderer's color matrix"))

    def font_entries(self) -> None:
        for role in sorted(set(self.text_roles.values())):
            font = self.plan["fonts"][role]
            if not font.get("resourceId"):
                self.entries.append(entry(f"font.{role}", "font", "skipped",
                                          f'no capcutResourceId for "{font["family"]}" in the style: CapCut shows its default font'))


def build_script(pjd, timeline: dict, plan: dict, media: dict):
    b = Builder(pjd, timeline, plan, media)
    b.main_track()
    b.front()
    b.titles()
    b.captions()
    b.sounds()
    b.look()
    b.font_entries()
    return b.script, b.entries, b.text_roles
