from media import color_video, ffmpeg

from adam_analysis.probe import probe


def test_probe_reads_duration_size_fps_and_audio(tmp_path):
    info = probe(color_video(tmp_path / "a.mp4", "640x360", 2))
    assert (info["width"], info["height"], info["fps"], info["hasAudio"], info["rotation"]) == (640, 360, 30, True, 0)
    assert abs(info["durationMs"] - 2000) <= 50


def test_probe_reports_the_displayed_size_of_a_rotated_video(tmp_path):
    src = color_video(tmp_path / "landscape.mp4", "640x360", 1)
    rotated = tmp_path / "phone.mp4"
    ffmpeg("-display_rotation:v:0", "-90", "-i", str(src), "-c", "copy", str(rotated))
    info = probe(rotated)
    assert (info["width"], info["height"]) == (360, 640)
    assert info["rotation"] in (90, -90, 270)


def test_probe_without_audio(tmp_path):
    assert probe(color_video(tmp_path / "silent.mp4", "640x360", 1, audio=False))["hasAudio"] is False
