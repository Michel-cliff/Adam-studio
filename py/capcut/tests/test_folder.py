import pytest

from adam_capcut.errors import ExportError
from adam_capcut.folder import MARKER, prepare_project_dir
from adam_capcut.lab import lab_path, load_lab


@pytest.fixture
def template(tmp_path):
    t = tmp_path / "template"
    t.mkdir()
    (t / "draft_meta_info.json").write_text("{}")
    return t


def test_creates_the_project_from_the_template_with_the_marker(tmp_path, template):
    dest = prepare_project_dir(tmp_path / "projects", "demo", template)
    assert (dest / MARKER).exists() and (dest / "draft_meta_info.json").exists() and (dest / "media").is_dir()


def test_rebuilds_its_own_project(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / "media" / "old.mp4").write_text("x")
    dest = prepare_project_dir(tmp_path, "demo", template)
    assert not (dest / "media" / "old.mp4").exists()


def test_never_touches_a_project_it_did_not_create(tmp_path, template):
    mine = tmp_path / "demo"
    mine.mkdir()
    (mine / "keep.txt").write_text("x")
    with pytest.raises(ExportError, match="was not created by Adam Studio"):
        prepare_project_dir(tmp_path, "demo", template)
    assert (mine / "keep.txt").read_text() == "x"


def test_refuses_a_project_open_in_capcut(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / ".locked").touch()
    with pytest.raises(ExportError, match="is open in CapCut"):
        prepare_project_dir(tmp_path, "demo", template)
    assert (dest / ".locked").exists()


def test_names_the_lab_setting_when_pyjianyingdraft_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("ADAM_CAPCUT_LAB", str(tmp_path))
    assert lab_path() == tmp_path
    with pytest.raises(ExportError, match="ADAM_CAPCUT_LAB"):
        load_lab()


def test_refuses_a_project_opened_in_capcut_since_the_export_unless_replace(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / "draft_content.json").write_text("{}")  # CapCut writes it when it opens a project
    with pytest.raises(ExportError, match="opened in CapCut since"):
        prepare_project_dir(tmp_path, "demo", template)
    assert (dest / "draft_content.json").exists()
    dest = prepare_project_dir(tmp_path, "demo", template, replace=True)
    assert not (dest / "draft_content.json").exists()


def test_replace_never_overrides_an_open_or_foreign_project(tmp_path, template):
    dest = prepare_project_dir(tmp_path, "demo", template)
    (dest / ".locked").touch()
    with pytest.raises(ExportError, match="is open in CapCut"):
        prepare_project_dir(tmp_path, "demo", template, replace=True)
    (tmp_path / "mine").mkdir()
    with pytest.raises(ExportError, match="was not created by Adam Studio"):
        prepare_project_dir(tmp_path, "mine", template, replace=True)
