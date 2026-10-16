"""pyJianYingDraft and draft_profiles, used from the ClaudeCapcut lab (never copied into the repo)."""
import os
import sys
from pathlib import Path

from .errors import ExportError


def lab_path() -> Path:
    return Path(os.environ.get("ADAM_CAPCUT_LAB", str(Path.home() / "ClaudeCapcut" / "VectCutAPI")))


def load_lab():
    path = lab_path()
    if not (path / "pyJianYingDraft").is_dir() or not (path / "draft_profiles.py").is_file():
        raise ExportError(f"pyJianYingDraft not found in {path}: set ADAM_CAPCUT_LAB to the VectCutAPI folder of the ClaudeCapcut lab")
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
    import draft_profiles
    import pyJianYingDraft
    import pyJianYingDraft.text_segment  # noqa: F401  (TextStyleRange lives there)

    return pyJianYingDraft, draft_profiles
