"""python -m adam_capcut export: the prepare step (TypeScript), then the CapCut project and its report."""
import json
import subprocess
from pathlib import Path

from .build import build_script
from .errors import ExportError

# Front element kinds built as native CapCut items (titles and big words as texts, images as photos).
NATIVE_FRONT_KINDS = {"title", "text.behindSubject", "image"}
from .fonts import apply_fonts
from .folder import MARKER, default_projects_root, prepare_project_dir
from .lab import lab_path, load_lab
from .media import copy_media
from .units import safe_name

REPO = Path(__file__).resolve().parents[3]
TSX = REPO / "node_modules" / "tsx" / "dist" / "cli.mjs"


def run_prepare(project_dir: Path, prep: Path, force: bool = False) -> None:
    """Runs `adam capcut-prep` (resolve, lint, Remotion renders of what CapCut cannot do natively)."""
    if not TSX.is_file():
        raise ExportError(f"{TSX} not found: run npm install at the repo root")
    cmd = ["node", str(TSX), str(REPO / "packages" / "render" / "src" / "cli.ts"), "capcut-prep", str(project_dir), "--out", str(prep)]
    if force:
        cmd.append("--force")
    if subprocess.run(cmd, cwd=REPO).returncode != 0:
        raise ExportError("the prepare step failed: see the messages above")


def export(project_dir, *, name: str | None = None, projects_root=None, prepare: bool = True, prep_dir=None,
           force: bool = False, replace: bool = False) -> Path:
    project_dir = Path(project_dir).resolve()
    prep = Path(prep_dir).resolve() if prep_dir else project_dir / "renders" / "capcut"
    if prepare:
        run_prepare(project_dir, prep, force=force)
    for f in ("timeline.json", "capcut-plan.json"):
        if not (prep / f).is_file():
            raise ExportError(f"{prep / f} is missing: export without --skip-prepare")
    timeline = json.loads((prep / "timeline.json").read_text(encoding="utf-8"))
    plan = json.loads((prep / "capcut-plan.json").read_text(encoding="utf-8"))
    pjd, profiles = load_lab()
    profile = profiles.get_draft_profile()
    title = name or plan["name"]
    folder = safe_name(title)
    root = Path(projects_root) if projects_root else default_projects_root()
    dest = prepare_project_dir(root, folder, lab_path() / profile.template_dir, replace=replace)
    media = copy_media(timeline, plan, prep, dest / "media")
    # The front kinds the TS prepare step left to us must be ones this exporter builds natively.
    unknown = sorted(set(plan.get("nativeKinds", NATIVE_FRONT_KINDS)) - NATIVE_FRONT_KINDS)
    if unknown:
        raise ExportError(f"the prepare step expects native CapCut items for {', '.join(unknown)}, which this exporter cannot build: update NATIVE_FRONT_KINDS on both sides")
    script, entries, roles = build_script(pjd, timeline, plan, media)
    profiles.write_profile_content(profile, dest, apply_fonts(script.dumps(profile), plan["fonts"], roles))
    (dest / MARKER).touch()
    report = project_dir / "renders" / f"{folder}.capcut-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"project": str(dest), "name": title, "entries": plan["entries"] + entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return dest
