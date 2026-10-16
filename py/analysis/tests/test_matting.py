import json

import cv2
import pytest
from media import ffmpeg

from adam_analysis.check import check_plate, check_subject
from adam_analysis.runner import run


@pytest.mark.slow
def test_subject_and_plate_follow_the_contract_and_the_plate_hides_what_moves(tmp_path):
    # A blue background with a white square crossing it: the median over time is the background.
    src = tmp_path / "moving.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=540x960:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
           "-vf", "drawbox=x='t*120':y=400:w=120:h=120:color=white:t=fill", "-c:v", "libx264", "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-c:a", "aac", str(src))
    run(tmp_path / "p", {"c01": src}, ["subject", "plate"])
    cache = tmp_path / "p" / "cache" / "c01"
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    assert check_subject(cache / "subject.webm", info, 30) == []
    assert check_plate(cache / "plate.png", info) == []
    plate = cv2.imread(str(cache / "plate.png"))
    b, g, r = plate[int(460 * 2), int(300 * 2)]  # on the square's path, in edit.mp4 coordinates (2x the source)
    assert b > 150 and r < 80, f"the plate shows the background, got {(r, g, b)}"
