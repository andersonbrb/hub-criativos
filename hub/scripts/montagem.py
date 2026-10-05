"""
Montagem automática do infoproduto (hub/playbooks/infoproduto-edicao-video.md), rodando local.

Uso: python montagem.py job.json
job.json = {
  "name": "AD01", "avatar": "C:/.../avatar.mp4", "brolls": ["C:/.../br1.mp4", ...],
  "lang": "es", "out": "C:/.../saida.mp4", "workdir": "C:/.../tmp", "fontsdir": "C:/.../fonts"
}

Diferenças em relação ao código do playbook (correções):
- Áudio lido pelo ffmpeg (a DLL do PyAV é bloqueada pelo Controle de Aplicativo do Windows).
- Cortes reencodados em vez de "-c copy": com copy o ffmpeg corta no keyframe e o corte sai impreciso.
- FADE_DUR aplicado (estava definido no playbook mas não era usado): dissolve de entrada e saída do B-roll.
- Base normalizada para 1080x1920 30fps antes do overlay (avatar 720p não quebra o overlay).
- Fonte Montserrat carregada da pasta do hub (fontsdir), para a legenda não cair em outra fonte.
"""

import json
import os
import shutil
import subprocess
import sys
import time
import types

# PyAV é bloqueado nesta máquina; o faster-whisper só precisa dele para decodificar arquivos,
# e aqui passamos o áudio já decodificado pelo ffmpeg.
sys.modules.setdefault("av", types.ModuleType("av"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("PYTHONWARNINGS", "ignore")

import numpy as np  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

# Parâmetros do playbook
MIN_SIL = 0.35   # silêncio mínimo para cortar (s)
PRE_BUF = 0.05   # buffer antes da fala
POST_BUF = 0.08  # buffer depois da fala
FIRST_BR = 6.0   # início do primeiro B-roll
SPACING = 7.0    # intervalo entre B-rolls
BR_CLIP = 2.8    # duração do B-roll na tela
FADE_DUR = 0.25  # dissolve de entrada e saída
MAX_CHARS = 14   # caracteres por bloco de legenda
WHISPER_MODEL = "small"  # NUNCA "tiny" (causa desync)

# "-vsync cfr" do playbook foi removido no ffmpeg 7+; "-fps_mode cfr" é o equivalente.
ENC = ["-c:v", "libx264", "-r", "30", "-fps_mode", "cfr", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "23"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, label, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{label}: {r.stderr[-400:]}")


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path], capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def has_audio(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return bool(r.stdout.strip())


def load_audio(path):
    r = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("não consegui extrair o áudio do vídeo")
    return np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0


def words(model, path, lang):
    audio = load_audio(path)
    try:
        segments, _ = model.transcribe(audio, language=lang, word_timestamps=True, vad_filter=True)
        segments = list(segments)
    except Exception as err:  # o VAD (onnxruntime) também pode ser bloqueado pelo Windows
        log(f"VAD indisponível ({str(err)[:80]}), transcrevendo sem VAD")
        segments, _ = model.transcribe(audio, language=lang, word_timestamps=True, vad_filter=False)
        segments = list(segments)
    return [(w.word.strip(), w.start, w.end) for s in segments if s.words for w in s.words if w.word.strip()]


def ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60); c = int(round((t % 1) * 100))
    if c >= 100: s += 1; c = 0
    if s >= 60: m += 1; s = 0
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


ASS_HEADER = (
    "[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nPlayResX: 1080\nPlayResY: 1920\n\n"
    "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
    "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
    "MarginL, MarginR, MarginV, Encoding\n"
    "Style: Default,Montserrat,110,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,"
    "-1,0,0,0,100,100,0,0,1,4,2,2,10,10,280,1\n\n"
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
)

NORMALIZE = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30"


def process(job):
    w = job["workdir"]
    os.makedirs(w, exist_ok=True)
    lang = job.get("lang") or "es"
    log(f"START {job['name']}")

    av = job["avatar"]
    if not has_audio(av):
        raise RuntimeError("o vídeo do avatar não tem áudio")
    du = duration(av)
    log(f"duração do avatar: {du:.1f}s")

    log(f"carregando Whisper '{WHISPER_MODEL}' (o primeiro uso baixa o modelo, ~500 MB)")
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

    # 1ª transcrição: onde há fala
    ws = words(model, av, lang)
    log(f"palavras: {len(ws)}")
    if not ws:
        raise RuntimeError("nenhuma fala encontrada no avatar")

    # Jump cuts: junta falas separadas por menos de MIN_SIL
    ivs = []; gs, ge = ws[0][1], ws[0][2]
    for i in range(1, len(ws)):
        if ws[i][1] - ws[i - 1][2] > MIN_SIL:
            ivs.append((gs, ge)); gs, ge = ws[i][1], ws[i][2]
        else:
            ge = ws[i][2]
    ivs.append((gs, ge))
    merged = []
    for a, b in [(max(0, a - PRE_BUF), min(du, b + POST_BUF)) for a, b in ivs]:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])

    jc = os.path.join(w, "jc.mp4")
    if len(merged) == 1 and merged[0][0] < 0.1 and merged[0][1] > du - 0.5:
        shutil.copy(av, jc)
        log("sem silêncios para cortar")
    else:
        parts = []
        for i, (a, b) in enumerate(merged):
            p = os.path.join(w, f"c{i}.mp4")
            run(["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", av, "-vf", NORMALIZE, *ENC,
                 "-c:a", "aac", "-ar", "48000", "-ac", "2", p], "corte")
            parts.append(p)
        lst = os.path.join(w, "l.txt")
        with open(lst, "w", encoding="utf-8") as f:
            f.write("\n".join(f"file '{p.replace(os.sep, '/')}'" for p in parts))
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", jc], "concat")
        log(f"{len(merged)} trechos de fala, {len(merged) - 1} cortes")
    jd = duration(jc)
    log(f"duração após cortes: {jd:.1f}s (era {du:.1f}s)")

    # 2ª transcrição: tempos depois dos cortes, para a legenda bater
    ws2 = words(model, jc, lang)

    groups = []; cur = []; cs = ce = None
    for wd in ws2:
        txt = " ".join(x[0] for x in cur) + (" " if cur else "") + wd[0]
        if len(txt) > MAX_CHARS and cur:
            groups.append((cs, ce, " ".join(x[0] for x in cur))); cur = [wd]; cs, ce = wd[1], wd[2]
        else:
            if not cur: cs = wd[1]
            cur.append(wd); ce = wd[2]
    if cur:
        groups.append((cs, ce, " ".join(x[0] for x in cur)))

    with open(os.path.join(w, "s.ass"), "w", encoding="utf-8") as f:
        f.write(ASS_HEADER + "".join(f"Dialogue: 0,{ts(a)},{ts(b)},Default,,0,0,0,,{t.upper()}\n" for a, b, t in groups))
    log(f"legendas: {len(groups)} blocos")

    # B-rolls com dissolve
    brolls = job.get("brolls") or []
    starts = [round(FIRST_BR + i * SPACING, 2) for i in range(len(brolls)) if FIRST_BR + i * SPACING + BR_CLIP <= jd]
    vs = os.path.join(w, "vs.mp4")
    inputs = ["-i", jc]
    flt = f"[0:v]{NORMALIZE}[base];"
    prev = "[base]"
    for i, t in enumerate(starts):
        inputs += ["-i", brolls[i]]
        flt += (f"[{i + 1}:v]trim=0:{BR_CLIP},setpts=PTS-STARTPTS,{NORMALIZE},format=yuva420p,"
                f"fade=t=in:st=0:d={FADE_DUR}:alpha=1,fade=t=out:st={BR_CLIP - FADE_DUR}:d={FADE_DUR}:alpha=1,"
                f"setpts=PTS+{t}/TB[br{i}];")
        flt += f"{prev}[br{i}]overlay=0:0:eof_action=pass[v{i}];"
        prev = f"[v{i}]"
    flt += f"{prev}null[vout]"
    run(["ffmpeg", "-y", *inputs, "-filter_complex", flt, "-map", "[vout]", "-map", "0:a", *ENC, "-c:a", "copy", vs], "b-roll")
    if len(brolls) > len(starts):
        log(f"{len(brolls) - len(starts)} b-roll(s) não couberam no tempo do vídeo")
    log(f"b-rolls aplicados: {len(starts)} em {', '.join(f'{t}s' for t in starts) or '-'}")

    # Queima a legenda (roda dentro da pasta de trabalho para o caminho do .ass não precisar de escape)
    fonts = os.path.join(w, "fonts")
    shutil.copytree(job["fontsdir"], fonts, dirs_exist_ok=True)
    run(["ffmpeg", "-y", "-i", "vs.mp4", "-vf", "ass=s.ass:fontsdir=fonts", *ENC, "-c:a", "copy", "out.mp4"], "legenda", cwd=w)

    shutil.move(os.path.join(w, "out.mp4"), job["out"])
    log(f"arquivo final: {os.path.getsize(job['out']) / 1e6:.1f} MB, {duration(job['out']):.1f}s")
    log("DONE")


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as fh:
        job = json.load(fh)
    try:
        process(job)
    except Exception as err:  # noqa: BLE001
        log(f"ERROR {err}")
        sys.exit(1)
    finally:
        if not job.get("keep_workdir"):
            shutil.rmtree(job["workdir"], ignore_errors=True)
