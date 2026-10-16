import pytest

from adam_capcut.titles import big_word_text, fit_font_size, title_texts

TITLE = {
    "id": "t1", "kind": "title", "layer": "front", "fromFrame": 90, "durationFrames": 24, "trimStartMs": 0, "x": 0.5, "y": 0.3,
    "props": {"kicker": "EPISODE 3", "phases": [
        {"startMs": 0, "endMs": 400, "lines": [{"text": "QUI VEUT", "box": False, "sizeScale": 1}, {"text": "M'EMBAUCHER ?", "box": True, "sizeScale": 1}]},
        {"startMs": 400, "endMs": 800, "lines": [{"text": "PERSONNE", "box": False, "sizeScale": 1.2}]},
    ]},
}


def test_fit_font_size_matches_the_renderer():
    assert fit_font_size("VEUT", 972, 151) == 151
    assert fit_font_size("M'EMBAUCHER ?", 972, 151) == 124


def test_title_lines_are_stacked_like_the_renderer_and_start_with_their_reveal():
    texts = title_texts(TITLE, 1080, 1920, 30)
    assert [(t["role"], t["text"], t["from"], t["to"], t["box"], t["color"]) for t in texts] == [
        ("kicker", "EPISODE 3", 90, 102, False, "accent"),
        ("line", "QUI VEUT", 92, 102, False, "ink"),
        ("line", "M'EMBAUCHER ?", 97, 102, True, "ink"),
        ("line", "PERSONNE", 104, 114, False, "ink"),
    ]
    assert [t["px"] for t in texts] == pytest.approx([32.4, 151.2, 124, 181.44])
    assert [t["y"] for t in texts] == pytest.approx([433 / 1920, 535.6 / 1920, 673.2 / 1920, 0.3])


def test_a_title_clamped_at_the_start_skips_what_was_cut():
    clamped = {**TITLE, "fromFrame": 0, "durationFrames": 12, "trimStartMs": 400}
    assert [(t["text"], t["from"], t["to"]) for t in title_texts(clamped, 1080, 1920, 30)] == [("PERSONNE", 2, 12)]


def test_big_word():
    word = {"id": "big", "fromFrame": 45, "durationFrames": 9, "x": 0.5, "y": 0.5, "props": {"text": "WOW", "color": "accent", "sizeScale": 1}}
    t = big_word_text(word, 1080, 1920)
    assert (t["text"], t["from"], t["to"], t["color"], t["y"]) == ("WOW", 45, 54, "accent", 0.5)
    assert t["px"] == pytest.approx(226.8)
