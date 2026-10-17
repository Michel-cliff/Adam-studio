"""Runs the asked steps (and what they depend on) for each video, skipping fresh results."""
import json
import time
from pathlib import Path
from typing import Callable

from . import manifest
from .errors import AnalysisError
from .probe import probe
from .steps import edit as edit_step
from .steps import matting as matting_step
from .steps import silences as silences_step
from .steps import transcript as transcript_step

Ctx = dict  # {"fps": int, "lang": str | None}


def _edit(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-edit.mp4"
    edit_step.make_edit(source, tmp, ctx["fps"])
    tmp.replace(cache / "edit.mp4")
    info = probe(cache / "edit.mp4") | {"sourceHasAudio": probe(source)["hasAudio"]}
    tmp_probe = cache / "tmp-probe.json"
    tmp_probe.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    tmp_probe.replace(cache / "probe.json")


def _proxy(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-proxy.mp4"
    edit_step.make_proxy(cache / "edit.mp4", tmp, ctx["fps"])
    tmp.replace(cache / "proxy.mp4")


def _transcript(cache: Path, source: Path, ctx: Ctx) -> None:
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    result = transcript_step.transcribe(cache / "edit.mp4", ctx["lang"], info["hasAudio"])
    tmp = cache / "tmp-transcript.json"
    tmp.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(cache / "transcript.json")


def _silences(cache: Path, source: Path, ctx: Ctx) -> None:
    info = json.loads((cache / "probe.json").read_text(encoding="utf-8"))
    words = json.loads((cache / "transcript.json").read_text(encoding="utf-8"))["words"]
    result = silences_step.make_silences(cache / "edit.mp4", words, info["durationMs"], info["hasAudio"])
    tmp = cache / "tmp-silences.json"
    tmp.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    tmp.replace(cache / "silences.json")



def _subject(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-subject.webm"
    matting_step.make_subject(cache / "edit.mp4", tmp, ctx["fps"])
    tmp.replace(cache / "subject.webm")


def _plate(cache: Path, source: Path, ctx: Ctx) -> None:
    tmp = cache / "tmp-plate.png"
    matting_step.make_plate(cache / "edit.mp4", tmp)
    tmp.replace(cache / "plate.png")


STEP_FUNCS: dict[str, Callable[[Path, Path, Ctx], None]] = {"edit": _edit, "proxy": _proxy, "transcript": _transcript, "silences": _silences,
                                                              "subject": _subject, "plate": _plate}
manifest.VERSIONS.update({"edit": edit_step.VERSION, "proxy": edit_step.VERSION, "transcript": transcript_step.VERSION,
                          "silences": silences_step.VERSION, "subject": matting_step.VERSION, "plate": matting_step.VERSION})


def with_dependencies(steps: list[str]) -> list[str]:
    wanted = set()
    for s in steps:
        while s is not None:
            wanted.add(s)
            s = manifest.DEPENDS[s]
    return [s for s in manifest.STEPS if s in wanted]


def run(project_dir, videos: dict, steps: list[str], fps: int = 30, lang: str | None = None, force: bool = False) -> dict:
    for s in steps:
        if s not in STEP_FUNCS:
            raise AnalysisError(f'unknown step "{s}" (known: {", ".join(STEP_FUNCS)})')
    done = {}
    for asset, source in videos.items():
        source = Path(source)
        if not source.is_file():
            raise AnalysisError(f"{asset}: source video {source} not found")
        cache = Path(project_dir) / "cache" / asset
        cache.mkdir(parents=True, exist_ok=True)
        redone: set[str] = set()
        for step in with_dependencies(steps):
            if not manifest.needs_run(cache, step, source, force and step in steps, redone):
                continue
            t0 = time.time()
            try:
                STEP_FUNCS[step](cache, source, {"fps": fps, "lang": lang})
            except AnalysisError as e:
                raise AnalysisError(f"{asset} {step}: {e}") from None
            seconds = time.time() - t0
            manifest.record(cache, step, source, seconds)
            redone.add(step)
            print(f"{asset} {step}: {seconds:.0f} s", flush=True)
        done[asset] = [s for s in manifest.STEPS if s in redone]
    return done
