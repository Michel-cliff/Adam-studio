import pytest

from adam_capcut.errors import ExportError

from adam_capcut.units import (
    cover_scale, crop_rect_at, crop_transform, frame_us, hex_rgb, image_scale, ms_us, place, safe_name, span_us, to_hex, warmth_filter, zoom_at,
)

PORTRAIT = (1080, 1920)
LANDSCAPE = (1920, 1080)


def test_times_come_from_accumulated_frames():
    assert frame_us(1, 30) == 33333
    assert span_us(9, 27, 30) == (300000, 600000)
    assert span_us(27, 53, 30) == (900000, 866667)
    assert ms_us(150) == 150000


def test_colors_and_positions():
    assert hex_rgb("#FFD100") == pytest.approx((1.0, 209 / 255, 0.0))
    # The lab's captions sat at transform_y -0.52: the style's caption slot y = 0.76.
    assert place(0.5, 0.76) == pytest.approx((0.0, -0.52))
    assert place(0.0, 0.0) == pytest.approx((-1.0, 1.0))


def test_cover_scale_is_relative_to_capcut_fit():
    assert cover_scale(PORTRAIT, PORTRAIT) == 1
    assert cover_scale(LANDSCAPE, PORTRAIT) == pytest.approx((1920 / 1080) / (1080 / 1920))


def test_crop_transform_matches_the_renderer_crop_box():
    assert crop_transform({"x": 0, "y": 0, "w": 1, "h": 1}, PORTRAIT, PORTRAIT) == pytest.approx((1.0, 0.0, 0.0))
    assert crop_transform({"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}, PORTRAIT, PORTRAIT) == pytest.approx((2.0, 0.0, 0.0))
    # Right part of a 16:9 screen recording in a 9:16 canvas (renderer: box left -2160, width 4320).
    rect = {"x": 0.5, "y": 0, "w": 0.25, "h": 1}
    assert crop_transform(rect, LANDSCAPE, PORTRAIT) == pytest.approx((4.0, -1.0, 0.0))
    assert crop_transform(rect, LANDSCAPE, PORTRAIT, zoom=1.1) == pytest.approx((4.4, -1.1, 0.0))


def test_crop_rect_follows_keyframes_in_source_time():
    framing = {"mode": "crop", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}, "keyframes": [{"atMs": 1000, "rect": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}}]}
    assert crop_rect_at(framing, 500) == pytest.approx({"x": 0.125, "y": 0.125, "w": 0.75, "h": 0.75})
    assert crop_rect_at(framing, 2000) == {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}


def test_image_scale_matches_the_renderer_natural_size_capped_at_90_percent():
    assert image_scale(PORTRAIT, PORTRAIT) == pytest.approx(0.9)
    assert image_scale((540, 540), PORTRAIT) == pytest.approx(0.5)


def test_zoom_drift():
    assert zoom_at({"base": 1.08, "driftPerSec": 0.004}, 2500) == pytest.approx(1.09)


def test_safe_name_matches_the_renderer():
    assert safe_name("Épisode 3 : Jobless") == "Épisode 3 - Jobless"
    assert safe_name(r'a/b\c*d?e"f<g>h|i') == "a-b-c-d-e-f-g-h-i"
    assert safe_name("...") == "edit"
    assert safe_name("final. ") == "final"


def test_warmth_filter_is_the_renderer_color_matrix():
    assert warmth_filter(0.35) == "colorchannelmixer=rr=1.042:gg=1.007:bb=0.951"


def test_colors_accept_short_hex_and_css_names_like_the_renderer():
    assert to_hex("white") == "#FFFFFF"
    assert to_hex("#000") == "#000000"
    assert to_hex("#ff6b35") == "#FF6B35"
    assert to_hex("#00000080") == "#000000"
    assert hex_rgb("white") == (1.0, 1.0, 1.0)
    with pytest.raises(ExportError, match="rgb"):
        to_hex("rgb(1, 2, 3)")


def test_crop_moves_are_sampled_so_capcut_linear_keyframes_follow_the_renderer():
    from adam_capcut.units import crop_rect_at, crop_sample_times, crop_transform
    framing = {"mode": "crop", "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
               "keyframes": [{"atMs": 2000, "rect": {"x": 0.3, "y": 0.2, "w": 0.3, "h": 0.3}}]}
    source, canvas = (1920, 1080), (1080, 1920)
    times = crop_sample_times(framing, 0, 0, 3000)
    assert times[0] == 0 and 2000 in times and times[-1] == 3000
    assert len(times) > 10
    scale = lambda ms: crop_transform(crop_rect_at(framing, ms), source, canvas)[0]
    for a, b in zip(times, times[1:]):
        mid = (a + b) / 2
        linear = (scale(a) + scale(b)) / 2
        assert abs(linear - scale(mid)) / scale(mid) < 0.01, (a, b)
    # A clip without a move keeps two keyframes.
    assert crop_sample_times({"mode": "crop", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}, 0, 500, 1500) == [500, 1500]
