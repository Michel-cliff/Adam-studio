import json

import pytest

from adam_capcut.fonts import apply_fonts

FONTS = {
    "caption": {"path": "C:\\fonts\\a.ttf", "family": "A", "resourceId": "42"},
    "title": {"path": "C:/fonts/b.ttf", "family": "B", "resourceId": "43"},
}


def test_each_text_gets_the_font_of_its_role_and_every_range_is_shadowed():
    styles = [{"range": [0, 4]}, {"range": [4, 8]}]
    shadow = {"has_shadow": True, "shadow_alpha": 0.55, "shadow_angle": -60.0, "shadow_color": "#000000", "shadow_distance": 4.0, "shadow_smoothing": 1.8}
    texts = [{"id": "cap", "content": json.dumps({"styles": styles}), **shadow}, {"id": "tit", "content": json.dumps({"styles": [{"range": [0, 3]}]})}]
    out = json.loads(apply_fonts(json.dumps({"materials": {"texts": texts}}), FONTS, {"cap": "caption", "tit": "title"}))
    cap, tit = out["materials"]["texts"]
    assert (cap["font_path"], cap["font_resource_id"], cap["fonts"][0]["title"]) == ("C:/fonts/a.ttf", "42", "A")
    assert (tit["font_path"], tit["font_resource_id"], tit["fonts"][0]["title"]) == ("C:/fonts/b.ttf", "43", "B")
    styled = json.loads(cap["content"])["styles"]
    assert [st["font"] for st in styled] == [{"path": "C:/fonts/a.ttf", "id": "42"}] * 2
    assert [st["shadows"][0]["alpha"] for st in styled] == [0.55, 0.55]
    assert styled[0]["shadows"][0]["diffuse"] == pytest.approx(0.1)


def test_a_font_without_capcut_resource_id_is_left_to_capcut():
    content = json.dumps({"materials": {"texts": [{"id": "cap", "content": "{}"}]}})
    fonts = {**FONTS, "caption": {"path": "x", "family": "A", "resourceId": None}}
    assert json.loads(apply_fonts(content, fonts, {"cap": "caption"})) == json.loads(content)
