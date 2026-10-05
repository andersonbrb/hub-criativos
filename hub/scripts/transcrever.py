"""
Transcrição local com Whisper (faster-whisper) + identificação do idioma. Reserva do agente de Transcrição
quando o ElevenLabs (Scribe) não está disponível. Sem custo.

Uso: python transcrever.py <arquivo de vídeo ou áudio> [modelo]
Saída (stdout): JSON { language, probability, duration, segments: [{ start, end, text }] }
"""

import json
import os
import subprocess
import sys
import types

# O Windows desta máquina bloqueia a DLL do PyAV; o áudio é lido pelo ffmpeg (ver scripts/montagem.py).
sys.modules.setdefault("av", types.ModuleType("av"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402


def load_audio(path):
    r = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-vn", "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("não consegui extrair o áudio (o arquivo tem som?)")
    return np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0


def main():
    path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    audio = load_audio(path)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    try:
        segments, info = model.transcribe(audio, vad_filter=True)
        segments = list(segments)
    except Exception:  # o VAD (onnxruntime) também pode ser bloqueado
        segments, info = model.transcribe(audio, vad_filter=False)
        segments = list(segments)
    print(json.dumps({
        "language": info.language,
        "probability": round(float(info.language_probability), 3),
        "duration": round(len(audio) / 16000, 2),
        "segments": [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()],
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"error": str(err)}, ensure_ascii=False))
        sys.exit(1)
