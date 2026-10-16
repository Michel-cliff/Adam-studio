from media import color_video, ffmpeg

from adam_analysis.check import check_edit, check_plate, check_subject, max_keyframe_gap
from adam_analysis.probe import probe


def good_edit(path):
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path))
    return path


def test_a_good_edit_has_no_problem(tmp_path):
    edit = good_edit(tmp_path / "edit.mp4")
    assert abs(max_keyframe_gap(edit) - 1.0) < 0.05
    assert check_edit(edit, 3000, 30, True) == []


def test_edit_problems_are_named(tmp_path):
    bad = tmp_path / "edit.mp4"  # x264 medium defaults: B-frames, one keyframe (ultrafast has no B-frames)
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=3", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", str(bad))
    problems = check_edit(bad, 3000, 30, True)
    assert "edit.mp4 has B-frames" in problems
    assert "edit.mp4 has no audio" in problems
    assert any("between keyframes" in p for p in problems)


def test_subject_and_plate_must_match_the_edit(tmp_path):
    edit = good_edit(tmp_path / "edit.mp4")
    info = probe(edit)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(lt(X,100),255,0)'",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", "30", "-auto-alt-ref", "0", "-deadline", "realtime", "-cpu-used", "8",
           str(tmp_path / "subject.webm"))
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", str(tmp_path / "plate.png"))
    assert check_subject(tmp_path / "subject.webm", info, 30) == []
    assert check_plate(tmp_path / "plate.png", info) == []
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=100x100", "-frames:v", "1", str(tmp_path / "small.png"))
    assert check_plate(tmp_path / "small.png", info) == ["plate.png is 100x100, the edit 1080x1920"]
