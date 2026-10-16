import json
from pathlib import Path

import pytest

from convert import (
    anchor_at, behind_words, build_project, captions_from_plan, output_starts, overlay_elements, sfx_used, sound_elements,
    story_from_keeps, style_1015, title_element, trimmed_name, words_from_transcript,
)

TRANSCRIPT = [
    {"clip": 1, "words": [{"w": " A", "start": 0.4, "end": 0.68}, {"w": " 23", "start": 0.68, "end": 0.88},
                          {"w": " ans", "start": 0.88, "end": 1.12}, {"w": " je", "start": 1.12, "end": 1.18}]},
    {"clip": 2, "words": [{"w": " Pour", "start": 0.7, "end": 0.9}, {"w": " le", "start": 2.2, "end": 2.4},
                          {"w": " contexte", "start": 2.9, "end": 3.4}]},
]
KEEPS = [{"clip": 1, "start": 0.5, "end": 1.2, "transition": "Blur"}, {"clip": 2, "start": 0.6, "end": 1.3}, {"clip": 2, "start": 2.1, "end": 3.5}]
LOOK = {"punch_in": 1.08, "drift": 0.004}
DURATIONS = {"tick": 120, "whoosh": 600, "glitch": 300, "swell_thump_800": 1500}


@pytest.fixture
def words():
    return words_from_transcript(TRANSCRIPT)


@pytest.fixture
def story():
    return story_from_keeps(KEEPS, LOOK)


def test_words_get_ids_text_and_milliseconds(words):
    assert words["c01"][1] == {"id": "c01.w1", "text": "23", "startMs": 680, "endMs": 880}
    assert [w["id"] for w in words["c02"]] == ["c02.w0", "c02.w1", "c02.w2"]


def test_a_word_ending_before_it_starts_is_clamped():
    assert words_from_transcript([{"clip": 3, "words": [{"w": " x", "start": 1.2, "end": 1.1}]}])["c03"][0]["endMs"] == 1200


def test_keeps_become_story_clips_with_alternating_punch_in_and_slides(story):
    assert [(c["id"], c["asset"], c["inMs"], c["outMs"], c["zoom"]["base"]) for c in story] == [
        ("k01", "c01", 500, 1200, 1.0), ("k02", "c02", 600, 1300, 1.08), ("k03", "c02", 2100, 3500, 1.0)]
    assert story[0]["transitionOut"] == {"kind": "subjectSlide", "durationMs": 540}
    assert "transitionOut" not in story[1]
    assert output_starts(story) == [0, 700, 1400]


def test_anchor_on_the_last_word_of_the_same_keep(words, story):
    assert anchor_at(words, story, "c02", 2950) == {"word": "c02.w2", "offsetMs": 50}


def test_anchor_falls_back_to_output_time_when_no_word_of_the_keep_precedes(words, story):
    assert anchor_at(words, story, "c02", 2150) == {"atMs": 1450}


def test_anchor_in_a_cut_part_is_an_error(words, story):
    with pytest.raises(ValueError, match="cut"):
        anchor_at(words, story, "c02", 1500)


def test_captions_are_anchored_on_the_words_they_cover(words):
    caps, skipped = captions_from_plan([
        {"clip": 1, "start": 0.55, "end": 1.12, "text": "At 23,", "yellow": ["23"]},
        {"clip": 2, "start": 0.8, "end": 1.0, "text": "For"},
        {"clip": 2, "start": 1.0, "end": 2.0, "text": "nothing here"},
    ], words)
    assert caps == [
        {"words": ["c01.w1", "c01.w2"], "text": "At 23,", "lang": "en", "highlight": ["23"]},
        {"words": ["c02.w0", "c02.w0"], "text": "For", "lang": "en"},
    ]
    assert skipped == ["nothing here"]


def test_title_and_behind_words():
    baked = {"title": {"kicker": "EPISODE 01", "phases": [
        {"start": 0.0, "end": 1.85, "lines": [{"text": "ONE"}, {"text": "TWO"}]},
        {"start": 1.85, "end": 3.6, "lines": [{"text": "THREE", "box": [255, 107, 53]}]}]},
        "words": [{"text": "CONTEXT", "start": 5.16, "end": 6.75}]}
    assert title_element(baked) == {
        "id": "title", "kind": "title", "anchor": {"atMs": 0}, "durationMs": 3600, "slot": "title",
        "props": {"kicker": "EPISODE 01", "phases": [
            {"startMs": 0, "endMs": 1850, "lines": [{"text": "ONE", "box": False}, {"text": "TWO", "box": False}]},
            {"startMs": 1850, "endMs": 3600, "lines": [{"text": "THREE", "box": True}]}]},
    }
    assert behind_words(baked) == [{
        "id": "word1", "kind": "text.behindSubject", "layer": "behind-subject", "anchor": {"atMs": 5160}, "durationMs": 1590,
        "position": {"x": 0.5, "y": 0.378}, "props": {"text": "CONTEXT", "color": "accent"},
    }]


def test_overlays_become_full_frame_images_with_their_sounds_in_track_order(words, story):
    overlays = [
        {"asset": "m1", "track": "2_ov_a", "at": 0.1, "end": 0.6, "intro": "RGB_Scanlines", "sfx": "tick", "sfx_volume": 0.45},
        {"asset": "frame", "track": "1_hud", "at": 0.0, "end": "total", "intro": "RGB_Scanlines"},
        {"asset": "n1", "track": "3_ov_b", "clip": 2, "t": 2.95, "dur": 0.5, "intro": "CRT_Bands", "outro": "Fade_Out"},
    ]
    els = overlay_elements(overlays, words, story, DURATIONS)
    assert [e["id"] for e in els] == ["hud01", "hud02", "hud02.sfx", "hud03"]
    assert els[0] == {"id": "hud01", "kind": "image", "anchor": {"atMs": 0}, "untilEnd": True,
                      "props": {"asset": "hud_frame", "fit": "full", "intro": "glitch"}}
    assert els[1]["durationMs"] == 500 and els[1]["anchor"] == {"atMs": 100}
    assert els[2] == {"id": "hud02.sfx", "kind": "sfx", "anchor": {"atMs": 100}, "durationMs": 120,
                      "props": {"asset": "sfx_tick", "volume": 0.45}}
    assert els[3]["anchor"] == {"word": "c02.w2", "offsetMs": 50}
    assert (els[3]["props"]["intro"], els[3]["props"]["outro"], els[3]["durationMs"]) == ("glitch", "fade", 500)


def test_sounds_hook_transitions_and_accents(story):
    sfx = {"hook": {"name": "swell_thump", "volume": 0.5, "src_start": 0.8},
           "transition": {"name": "whoosh", "volume": 0.4, "lead_s": 0.25},
           "accents": [{"at": 1.0, "name": "glitch", "volume": 0.28}, {"at": 2.0, "name": "swell_thump", "volume": 0.42, "src_start": 0.8}]}
    els = sound_elements(sfx, KEEPS, story, DURATIONS)
    assert [(e["id"], e["anchor"]["atMs"], e["props"]["asset"], e["durationMs"]) for e in els] == [
        ("sfx.hook", 0, "sfx_swell_thump_800", 1500),
        ("sfx.whoosh1", 450, "sfx_whoosh", 600),
        ("sfx.accent1", 1000, "sfx_glitch", 300),
        ("sfx.accent2", 2000, "sfx_swell_thump_800", 1500),
    ]
    assert trimmed_name("swell_thump", 0.8) == "swell_thump_800"
    plan = {"sfx": sfx, "overlays": [{"asset": "m1", "sfx": "tick"}]}
    assert sfx_used(plan) == {"swell_thump_800": ("swell_thump", 0.8), "whoosh": ("whoosh", 0.0), "glitch": ("glitch", 0.0), "tick": ("tick", 0.0)}


def test_style_uses_the_lab_look():
    s = style_1015("C:/fonts/indivisible.ttf")
    assert s["fonts"]["caption"] == {"family": "Indivisible", "file": "C:/fonts/indivisible.ttf", "capcutResourceId": "7181740482383319553"}
    assert (s["grade"]["vignette"], s["caption"]["size"], s["slots"]["9:16"]["caption"]) == (0.25, 0.0525, {"x": 0.5, "y": 0.76})


LAB = Path.home() / "ClaudeCapcut" / "work"


@pytest.mark.skipif(not (LAB / "1015" / "plan_v2.json").exists(), reason="the ClaudeCapcut lab is not on this machine")
def test_the_real_lab_plan_converts_completely(tmp_path):
    lab = LAB / "1015"
    read = lambda f: json.loads((lab / f).read_text(encoding="utf-8"))
    plan = read("plan_v2.json")
    durations = {name: 500 for name in sfx_used(plan)}
    project, skipped = build_project(read("manifest.json"), read("transcript.json"), plan, durations, lab / "hud", LAB / "sfx", tmp_path)
    assert len(project["story"]) == 13
    assert len(project["captions"]) + len(skipped) == 51
    assert sum(e["kind"] == "image" for e in project["elements"]) == 25
    assert sum(e["kind"] == "text.behindSubject" for e in project["elements"]) == 4
    assert {a["kind"] for a in project["assets"]} == {"video", "image", "audio"}
