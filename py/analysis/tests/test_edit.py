from media import color_video, ffmpeg

from adam_analysis.check import check_edit, check_proxy
from adam_analysis.probe import probe
from adam_analysis.steps.edit import edit_size, make_edit, make_proxy


def test_edit_size_keeps_the_aspect_with_a_1920_long_side():
    assert edit_size(2160, 3840) == (1080, 1920)
    assert edit_size(3840, 2160) == (1920, 1080)
    assert edit_size(1440, 1080) == (1920, 1440)


def test_edit_follows_the_contract(tmp_path):
    src = color_video(tmp_path / "src.mp4", "540x960", 3)
    make_edit(src, tmp_path / "edit.mp4", 30)
    info = probe(tmp_path / "edit.mp4")
    assert (info["width"], info["height"], info["fps"]) == (1080, 1920, 30)
    assert check_edit(tmp_path / "edit.mp4", 3000, 30, True) == []
    make_proxy(tmp_path / "edit.mp4", tmp_path / "proxy.mp4", 30)
    assert (probe(tmp_path / "proxy.mp4")["width"], probe(tmp_path / "proxy.mp4")["height"]) == (540, 960)
    assert check_proxy(tmp_path / "proxy.mp4", 30) == []


def test_a_rotated_phone_video_is_edited_upright(tmp_path):
    src = color_video(tmp_path / "landscape.mp4", "960x540", 1)
    phone = tmp_path / "phone.mp4"
    ffmpeg("-display_rotation:v:0", "-90", "-i", str(src), "-c", "copy", str(phone))
    make_edit(phone, tmp_path / "edit.mp4", 30)
    info = probe(tmp_path / "edit.mp4")
    assert (info["width"], info["height"], info["rotation"]) == (1080, 1920, 0)


def test_a_silent_source_gives_a_silent_edit(tmp_path):
    make_edit(color_video(tmp_path / "s.mp4", "540x960", 1, audio=False), tmp_path / "edit.mp4", 30)
    assert probe(tmp_path / "edit.mp4")["hasAudio"] is False
