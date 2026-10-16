import json

import pytest

from adam_capcut.lab import lab_path, load_lab
from helpers import ffmpeg, plan_dict, system_font, timeline_dict

H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac"]


@pytest.fixture(scope="session")
def lab():
    if not (lab_path() / "pyJianYingDraft").is_dir():
        pytest.skip(f"pyJianYingDraft lab not found at {lab_path()} (set ADAM_CAPCUT_LAB)")
    return load_lab()


@pytest.fixture(scope="session")
def project(tmp_path_factory):
    """A project folder (a space and an accent in its path) with source media and a prepared renders/capcut."""
    root = tmp_path_factory.mktemp("adam capcut") / "projet démo"
    src = root / "media-src"
    prep = root / "renders" / "capcut"
    for d in (src, prep / "bake", prep / "overlay"):
        d.mkdir(parents=True)
    # Gray, so the warmth applied to the copied take is measurable.
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", *H264, str(src / "edit.mp4"))
    ffmpeg("-f", "lavfi", "-i", "color=c=magenta:s=1080x1920", "-frames:v", "1", str(src / "magenta.png"))
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", str(src / "beep.wav"))
    for b in ("b01", "b02"):
        ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=1080x1920:r=30:d=0.6", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.6", *H264, str(prep / "bake" / f"{b}.mp4"))
    ffmpeg("-f", "lavfi", "-i", "color=c=black@0.0:s=1080x1920:r=30:d=0.5", "-vf", "format=rgba",
           "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", str(prep / "overlay" / "o01.mov"))
    font = system_font()
    (prep / "timeline.json").write_text(json.dumps(timeline_dict(font), ensure_ascii=False), encoding="utf-8")
    (prep / "capcut-plan.json").write_text(json.dumps(plan_dict(src, font), ensure_ascii=False), encoding="utf-8")
    return root
