import json

import pytest

from adam_capcut.export import export
from adam_capcut.build import color_of
from helpers import FONT_ID, TITLE_FONT_ID, center_pixel, content_of, report_of


def texts_by_string(content):
    return {json.loads(t["content"])["text"]: t for t in content["materials"]["texts"]}


def test_captions_are_native_text_with_the_caption_font_and_highlight(lab, project, tmp_path):
    _, profiles = lab
    texts = texts_by_string(content_of(export(project, name="captions", projects_root=tmp_path, prepare=False), profiles))
    cap = texts["créé\nma boîte"]
    assert cap["font_resource_id"] == FONT_ID
    styles = json.loads(cap["content"])["styles"]
    # "boîte" highlighted: the accents do not shift the range.
    assert [st["range"] for st in styles] == [[0, 8], [8, 13]]
    assert styles[1]["fill"]["content"]["solid"]["color"] == pytest.approx([1.0, 209 / 255, 0.0])
    assert report_of(project, "captions")["cap1"]["status"] == "native"


def test_titles_are_editable_texts_with_the_title_font(lab, project, tmp_path):
    _, profiles = lab
    texts = texts_by_string(content_of(export(project, name="titles", projects_root=tmp_path, prepare=False), profiles))
    assert {"EPISODE 3", "QUI VEUT", "M'EMBAUCHER ?", "PERSONNE", "WOW"} <= set(texts)
    assert {texts[k]["font_resource_id"] for k in ("EPISODE 3", "QUI VEUT", "PERSONNE", "WOW")} == {TITLE_FONT_ID}
    assert texts["M'EMBAUCHER ?"]["background_color"] == "#FF6B35"
    r = report_of(project, "titles")
    assert (r["t1"]["status"], r["big"]["status"]) == ("native", "native")


def test_front_images_are_sized_photos_and_overlays_are_videos_on_front_tracks(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="front", projects_root=tmp_path, prepare=False), profiles)
    photos = [m for m in content["materials"]["videos"] if m["type"] == "photo"]
    assert [(m["width"], m["height"]) for m in photos] == [(1080, 1920)]
    front = [t for t in content["tracks"] if t["name"].startswith("front")]
    assert [len(t["segments"]) for t in front] == [2]
    r = report_of(project, "front")
    assert r["pic"]["status"] == "native" and "RGB Scanlines" in r["pic"]["reason"]
    assert r["hud1"]["status"] == "baked"


def test_sound_effects_keep_volume_and_fades(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="sounds", projects_root=tmp_path, prepare=False), profiles)
    audio = [t for t in content["tracks"] if t["type"] == "audio"]
    assert [len(t["segments"]) for t in audio] == [2]
    assert audio[0]["segments"][0]["volume"] == 0.5
    assert [(f["fade_in_duration"], f["fade_out_duration"]) for f in content["materials"]["audio_fades"]] == [(50000, 100000)]
    assert report_of(project, "sounds")["beep"]["status"] == "native"


def test_vignette_is_native_and_warmth_is_applied_to_the_copied_takes(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="look", projects_root=tmp_path, prepare=False)
    assert [e["name"] for e in content_of(dest, profiles)["materials"]["video_effects"]] == ["Vignette"]
    r0, _, b0 = center_pixel(project / "media-src" / "edit.mp4")
    r1, _, b1 = center_pixel(dest / "media" / "v01.mp4")
    assert abs(r0 - b0) <= 3, "the source take is neutral gray"
    assert r1 - b1 >= 8, "the copied take is warmer"
    r = report_of(project, "look")
    assert (r["grade"]["status"], r["grade.vignette"]["status"], r["grade.warmth"]["status"]) == ("native", "native", "baked")


def test_a_sound_longer_than_its_file_is_shortened_to_the_file(lab, project, tmp_path):
    _, profiles = lab
    content = content_of(export(project, name="long sound", projects_root=tmp_path, prepare=False), profiles)
    segs = [s for t in content["tracks"] if t["type"] == "audio" for s in t["segments"]]
    whoosh = next(s for s in segs if s["target_timerange"]["start"] == 2000000)
    assert whoosh["target_timerange"]["duration"] <= 301000
    assert whoosh["source_timerange"]["duration"] == whoosh["target_timerange"]["duration"]
    assert "shortened" in report_of(project, "long sound")["whoosh"]["reason"]


def test_style_color_names_and_css_colors():
    colors = {"text": "#FFFFFF", "highlight": "#FFD100", "accent": "#FF6B35", "ink": "#0E0C0A"}
    assert color_of("accent", colors) == "#FF6B35"
    assert color_of("white", colors) == "#FFFFFF"
    assert color_of("#000", colors) == "#000000"


def test_one_image_used_full_and_contained_gets_two_materials_with_their_own_sizes(lab, project, tmp_path):
    _, profiles = lab
    tl_file = project / "renders" / "capcut" / "timeline.json"
    original = tl_file.read_text(encoding="utf-8")
    tl = json.loads(original)
    tl["elements"].append({"id": "pic2", "kind": "image", "layer": "front", "fromFrame": 100, "durationFrames": 10, "trimStartMs": 0,
                           "x": 0.5, "y": 0.5, "props": {"asset": "m", "fit": "contain"}})
    tl_file.write_text(json.dumps(tl, ensure_ascii=False), encoding="utf-8")
    try:
        content = content_of(export(project, name="two fits", projects_root=tmp_path, prepare=False), profiles)
    finally:
        tl_file.write_text(original, encoding="utf-8")
    photos = [m for m in content["materials"]["videos"] if m["type"] == "photo"]
    assert len({m["id"] for m in photos}) == 2
    segs = [s for t in content["tracks"] if t["name"].startswith("front") for s in t["segments"]]
    used = {s["material_id"] for s in segs}
    assert {m["id"] for m in photos} <= used
