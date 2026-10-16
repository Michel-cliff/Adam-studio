"""python -m adam_capcut export <projectDir> [--name "1015 edit"] [--projects-root DIR] [--skip-prepare]"""
import argparse
import sys
from pathlib import Path

from .errors import ExportError
from .export import export


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m adam_capcut")
    sub = parser.add_subparsers(dest="command", required=True)
    ex = sub.add_parser("export", help="write the CapCut project of an Adam Studio project")
    ex.add_argument("project_dir")
    ex.add_argument("--name", help="CapCut project name (default: the project name)")
    ex.add_argument("--projects-root", help="CapCut projects folder (default: CapCut Desktop's)")
    ex.add_argument("--skip-prepare", action="store_true", help="reuse renders/capcut from a previous prepare step")
    ex.add_argument("--force", action="store_true", help="export even with lint errors (pending proposals)")
    ex.add_argument("--replace", action="store_true", help="overwrite a project opened in CapCut since the last export")
    args = parser.parse_args(argv)
    try:
        dest = export(Path(args.project_dir), name=args.name, projects_root=args.projects_root, prepare=not args.skip_prepare,
                      force=args.force, replace=args.replace)
    except ExportError as e:
        print(e, file=sys.stderr)
        return 1
    print(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
