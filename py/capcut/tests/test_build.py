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


def _with_plan(project, change):
    f = project / "renders" / "capcut" / "capcut-plan.json"
    original = f.read_text(encoding="utf-8")
    plan = json.loads(original)
    change(plan)
    f.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    return lambda: f.write_text(original, encoding="utf-8")


def test_a_clip_inside_a_bake_is_reported_baked(lab, project, tmp_path):
    restore = _with_plan(project, lambda plan: plan.update(bakes=[{"id": "b01", "fromFrame": 0, "toFrame": 60, "file": "bake/b01.mp4"}]))
    try:
        export(project, name="inside bake", projects_root=tmp_path, prepare=False)
    finally:
        restore()
    r = report_of(project, "inside bake")
    assert r["clip:c1"]["status"] == "baked" and "b01" in r["clip:c1"]["reason"]
    assert r["clip:c2"]["status"] == "native"


def test_the_exporter_refuses_native_kinds_it_cannot_build(lab, project, tmp_path):
    from adam_capcut.errors import ExportError
    restore = _with_plan(project, lambda plan: plan.update(nativeKinds=["image", "title", "text.behindSubject", "hud.panel"]))
    try:
        with pytest.raises(ExportError, match="hud.panel"):
            export(project, name="kinds", projects_root=tmp_path, prepare=False)
    finally:
        restore()


def test_warmed_takes_are_reused_across_exports_and_skipped_when_only_baked(lab, project, tmp_path, monkeypatch, capsys):
    import shutil
    import adam_capcut.media as media
    shutil.rmtree(project / "renders" / ".capcut-warm", ignore_errors=True)
    calls = []
    real = media.warm_copy
    monkeypatch.setattr(media, "warm_copy", lambda *a, **k: (calls.append(a[0]), real(*a, **k)))
    export(project, name="warm 1", projects_root=tmp_path, prepare=False)
    export(project, name="warm 2", projects_root=tmp_path, prepare=False)
    assert len(calls) == 1
    out = capsys.readouterr().err
    assert "warming take s" in out and "reusing the warmed take s" in out
    calls.clear()
    restore = _with_plan(project, lambda plan: plan.update(bakes=[{"id": "b01", "fromFrame": 0, "toFrame": 120, "file": "bake/b01.mp4"}]))
    try:
        export(project, name="all baked", projects_root=tmp_path, prepare=False)
    finally:
        restore()
    assert calls == []


@pytest.mark.parametrize("with_font_id", [True, False])
def test_every_range_of_every_caption_has_the_shadow(lab, project, tmp_path, with_font_id):
    _, profiles = lab
    tl_file = project / "renders" / "capcut" / "timeline.json"
    original = tl_file.read_text(encoding="utf-8")
    tl = json.loads(original)
    tl["captions"].append({"id": "cap2", "fromFrame": 60, "durationFrames": 30, "text": "boîte noire", "highlightRanges": [[0, 5]], "x": 0.5, "y": 0.76})
    tl_file.write_text(json.dumps(tl, ensure_ascii=False), encoding="utf-8")

    def no_font_ids(plan):
        for f in plan["fonts"].values():
            f["resourceId"] = None
    restore = _with_plan(project, (lambda plan: None) if with_font_id else no_font_ids)
    try:
        content = content_of(export(project, name=f"shadows {with_font_id}", projects_root=tmp_path, prepare=False), profiles)
    finally:
        restore()
        tl_file.write_text(original, encoding="utf-8")
    texts = texts_by_string(content)
    for key in ("créé\nma boîte", "boîte noire"):
        styles = json.loads(texts[key]["content"])["styles"]
        assert len(styles) >= 2, key
        assert all(st.get("shadows") for st in styles), (key, [bool(st.get("shadows")) for st in styles])
