"""The CapCut project folder, with the safety rules carried over from the lab."""
import os
import shutil
from pathlib import Path

from .errors import ExportError

MARKER = ".adam_studio_export"


def default_projects_root() -> Path:
    return Path(os.path.expandvars(r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft"))


def prepare_project_dir(root: Path, name: str, template: Path) -> Path:
    """A fresh CapCut project folder from the template. Only folders this exporter created are replaced,
    and never while CapCut has them open."""
    dest = Path(root) / name
    if dest.exists():
        if not (dest / MARKER).exists():
            raise ExportError(f'CapCut project "{name}" exists and was not created by Adam Studio: refusing to overwrite it. Pick another --name.')
        if (dest / ".locked").exists():
            raise ExportError(f'CapCut project "{name}" is open in CapCut: close it there, then export again.')
        shutil.rmtree(dest)
    shutil.copytree(template, dest)
    # Marked right away, so an export that fails halfway can be redone over it.
    (dest / MARKER).touch()
    (dest / "media").mkdir(exist_ok=True)
    return dest
