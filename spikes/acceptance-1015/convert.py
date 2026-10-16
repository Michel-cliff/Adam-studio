"""Turns the lab's 1015 edit (ClaudeCapcut/work/1015: manifest, Whisper transcript, plan_v2.json) into an Adam
Studio project. Pure functions: make_project.py does the file work."""
from pathlib import Path

SLIDE_MS = 540  # the lab's person-only slide: 0.22 s out, 0.32 s in
BEHIND_Y = 0.378  # the lab's behind-subject words: top at 610 px, 230 px tall, on 1920
PRESETS = {"RGB_Scanlines": "glitch", "CRT_Bands": "glitch", "Fade_In": "fade", "Fade_Out": "fade"}


def asset_id(clip: int) -> str:
    return f"c{clip:02d}"


def ms(seconds: float) -> int:
    return round(seconds * 1000)


def words_from_transcript(transcript: list[dict]) -> dict[str, list[dict]]:
    out = {}
    for entry in transcript:
        a = asset_id(entry["clip"])
        out[a] = [{"id": f"{a}.w{i}", "text": w["w"].strip(), "startMs": ms(w["start"]), "endMs": max(ms(w["start"]), ms(w["end"]))}
                  for i, w in enumerate(entry["words"])]
    return out


def story_from_keeps(keeps: list[dict], look: dict) -> list[dict]:
    """The lab's keeps: cover framing, punch-in alternating 1.0 and 1.08 with a slow drift, a slide where the lab baked one."""
    story = []
    for i, k in enumerate(keeps):
        clip = {"id": f"k{i + 1:02d}", "asset": asset_id(k["clip"]), "inMs": ms(k["start"]), "outMs": ms(k["end"]),
                "zoom": {"base": look["punch_in"] if i % 2 else 1.0, "driftPerSec": look["drift"]}}
        if k.get("transition"):
            clip["transitionOut"] = {"kind": "subjectSlide", "durationMs": SLIDE_MS}
        story.append(clip)
    return story


def output_starts(story: list[dict]) -> list[int]:
    starts, t = [], 0
    for c in story:
        starts.append(t)
        t += c["outMs"] - c["inMs"]
    return starts


def anchor_at(words: dict, story: list[dict], asset: str, t_ms: int) -> dict:
    """An anchor for a source moment: the last word of the same keep starting at or before it, else its output time."""
    for c, start in zip(story, output_starts(story)):
        if c["asset"] == asset and c["inMs"] <= t_ms < c["outMs"]:
            before = [w for w in words.get(asset, []) if c["inMs"] <= w["startMs"] <= t_ms]
            if before:
                return {"word": before[-1]["id"], "offsetMs": t_ms - before[-1]["startMs"]}
            return {"atMs": start + t_ms - c["inMs"]}
    raise ValueError(f"{asset} at {t_ms} ms was cut from the edit")


def captions_from_plan(captions: list[dict], words: dict) -> tuple[list[dict], list[str]]:
    """English captions anchored on the French words they cover (same clip, by time), or that overlap them in a pause."""
    out, skipped = [], []
    for c in captions:
        ws, s, e = words.get(asset_id(c["clip"]), []), ms(c["start"]), ms(c["end"])
        inside = [w for w in ws if w["startMs"] >= s - 50 and w["endMs"] <= e + 50] or [w for w in ws if w["endMs"] > s and w["startMs"] < e]
        if not inside:
            skipped.append(c["text"])
            continue
        cap = {"words": [inside[0]["id"], inside[-1]["id"]], "text": c["text"], "lang": "en"}
        if c.get("yellow"):
            cap["highlight"] = c["yellow"]
        out.append(cap)
    return out, skipped


def title_element(baked: dict) -> dict:
    t = baked["title"]
    phases = [{"startMs": ms(p["start"]), "endMs": ms(p["end"]), "lines": [{"text": l["text"], "box": "box" in l} for l in p["lines"]]}
              for p in t["phases"]]
    return {"id": "title", "kind": "title", "anchor": {"atMs": 0}, "durationMs": phases[-1]["endMs"], "slot": "title",
            "props": {"kicker": t["kicker"], "phases": phases}}


def behind_words(baked: dict) -> list[dict]:
    return [{"id": f"word{i + 1}", "kind": "text.behindSubject", "layer": "behind-subject", "anchor": {"atMs": ms(w["start"])},
             "durationMs": ms(w["end"]) - ms(w["start"]), "position": {"x": 0.5, "y": BEHIND_Y},
             "props": {"text": w["text"], "color": "accent"}} for i, w in enumerate(baked["words"])]


def trimmed_name(name: str, src_start: float) -> str:
    return f"{name}_{ms(src_start)}" if src_start else name


def overlay_elements(overlays: list[dict], words: dict, story: list[dict], durations: dict) -> list[dict]:
    """The lab's HUD overlays as full-frame images in track order (later tracks on top), each with its sound."""
    els = []
    for i, o in enumerate(sorted(overlays, key=lambda o: o.get("track", "")), 1):
        if "at" in o:
            start, anchor = ms(o["at"]), {"atMs": ms(o["at"])}
        else:
            asset = asset_id(o["clip"])
            anchor = anchor_at(words, story, asset, ms(o["t"]))
            c, s = next((c, s) for c, s in zip(story, output_starts(story)) if c["asset"] == asset and c["inMs"] <= ms(o["t"]) < c["outMs"])
            start = s + ms(o["t"]) - c["inMs"]
        el = {"id": f"hud{i:02d}", "kind": "image", "anchor": anchor, "props": {"asset": f"hud_{o['asset']}", "fit": "full"}}
        if o.get("end") == "total":
            el["untilEnd"] = True
        elif "end" in o:
            el["durationMs"] = ms(o["end"]) - start
        else:
            el["durationMs"] = ms(o["dur"])
        if o.get("intro") in PRESETS:
            el["props"]["intro"] = PRESETS[o["intro"]]
        if o.get("outro") in PRESETS:
            el["props"]["outro"] = PRESETS[o["outro"]]
        els.append(el)
        if o.get("sfx"):
            els.append({"id": f"hud{i:02d}.sfx", "kind": "sfx", "anchor": dict(anchor), "durationMs": durations[o["sfx"]],
                        "props": {"asset": f"sfx_{o['sfx']}", "volume": o.get("sfx_volume", 0.3)}})
    return els


def sound_elements(sfx: dict, keeps: list[dict], story: list[dict], durations: dict) -> list[dict]:
    """The hook sound, a whoosh before each cut into a new clip after a lab transition, and the accents."""
    def sound(id_, at_ms, name, volume, src_start=0.0):
        n = trimmed_name(name, src_start)
        return {"id": id_, "kind": "sfx", "anchor": {"atMs": max(0, at_ms)}, "durationMs": durations[n], "props": {"asset": f"sfx_{n}", "volume": volume}}

    hook = sfx["hook"]
    els = [sound("sfx.hook", 0, hook["name"], hook["volume"], hook.get("src_start", 0.0))]
    starts, t = output_starts(story), sfx["transition"]
    n = 0
    for i in range(1, len(keeps)):
        if keeps[i - 1]["clip"] != keeps[i]["clip"] and keeps[i - 1].get("transition"):
            n += 1
            els.append(sound(f"sfx.whoosh{n}", starts[i] - ms(t["lead_s"]), t["name"], t["volume"]))
    for j, a in enumerate(sfx.get("accents", []), 1):
        els.append(sound(f"sfx.accent{j}", ms(a["at"]), a["name"], a["volume"], a.get("src_start", 0.0)))
    return els


def sfx_used(plan: dict) -> dict[str, tuple[str, float]]:
    """Every sound the project needs: {asset name: (lab file name, seconds to skip at its start)}."""
    used = {}
    s = plan["sfx"]
    for entry in [s["hook"], s["transition"], *s.get("accents", [])]:
        used[trimmed_name(entry["name"], entry.get("src_start", 0.0))] = (entry["name"], entry.get("src_start", 0.0))
    for o in plan.get("overlays", []):
        if o.get("sfx"):
            used[o["sfx"]] = (o["sfx"], 0.0)
    return used


def style_1015(font: str) -> dict:
    indivisible = {"family": "Indivisible", "file": font, "capcutResourceId": "7181740482383319553"}
    slots = {"caption": {"x": 0.5, "y": 0.76}, "title": {"x": 0.5, "y": 0.31}, "center": {"x": 0.5, "y": 0.5}}
    return {
        "name": "Project Adam",
        "fonts": {"caption": indivisible, "title": indivisible},
        "colors": {"text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A"},
        "grade": {"warmth": 0.3, "contrast": 0.1, "saturation": 0.12, "brightness": -0.02, "vignette": 0.25},
        "caption": {"size": 0.0525, "stroke": 0.08, "shadow": True, "maxCharsPerLine": 22, "intro": "miniZoom"},
        "slots": {"9:16": slots, "16:9": slots},
        "lint": {"9:16": {"minDurationMs": 15000, "maxDurationMs": 90000}, "16:9": {"minDurationMs": 15000, "maxDurationMs": 1200000}},
    }


def build_project(manifest, transcript, plan, durations, hud_dir: Path, sfx_dir: Path, trimmed_dir: Path) -> tuple[dict, list[str]]:
    words = words_from_transcript(transcript)
    story = story_from_keeps(plan["keeps"], plan["look"])
    captions, skipped = captions_from_plan(plan["captions"], words)
    assets = [{"id": asset_id(c["i"]), "kind": "video", "path": c["file"],
               "meta": {"durationMs": ms(c["dur"]), "width": 1080, "height": 1920, "hasAudio": True}} for c in manifest]
    assets += [{"id": f"hud_{name}", "kind": "image", "path": str(Path(hud_dir) / f"{name}.png")}
               for name in sorted({o["asset"] for o in plan["overlays"]})]
    for name, (file, src_start) in sorted(sfx_used(plan).items()):
        folder = Path(trimmed_dir) if src_start else Path(sfx_dir)
        assets.append({"id": f"sfx_{name}", "kind": "audio", "path": str(folder / f"{name if src_start else file}.wav")})
    elements = [title_element(plan["baked"]), *behind_words(plan["baked"]),
                *overlay_elements(plan["overlays"], words, story, durations), *sound_elements(plan["sfx"], plan["keeps"], story, durations)]
    project = {"version": 1, "name": "1015", "canvas": {"format": "9:16", "fps": 30}, "style": "style.json", "assets": assets,
               "transcript": {"lang": "fr", "words": words}, "story": story, "elements": elements, "captions": captions}
    return project, skipped
