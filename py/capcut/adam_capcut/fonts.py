"""Each CapCut text gets the style font of its role, written like CapCut does (lab: build_edit.py apply_font)."""
import json


def apply_fonts(content: str, fonts: dict, roles: dict[str, str]) -> str:
    """fonts: {"caption": {path, family, resourceId}, "title": {...}}; roles: text material id to "caption" or "title".
    A font without a CapCut resource id is left to CapCut (its default font)."""
    d = json.loads(content)
    for m in d["materials"]["texts"]:
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
        # pyJianYingDraft only shadows the first color range of a multi-color text: shadow every range alike.
        shadow = next((st["shadows"] for st in c.get("styles", []) if st.get("shadows")), None)
        for st in c.get("styles", []):
            st["font"] = {"path": path, "id": rid}
            if shadow:
                st["shadows"] = shadow
        m["content"] = json.dumps(c, ensure_ascii=False)
    return json.dumps(d, ensure_ascii=False)
