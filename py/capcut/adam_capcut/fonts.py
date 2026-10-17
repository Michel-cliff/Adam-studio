"""Each CapCut text gets the style font of its role, written like CapCut does (lab: build_edit.py apply_font)."""
import json


def material_shadow(m: dict) -> list | None:
    """The text's shadow (its material fields) as a style shadow, written the way pyJianYingDraft writes it."""
    if not m.get("has_shadow"):
        return None
    color = m.get("shadow_color", "#000000")
    return [{
        "diffuse": m.get("shadow_smoothing", 0) / 3 / 6,
        "angle": m.get("shadow_angle", -45.0),
        "content": {"solid": {"color": [int(color[1:3], 16) / 255, int(color[3:5], 16) / 255, int(color[5:7], 16) / 255]}},
        "distance": m.get("shadow_distance", 5.0),
        "alpha": m.get("shadow_alpha", 0.9),
    }]


def apply_fonts(content: str, fonts: dict, roles: dict[str, str]) -> str:
    """fonts: {"caption": {path, family, resourceId}, "title": {...}}; roles: text material id to "caption" or "title".
    A font without a CapCut resource id is left to CapCut (its default font)."""
    d = json.loads(content)
    for m in d["materials"]["texts"]:
        # pyJianYingDraft shadows only its default range (none when a highlight starts the text): every range of
        # a shadowed text gets the shadow, whatever its font.
        shadow = material_shadow(m)
        if shadow:
            c = json.loads(m["content"])
            for st in c.get("styles", []):
                st["shadows"] = shadow
            m["content"] = json.dumps(c, ensure_ascii=False)
        font = fonts.get(roles.get(m["id"], ""), {})
        rid = font.get("resourceId")
        if not rid:
            continue
        path = font["path"].replace("\\", "/")
        m["font_path"] = path
        m["font_resource_id"] = rid
        m["font_id"] = ""
        m["fonts"] = [{
            "id": m["id"] + "-font", "resource_id": rid, "third_resource_id": "", "category_id": "preset",
            "category_name": "Presets", "source_platform": 1, "path": path, "effect_id": rid,
            "title": font["family"], "team_id": "", "file_uri": "", "request_id": "",
        }]
        c = json.loads(m["content"])
        for st in c.get("styles", []):
            st["font"] = {"path": path, "id": rid}
        m["content"] = json.dumps(c, ensure_ascii=False)
    return json.dumps(d, ensure_ascii=False)
