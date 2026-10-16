import json
import subprocess
from pathlib import Path

import pytest

from adam_capcut.__main__ import main
from adam_capcut.export import REPO, TSX
from helpers import content_of, report_of


@pytest.mark.e2e
def test_exports_the_synthetic_project_through_the_prepare_step(lab, tmp_path, capsys):
    _, profiles = lab
    project = tmp_path / "projet e2e"
    synthetic = (REPO / "packages" / "render" / "tests" / "e2e" / "synthetic.ts").as_uri()
    subprocess.run(["node", str(TSX), "-e", f"import('{synthetic}').then(m => m.makeSynthetic(process.argv[1]))", str(project)], cwd=REPO, check=True)
    data = json.loads((project / "project.json").read_text(encoding="utf-8"))
    data["elements"].append({"id": "t1", "kind": "title", "anchor": {"atMs": 2500}, "durationMs": 500,
                             "props": {"phases": [{"startMs": 0, "endMs": 500, "lines": [{"text": "HELLO"}]}]}})
    (project / "project.json").write_text(json.dumps(data), encoding="utf-8")

    assert main(["export", str(project), "--projects-root", str(tmp_path / "capcut")]) == 0
    dest = Path(capsys.readouterr().out.strip().splitlines()[-1])
    content = content_of(dest, profiles)
    track = next(t for t in content["tracks"] if t["name"] == "main")
    assert len(track["segments"]) == 5
    texts = {json.loads(t["content"])["text"] for t in content["materials"]["texts"]}
    assert {"red blue", "HELLO"} <= texts
    r = report_of(project, "synthetic")
    assert (r["behind"]["status"], r["t1"]["status"], r["beep"]["status"]) == ("baked", "native", "native")
