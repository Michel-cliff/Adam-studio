import shutil
import subprocess
import sys

import pytest
from media import ffmpeg

from adam_analysis.runner import run


def speak(text: str, wav):
    script = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
              "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'fr*' } | Select-Object -First 1; "
              "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; "
              f"$s.SetOutputToWaveFile('{wav}'); $s.Speak('{text}'); $s.Dispose()")
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)


@pytest.mark.slow
@pytest.mark.skipif(sys.platform != "win32" or not shutil.which("powershell"), reason="Windows speech synthesis")
def test_words_come_with_increasing_timings(tmp_path):
    wav = tmp_path / "voice.wav"
    speak("Bonjour, ceci est un essai de transcription pour Adam Studio.", wav)
    video = tmp_path / "talk.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=540x960:r=30", "-i", str(wav), "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-c:a", "aac", str(video))
    run(tmp_path / "p", {"c01": video}, ["silences"], lang="fr")
    import json

    t = json.loads((tmp_path / "p" / "cache" / "c01" / "transcript.json").read_text(encoding="utf-8"))
    words = t["words"]
    assert len(words) >= 5 and t["lang"] == "fr"
    assert all(w["text"] == w["text"].strip() and w["endMs"] >= w["startMs"] for w in words)
    assert [w["startMs"] for w in words] == sorted(w["startMs"] for w in words)
    assert any("adam" in w["text"].lower() for w in words)
    assert (tmp_path / "p" / "cache" / "c01" / "silences.json").is_file()


@pytest.mark.slow
def test_a_take_without_speech_has_no_words(tmp_path):
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=540x960:r=30:d=2", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(tmp_path / "quiet.mp4"))
    run(tmp_path / "p", {"c01": tmp_path / "quiet.mp4"}, ["transcript"], lang="fr")
    import json

    assert json.loads((tmp_path / "p" / "cache" / "c01" / "transcript.json").read_text(encoding="utf-8"))["words"] == []
