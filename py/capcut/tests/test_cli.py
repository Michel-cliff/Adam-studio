from adam_capcut.__main__ import main
from adam_capcut.export import run_prepare


def test_exports_and_prints_the_capcut_project_folder(lab, project, tmp_path, capsys):
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "cli"]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / "cli")


def test_refusals_are_messages_not_tracebacks(lab, project, tmp_path, capsys):
    (tmp_path / "taken").mkdir()
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "taken"]) == 1
    assert "was not created by Adam Studio" in capsys.readouterr().err


def test_force_and_replace_reach_the_export(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr("adam_capcut.__main__.export", lambda *a, **k: seen.update(k) or tmp_path)
    assert main(["export", str(tmp_path), "--force", "--replace"]) == 0
    assert (seen["force"], seen["replace"]) == (True, True)


def test_force_reaches_the_prepare_step(monkeypatch, tmp_path):
    calls = []

    class Done:
        returncode = 0

    monkeypatch.setattr("adam_capcut.export.subprocess.run", lambda cmd, cwd: calls.append(cmd) or Done())
    run_prepare(tmp_path, tmp_path / "prep", force=True)
    assert calls[0][-1] == "--force"
