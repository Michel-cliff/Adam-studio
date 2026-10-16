"""cache/<assetId>/manifest.json: which steps ran, from which source, at which version."""
import json
import time
from pathlib import Path

STEPS = ["edit", "proxy", "transcript", "silences", "subject", "plate"]
DEPENDS = {"edit": None, "proxy": "edit", "transcript": "edit", "silences": "transcript", "subject": "edit", "plate": "edit"}
OUTPUTS = {"edit": ["edit.mp4", "probe.json"], "proxy": ["proxy.mp4"], "transcript": ["transcript.json"],
           "silences": ["silences.json"], "subject": ["subject.webm"], "plate": ["plate.png"]}
VERSIONS: dict[str, int] = {}  # filled by the runner from each step module


def load(cache: Path) -> dict:
    f = cache / "manifest.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {"source": None, "steps": {}}


def source_stamp(source: Path) -> dict:
    st = Path(source).stat()
    return {"path": str(source), "size": st.st_size, "mtimeMs": int(st.st_mtime * 1000)}


def needs_run(cache: Path, step: str, source: Path, force: bool, redone: set[str]) -> bool:
    m = load(cache)
    entry = m["steps"].get(step)
    stamp = source_stamp(source)
    return (force or entry is None or entry.get("version") != VERSIONS.get(step)
            or any(not (cache / f).is_file() for f in OUTPUTS[step])
            or m.get("source") is None or (m["source"]["size"], m["source"]["mtimeMs"]) != (stamp["size"], stamp["mtimeMs"])
            or (DEPENDS[step] is not None and DEPENDS[step] in redone))


def record(cache: Path, step: str, source: Path, seconds: float) -> None:
    m = load(cache)
    m["source"] = source_stamp(source)
    m["steps"][step] = {"version": VERSIONS.get(step), "finishedAt": int(time.time() * 1000), "seconds": round(seconds, 1)}
    (cache / "manifest.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
