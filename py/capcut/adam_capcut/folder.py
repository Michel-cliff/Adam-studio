"""The CapCut project folder, with the safety rules carried over from the lab."""
import os
import shutil
from pathlib import Path

from .errors import ExportError

MARKER = ".adam_studio_export"
# Written by CapCut when it opens a project (absent from the template): the creator may have edited it there.
CAPCUT_OPENED = ("draft_content.json", "draft_cover.jpg", "Timelines")


def default_projects_root() -> Path:
    return Path(os.path.expandvars(r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft"))


def prepare_project_dir(root: Path, name: str, template: Path, replace: bool = False) -> Path:
    """A fresh CapCut project folder from the template. Only folders this exporter created are replaced, never
    while CapCut has them open, and not after CapCut opened them unless `replace` (edits made there are lost)."""
    dest = Path(root) / name
    if dest.exists():
        if not (dest / MARKER).exists():
            raise ExportError(f'CapCut project "{name}" exists and was not created by Adam Studio: refusing to overwrite it. Pick another --name.')
        if (dest / ".locked").exists():
            raise ExportError(f'CapCut project "{name}" is open in CapCut: close it there, then export again.')
        if not replace and any((dest / f).exists() for f in CAPCUT_OPENED):
            raise ExportError(f'CapCut project "{name}" has been opened in CapCut since the last export: edits made there '
                              "would be lost. Pass --replace to overwrite it, or pick another --name.")
        shutil.rmtree(dest)
    shutil.copytree(template, dest)
    # Marked right away, so an export that fails halfway can be redone over it.
    (dest / MARKER).touch()
    (dest / "media").mkdir(exist_ok=True)
    return dest
