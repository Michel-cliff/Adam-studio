from pathlib import Path

import pytest

from adam_capcut.errors import ExportError
from adam_capcut.export import export
from helpers import content_of, report_of


def test_main_track_is_contiguous_and_uses_the_baked_stretches(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="main track", projects_root=tmp_path, prepare=False)
    content = content_of(dest, profiles)
    main = next(t for t in content["tracks"] if t["name"] == "main")
    ranges = [(s["target_timerange"]["start"], s["target_timerange"]["duration"]) for s in main["segments"]]
    assert ranges == [(0, 300000), (300000, 600000), (900000, 866667), (1766667, 600000), (2366667, 1633333)]
    # c2 resumes 366.7 ms into its own source range, which starts at 2000 ms.
    assert main["segments"][4]["source_timerange"]["start"] == 2366667
    assert main["segments"][4]["volume"] == 0.8
    kinds = {k["property_type"] for s in main["segments"] for k in s["common_keyframes"]}
    assert {"KFTypeScaleX", "KFTypeBrightness", "KFTypeContrast", "KFTypeSaturation"} <= kinds
    assert [c["type"] for c in content["materials"]["canvases"]] == ["canvas_blur"]


def test_every_media_file_is_copied_inside_the_capcut_project(lab, project, tmp_path):
    _, profiles = lab
    dest = export(project, name="media", projects_root=tmp_path, prepare=False)
    content = content_of(dest, profiles)
    paths = [m["path"] for m in content["materials"]["videos"] + content["materials"].get("audios", [])]
    assert paths
    for p in paths:
        assert Path(p).exists() and Path(p).resolve().is_relative_to(dest.resolve())


def test_report_lists_native_and_baked_items(lab, project, tmp_path):
    export(project, name="report", projects_root=tmp_path, prepare=False)
    r = report_of(project, "report")
    assert r["clip:c1"]["status"] == "native"
    assert r["bake:b01"]["status"] == "baked"
    assert r["behind"]["status"] == "baked"
    assert r["transition:c1"]["status"] == "baked"


def test_uses_a_safe_folder_name(lab, project, tmp_path):
    dest = export(project, projects_root=tmp_path, prepare=False)
    assert dest.name == "synthétique - test"
    assert (project / "renders" / "synthétique - test.capcut-report.json").exists()


def test_refuses_a_project_it_did_not_create(lab, project, tmp_path):
    mine = tmp_path / "mine"
    mine.mkdir()
    (mine / "keep.txt").write_text("x")
    with pytest.raises(ExportError, match="was not created by Adam Studio"):
        export(project, name="mine", projects_root=tmp_path, prepare=False)
    assert (mine / "keep.txt").read_text() == "x"


def test_rebuilds_its_own_project_but_not_while_it_is_open(lab, project, tmp_path):
    dest = export(project, name="again", projects_root=tmp_path, prepare=False)
    export(project, name="again", projects_root=tmp_path, prepare=False)
    (dest / ".locked").touch()
    with pytest.raises(ExportError, match="is open in CapCut"):
        export(project, name="again", projects_root=tmp_path, prepare=False)
