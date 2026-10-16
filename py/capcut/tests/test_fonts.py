import json

from adam_capcut.fonts import apply_fonts

FONTS = {
    "caption": {"path": "C:\\fonts\\a.ttf", "family": "A", "resourceId": "42"},
    "title": {"path": "C:/fonts/b.ttf", "family": "B", "resourceId": "43"},
}


def test_each_text_gets_the_font_of_its_role_and_every_range_is_shadowed():
    styles = [{"range": [0, 4], "shadows": [{"x": 1}]}, {"range": [4, 8]}]
    texts = [{"id": "cap", "content": json.dumps({"styles": styles})}, {"id": "tit", "content": json.dumps({"styles": [{"range": [0, 3]}]})}]
    out = json.loads(apply_fonts(json.dumps({"materials": {"texts": texts}}), FONTS, {"cap": "caption", "tit": "title"}))
    cap, tit = out["materials"]["texts"]
    assert (cap["font_path"], cap["font_resource_id"], cap["fonts"][0]["title"]) == ("C:/fonts/a.ttf", "42", "A")
    assert (tit["font_path"], tit["font_resource_id"], tit["fonts"][0]["title"]) == ("C:/fonts/b.ttf", "43", "B")
    styled = json.loads(cap["content"])["styles"]
    assert [st["font"] for st in styled] == [{"path": "C:/fonts/a.ttf", "id": "42"}] * 2
    assert styled[1]["shadows"] == [{"x": 1}]


def test_a_font_without_capcut_resource_id_is_left_to_capcut():
    content = json.dumps({"materials": {"texts": [{"id": "cap", "content": "{}"}]}})
    fonts = {**FONTS, "caption": {"path": "x", "family": "A", "resourceId": None}}
    assert json.loads(apply_fonts(content, fonts, {"cap": "caption"})) == json.loads(content)
