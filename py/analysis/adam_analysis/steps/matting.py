"""subject.webm (RobustVideoMatting cut-out with alpha) and plate.png (the room without the person)."""
import subprocess
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from ..errors import AnalysisError
from ..probe import probe

VERSION = 1
torch.set_num_threads(6)  # lab measurement: 6 threads about 5x faster than 12 on this CPU (oversubscription)
_rvm = None


def rvm():
    global _rvm
    if _rvm is None:
        try:
            _rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "mobilenetv3", trust_repo=True).eval()
        except Exception as e:
            raise AnalysisError(f"cannot load RobustVideoMatting (the first run downloads it, network needed): {e}") from None
    return _rvm


def frames(src: Path, w: int, h: int):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.stdout.close()
    if p.wait() != 0:
        raise AnalysisError(f"cannot decode {src}")


class Matter:
    """Stateful matting (RVM is recurrent: feed consecutive frames) at reduced size, upsampled."""

    def __init__(self, w: int, h: int, scale: float = 0.5, ratio: float = 0.375):
        self.rec = [None] * 4
        self.size, self.small, self.ratio = (w, h), (max(2, int(w * scale)), max(2, int(h * scale))), ratio

    @torch.inference_mode()
    def __call__(self, rgb):
        small = cv2.resize(rgb, self.small, interpolation=cv2.INTER_AREA)
        src = torch.from_numpy(small).permute(2, 0, 1).float().unsqueeze(0) / 255.0
        _, pha, *self.rec = rvm()(src, *self.rec, downsample_ratio=self.ratio)
        return cv2.resize(pha[0, 0].numpy(), self.size, interpolation=cv2.INTER_LINEAR)


def make_subject(edit: Path, dst: Path, fps: int) -> int:
    info = probe(edit)
    w, h = info["width"], info["height"]
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", str(fps), "-auto-alt-ref", "0",
         "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", str(dst)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    matter, n = Matter(w, h), 0
    for f in frames(edit, w, h):
        alpha = (np.clip(matter(f), 0, 1) * 255).astype(np.uint8)
        enc.stdin.write(np.dstack([f, alpha]).tobytes())
        n += 1
    enc.stdin.close()
    if enc.wait() != 0:
        raise AnalysisError(f"ffmpeg failed writing subject.webm: {enc.stderr.read().decode(errors='replace')[-300:]}")
    return n


def make_plate(edit: Path, dst: Path) -> None:
    """Per-pixel median of unoccluded samples, LaMa for the never-seen part (ungraded frames)."""
    info = probe(edit)
    w, h = info["width"], info["height"]
    matter = Matter(w, h, scale=0.25, ratio=1.0)  # coarse matte is enough: it gets dilated anyway
    samples, masks = [], []
    for i, f in enumerate(frames(edit, w, h)):
        if i % 3:
            continue
        a = matter(f)
        if i % 6 == 0 and i > 8:  # let the recurrent matte settle first
            samples.append(f)
            masks.append(cv2.dilate((a > 0.03).astype(np.uint8), np.ones((31, 31), np.uint8)))
    if not samples:
        raise AnalysisError("the take is too short for a clean plate (under half a second)")
    stack = np.stack(samples)
    occluded = np.stack(masks).astype(bool)
    med = np.zeros((h, w, 3), np.float32)
    for r0 in range(0, h, 96):  # median in strips: float copies stay around 100 MB
        s = stack[:, r0:r0 + 96].astype(np.float32)
        s[occluded[:, r0:r0 + 96]] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med[r0:r0 + 96] = np.nanmedian(s, axis=0)
    hole = np.isnan(med[..., 0])
    med = np.nan_to_num(med).astype(np.uint8)
    if hole.any():
        from simple_lama_inpainting import SimpleLama

        mask = cv2.dilate(hole.astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
        filled = np.array(SimpleLama()(Image.fromarray(med), Image.fromarray(mask).convert("L")).convert("RGB"))[:h, :w]
        med = np.where(mask[..., None] > 0, filled, med)
    Image.fromarray(med).save(dst, format="PNG")
