from adam_capcut.layout import main_track, part_frames
from adam_capcut.tracks import allocate

CLIPS = {"clips": [{"id": "c1", "fromFrame": 0, "durationFrames": 60}, {"id": "c2", "fromFrame": 60, "durationFrames": 60}]}
BAKES = [{"id": "b01", "fromFrame": 9, "toFrame": 27}, {"id": "b02", "fromFrame": 53, "toFrame": 71}]


def describe(parts):
    return [(p["clip"]["id"] if p["kind"] == "clip" else p["bake"]["id"], *part_frames(p)) for p in parts]


def test_native_parts_surround_each_bake_once():
    assert describe(main_track(CLIPS, BAKES)) == [
        ("c1", 0, 9), ("b01", 9, 27), ("c1", 27, 53), ("b02", 53, 71), ("c2", 71, 120),
    ]


def test_parts_cover_the_timeline_without_gaps():
    frames = [part_frames(p) for p in main_track(CLIPS, BAKES)]
    assert frames[0][0] == 0 and frames[-1][1] == 120
    assert all(a[1] == b[0] for a, b in zip(frames, frames[1:]))


def test_a_bake_can_cover_a_whole_clip():
    assert describe(main_track(CLIPS, [{"id": "b01", "fromFrame": 60, "toFrame": 120}])) == [("c1", 0, 60), ("b01", 60, 120)]


def test_no_bakes_gives_one_part_per_clip():
    assert describe(main_track(CLIPS, [])) == [("c1", 0, 60), ("c2", 60, 120)]


def test_overlapping_spans_get_their_own_tracks():
    assert allocate([(0, 10), (5, 15), (10, 20), (12, 13)]) == [0, 1, 0, 2]
    assert allocate([]) == []
