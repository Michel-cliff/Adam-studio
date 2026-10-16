from adam_capcut.__main__ import main


def test_exports_and_prints_the_capcut_project_folder(lab, project, tmp_path, capsys):
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "cli"]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / "cli")


def test_refusals_are_messages_not_tracebacks(lab, project, tmp_path, capsys):
    (tmp_path / "taken").mkdir()
    assert main(["export", str(project), "--skip-prepare", "--projects-root", str(tmp_path), "--name", "taken"]) == 1
    assert "was not created by Adam Studio" in capsys.readouterr().err
