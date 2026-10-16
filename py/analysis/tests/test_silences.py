from adam_analysis.steps.silences import parse_silencedetect, pauses_from_words


def test_pauses_are_gaps_between_words_longer_than_350_ms():
    words = [{"startMs": 0, "endMs": 400}, {"startMs": 500, "endMs": 900}, {"startMs": 1400, "endMs": 1600}]
    assert pauses_from_words(words) == [{"startMs": 900, "endMs": 1400}]


def test_silencedetect_output_is_parsed():
    stderr = ("[silencedetect @ 0x1] silence_start: 1.25\n"
              "[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.25\n"
              "[silencedetect @ 0x1] silence_start: 4\n")
    assert parse_silencedetect(stderr, 5000) == [{"startMs": 1250, "endMs": 2500}, {"startMs": 4000, "endMs": 5000}]
