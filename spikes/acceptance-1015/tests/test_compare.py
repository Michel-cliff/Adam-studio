from compare import keep_at

STORY = [{"inMs": 500, "outMs": 1200}, {"inMs": 600, "outMs": 1300}, {"inMs": 2100, "outMs": 3500}]


def test_finds_the_keep_playing_at_an_output_time():
    assert keep_at(STORY, 0) == (0, 0)
    assert keep_at(STORY, 800) == (1, 100)
    assert keep_at(STORY, 2700) == (2, 1300)
    assert keep_at(STORY, 2800) is None
