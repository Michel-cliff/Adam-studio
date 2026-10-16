import subprocess

import pytest

from check_cache import check_asset, max_keyframe_gap

SIZE = "1080x1920"


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="module")
def good(tmp_path_factory):
    d = tmp_path_factory.mktemp("good")
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", str(d / "edit.mp4"))
    ffmpeg("-f", "lavfi", "-i", f"color=c=black:s={SIZE}:r=30:d=3", "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(lt(X,540),255,0)'",
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", "30", "-auto-alt-ref", "0", "-deadline", "realtime", "-cpu-used", "8",
           str(d / "subject.webm"))
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}", "-frames:v", "1", str(d / "plate.png"))
    return d


def test_an_asset_meeting_the_contract_has_no_problem(good):
    assert max_keyframe_gap(good / "edit.mp4") == pytest.approx(1.0, abs=0.05)
    assert check_asset(good, 3000) == []


def test_names_each_broken_rule(good, tmp_path):
    for f in ("subject.webm",):
        (tmp_path / f).write_bytes((good / f).read_bytes())
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}:r=30:d=3", "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
           str(tmp_path / "edit.mp4"))
    problems = check_asset(tmp_path, 3000)
    assert "plate.png is missing" in problems
    assert problems == ["plate.png is missing"]  # missing files are reported first, alone
    ffmpeg("-f", "lavfi", "-i", f"color=c=gray:s={SIZE}", "-frames:v", "1", str(tmp_path / "plate.png"))
    problems = check_asset(tmp_path, 3000)
    assert "edit.mp4 has B-frames" in problems
    assert "edit.mp4 has no audio" in problems
    assert any(p.startswith("edit.mp4 has") and "between keyframes" in p for p in problems)


def test_a_matte_without_alpha_is_reported(good, tmp_path):
    for f in ("edit.mp4", "plate.png"):
        (tmp_path / f).write_bytes((good / f).read_bytes())
    ffmpeg("-f", "lavfi", "-i", f"color=c=black:s={SIZE}:r=30:d=3", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-g", "30",
           "-deadline", "realtime", "-cpu-used", "8", str(tmp_path / "subject.webm"))
    assert check_asset(tmp_path, 3000) == ["subject.webm has no alpha channel"]
