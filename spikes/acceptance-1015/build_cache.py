"""Builds the analysis cache of the 1015 project (spec section 9), adapting the lab's compose.py.

For each lab clip: edit.mp4 (1080x1920, 30 fps, a keyframe every second, no B-frames, audio), subject.webm
(the person cut out with RobustVideoMatting, VP9 alpha, same timing and size) and plate.png (the room without
the person, from ungraded frames: the renderer grades it). Finished files are skipped unless --force.

Run with the lab's .tools venv (torch, cv2, simple-lama-inpainting):
  C:\\Users\\miche\\ClaudeCapcut\\.tools\\Scripts\\python.exe spikes/acceptance-1015/build_cache.py
"""
import argparse
import json
import subprocess
import sys
import time
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

W, H, FPS = 1080, 1920, 30
torch.set_num_threads(6)  # lab measurement: 6 threads about 5x faster than 12 on this CPU (oversubscription)


def make_edit(src: Path, dst: Path) -> None:
    """The take at canvas size, following the GOP rule. No -shortest: the video keeps its last partial frame."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", f"scale={W}:{H}:flags=lanczos", "-r", str(FPS),
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-g", str(FPS), "-bf", "0", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", str(dst)],
        check=True,
    )


def frames(src: Path):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = W * H * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    p.stdout.close()
    p.wait()


_rvm = None


def rvm():
    global _rvm
    if _rvm is None:
        _rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "mobilenetv3", trust_repo=True).eval()
    return _rvm


class Matter:
    """Stateful matting (RVM is recurrent: feed consecutive frames) at reduced size, upsampled (lab: compose.py)."""

    def __init__(self, res=(540, 960), ratio=0.375):
        self.rec = [None] * 4
        self.res, self.ratio = res, ratio

    @torch.inference_mode()
    def __call__(self, rgb):
        small = cv2.resize(rgb, self.res, interpolation=cv2.INTER_AREA)
        src = torch.from_numpy(small).permute(2, 0, 1).float().unsqueeze(0) / 255.0
        _, pha, *self.rec = rvm()(src, *self.rec, downsample_ratio=self.ratio)
        return cv2.resize(pha[0, 0].numpy(), (W, H), interpolation=cv2.INTER_LINEAR)


def make_subject(edit: Path, dst: Path) -> int:
    """The take with the matte as alpha, VP9 with a keyframe every second."""
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-g", str(FPS), "-auto-alt-ref", "0",
         "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", str(dst)],
        stdin=subprocess.PIPE,
    )
    matter, n = Matter(), 0
    for f in frames(edit):
        alpha = (np.clip(matter(f), 0, 1) * 255).astype(np.uint8)
        enc.stdin.write(np.dstack([f, alpha]).tobytes())
        n += 1
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed writing {dst}")
    return n


def make_plate(edit: Path, dst: Path) -> None:
    """The room without the person: per-pixel median of unoccluded samples, LaMa for the never-seen part (lab: compose.py
    clean_plate, here on ungraded frames)."""
    matter = Matter(res=(270, 480), ratio=1.0)  # coarse matte is enough: it gets dilated anyway
    samples, masks = [], []
    for i, f in enumerate(frames(edit)):
        if i % 3:
            continue
        a = matter(f)
        if i % 6 == 0 and i > 8:  # let the recurrent matte settle first
            samples.append(f)
            masks.append(cv2.dilate((a > 0.03).astype(np.uint8), np.ones((31, 31), np.uint8)))
    stack = np.stack(samples)
    occluded = np.stack(masks).astype(bool)
    med = np.zeros((H, W, 3), np.float32)
    for r0 in range(0, H, 96):  # median in strips: float copies stay around 100 MB
        s = stack[:, r0:r0 + 96].astype(np.float32)
        s[occluded[:, r0:r0 + 96]] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med[r0:r0 + 96] = np.nanmedian(s, axis=0)
    hole = np.isnan(med[..., 0])
    med = np.nan_to_num(med).astype(np.uint8)
    from simple_lama_inpainting import SimpleLama

    hole_mask = cv2.dilate(hole.astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
    filled = np.array(SimpleLama()(Image.fromarray(med), Image.fromarray(hole_mask).convert("L")).convert("RGB"))[:H, :W]
    Image.fromarray(np.where(hole_mask[..., None] > 0, filled, med)).save(dst)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(Path.home() / "AdamStudioProjects" / "1015"))
    parser.add_argument("--lab", default=str(Path.home() / "ClaudeCapcut" / "work"))
    parser.add_argument("--force", action="store_true", help="rebuild files that already exist")
    args = parser.parse_args()
    manifest = json.loads((Path(args.lab) / "1015" / "manifest.json").read_text(encoding="utf-8"))
    for clip in manifest:
        cache = Path(args.project) / "cache" / f"c{clip['i']:02d}"
        cache.mkdir(parents=True, exist_ok=True)
        steps = (("edit.mp4", lambda d: make_edit(Path(clip["file"]), d)),
                 ("subject.webm", lambda d: make_subject(cache / "edit.mp4", d)),
                 ("plate.png", lambda d: make_plate(cache / "edit.mp4", d)))
        for name, make in steps:
            dst = cache / name
            if dst.exists() and not args.force:
                print(f"{cache.name}/{name}: kept")
                continue
            t0 = time.time()
            tmp = dst.with_name("tmp-" + name)
            make(tmp)
            tmp.replace(dst)  # a file only exists once complete: an interrupted run resumes cleanly
            print(f"{cache.name}/{name}: {time.time() - t0:.0f} s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
