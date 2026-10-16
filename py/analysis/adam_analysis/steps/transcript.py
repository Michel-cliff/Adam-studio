"""transcript.json: words with timings, in the spoken language (faster-whisper large-v3-turbo on CPU)."""
import subprocess
from pathlib import Path

import numpy as np

from ..errors import AnalysisError

VERSION = 1
MODEL = "large-v3-turbo"
SILENT_RMS = 10 ** (-50 / 20)
NO_SPEECH = 0.6
_model = None


def model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel

            _model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        except Exception as e:  # first use downloads about 1.6 GB
            raise AnalysisError(f"cannot load Whisper {MODEL} (the first run downloads it, network needed): {e}") from None
    return _model


def audio_samples(edit: Path) -> np.ndarray:
    """16 kHz mono float samples decoded by ffmpeg (faster-whisper 1.2.1's own decoder breaks with PyAV 19)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(edit), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True)
    if r.returncode != 0:
        raise AnalysisError(f"cannot decode the audio of {edit}: {r.stderr.decode(errors='replace')[-300:]}")
    return np.frombuffer(r.stdout, dtype="<i2").astype(np.float32) / 32768.0


def transcribe(edit: Path, lang: str | None, has_audio: bool) -> dict:
    if not has_audio:
        return {"lang": lang, "langProbability": None, "words": []}
    audio = audio_samples(edit)
    # Whisper invents words on silence: a near-silent take (below -50 dBFS RMS) has no words.
    if audio.size == 0 or float(np.sqrt(np.mean(audio ** 2))) < SILENT_RMS:
        return {"lang": lang, "langProbability": None, "words": []}
    segments, info = model().transcribe(audio, language=lang, word_timestamps=True, beam_size=5, vad_filter=False,
                                        condition_on_previous_text=False)
    words = []
    for s in segments:
        if s.no_speech_prob > NO_SPEECH:  # a segment Whisper itself rates as non-speech
            continue
        for w in s.words or []:
            text = w.word.strip()
            if not text:
                continue
            start = round(w.start * 1000)
            words.append({"text": text, "startMs": start, "endMs": max(start, round(w.end * 1000)), "p": round(w.probability, 3)})
    return {"lang": info.language, "langProbability": round(info.language_probability, 3), "words": words}
