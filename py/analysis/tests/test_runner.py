import json
import os
import time

from media import color_video

from adam_analysis.runner import run


def test_runs_steps_writes_probe_and_manifest(tmp_path):
    src = color_video(tmp_path / "take one é.mp4", "540x960", 2)
    done = run(tmp_path / "project", {"c01": src}, ["proxy"])
    cache = tmp_path / "project" / "cache" / "c01"
    assert done == {"c01": ["edit", "proxy"]}
    assert (cache / "edit.mp4").is_file() and (cache / "proxy.mp4").is_file()
    assert json.loads((cache / "probe.json").read_text(encoding="utf-8"))["width"] == 1080
    manifest = json.loads((cache / "manifest.json").read_text(encoding="utf-8"))
    assert set(manifest["steps"]) == {"edit", "proxy"}
    assert not list(cache.glob("tmp-*"))


def test_a_second_run_keeps_finished_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["proxy"])
    assert run(tmp_path / "p", {"c01": src}, ["proxy"]) == {"c01": []}


def test_a_changed_source_redoes_its_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["proxy"])
    later = time.time() + 5
    os.utime(src, (later, later))
    assert run(tmp_path / "p", {"c01": src}, ["proxy"]) == {"c01": ["edit", "proxy"]}


def test_force_redoes_the_asked_steps(tmp_path):
    src = color_video(tmp_path / "a.mp4", "540x960", 1)
    run(tmp_path / "p", {"c01": src}, ["edit"])
    assert run(tmp_path / "p", {"c01": src}, ["edit"], force=True) == {"c01": ["edit"]}
