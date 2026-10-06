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
import re
import shutil
import subprocess
import sys
import time
import types
import unicodedata

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

# ---------- Efeitos opcionais (job["fx"]); todos DESLIGADOS por padrão: a edição padrão do playbook não muda ----------
FX_DEFAULTS = {
    "legenda": "padrao",        # "padrao" | "destaque" (palavra falada em cor + pop, estilo CapCut/Submagic)
    "cor_destaque": "#22FF66",  # cor da palavra destacada
    "zoom_cortes": False,       # alterna 100%/110% a cada corte (esconde o pulo do jump cut)
    "transicao": "dissolve",    # entrada do b-roll: "dissolve" | "zoom" | "slide"
    "sons": False,              # whoosh na entrada de cada b-roll
    "musica": None,             # caminho de um áudio do hub para fundo (abaixa sozinho quando há fala)
    "musica_volume": 0.18,
    "cor": "nenhuma",           # correção de cor: "nenhuma" | "quente" | "fria" | "vivo"
    "barra_progresso": False,   # barra fina no rodapé mostrando o andamento do vídeo
}
GRADES = {
    "quente": "eq=saturation=1.12:gamma_r=1.04:gamma_b=0.96",
    "fria": "eq=saturation=1.05:gamma_r=0.97:gamma_b=1.05",
    "vivo": "eq=saturation=1.25:contrast=1.06",
}


def ass_color(hex_color, default="22FF66"):
    """#RRGGBB -> &H00BBGGRR (cor do ASS)."""
    h = (hex_color or "").lstrip("#")
    if len(h) != 6 or any(c not in "0123456789abcdefABCDEF" for c in h):
        h = default
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


CURRENCY = {"r$", "$", "us$", "u$", "€", "£", "s/", "s/.", "mx$", "cop", "clp", "ars"}


def caption_words(ws):
    """Junta o que não pode quebrar na legenda: preço e número com decimais ("49" + ",90" -> "49,90"),
    moeda + valor ("R$" + "49,90" -> "R$ 49,90") e porcentagem ("30" + "%" -> "30%")."""
    out = []
    for w, s, e in ws:
        w = w.strip()
        if not w:
            continue
        if out:
            pw, ps, _pe = out[-1]
            glue = None
            if re.match(r"^[.,]\d", w) and re.search(r"\d$", pw):
                glue = ""                                  # 49 + ,90
            elif re.match(r"^\d", w) and re.search(r"\d[.,]$", pw):
                glue = ""                                  # 49, + 90
            elif w in ("%", "%.", "%,") or (w.startswith("%") and len(w) <= 2):
                glue = ""                                  # 30 + %
            elif pw.lower() in CURRENCY and re.match(r"^\d", w):
                glue = " "                                 # R$ + 49,90
            if glue is not None:
                out[-1] = (pw + glue + w, ps, e)
                continue
        out.append((w, s, e))
    return out


def caption_events(groups, fx):
    """Eventos ASS. Padrão: um bloco por vez (playbook). Destaque: a palavra falada em cor, com 'pop' na entrada do bloco."""
    if fx["legenda"] != "destaque":
        return "".join(f"Dialogue: 0,{ts(a)},{ts(b)},Default,,0,0,0,,{' '.join(x[0] for x in ws).upper()}\n" for a, b, ws in groups)
    hl = ass_color(fx.get("cor_destaque"))
    out = []
    for a, b, ws in groups:
        for j, (word, s, _e) in enumerate(ws):
            start = a if j == 0 else s
            end = ws[j + 1][1] if j + 1 < len(ws) else b
            if end <= start:
                continue
            pop = "{\\fscx88\\fscy88\\t(0,110,\\fscx100\\fscy100)}" if j == 0 else ""
            text = " ".join(f"{{\\c{hl}}}{w.upper()}{{\\c&H00FFFFFF&}}" if k == j else w.upper() for k, (w, _s, _e2) in enumerate(ws))
            out.append(f"Dialogue: 0,{ts(start)},{ts(end)},Default,,0,0,0,,{pop}{text}\n")
    return "".join(out)


def make_whoosh(w):
    """Whoosh gerado aqui mesmo (ruído filtrado com envelope): sem arquivo de terceiros nem licença."""
    path = os.path.join(w, "whoosh.wav")
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.7",
         "-af", "highpass=f=250,lowpass=f=3500,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.3,volume=0.55", path], "whoosh")
    return path


def norm(s):
    """minúsculas, sem acento e sem pontuação (para achar a deixa na fala)."""
    s = unicodedata.normalize("NFD", (s or "").lower().replace("-", " "))
    return "".join(c for c in s if (c.isalnum() and c.isascii()) or c == " ").strip()


# Número por extenso -> dígitos (pt, es, en, fr), dos dois lados: o Whisper escreve "4" quando a deixa diz "quatro".
# O mesmo mapa existe em lib/server/motion.ts (NUM_WORDS).
NUM_WORDS = {}
for _n, _l in {
    0: "zero cero", 1: "um uma uno una un une one", 2: "dois duas dos two deux", 3: "tres three trois",
    4: "quatro cuatro four quatre", 5: "cinco five cinq", 6: "seis six", 7: "sete siete seven sept",
    8: "oito ocho eight huit", 9: "nove nueve nine neuf", 10: "dez diez ten dix", 11: "onze once eleven",
    12: "doze doce twelve douze", 13: "treze trece thirteen treize", 14: "quatorze catorze fourteen",
    15: "quinze quince fifteen", 16: "dezesseis dieciseis sixteen seize", 17: "dezessete diecisiete seventeen",
    18: "dezoito dieciocho eighteen", 19: "dezenove diecinueve nineteen", 20: "vinte veinte twenty vingt",
    30: "trinta treinta thirty trente", 40: "quarenta cuarenta forty quarante", 50: "cinquenta cincuenta fifty cinquante",
    60: "sessenta sesenta sixty soixante", 70: "setenta seventy", 80: "oitenta ochenta eighty", 90: "noventa ninety",
    100: "cem cien hundred cent",
}.items():
    for _w in _l.split():
        NUM_WORDS[_w] = _n


def num_tokens(raw):
    """[(token, t)] normalizados, com número por extenso em dígitos e dezena + unidade juntas ("quarenta e nove" -> "49")."""
    toks = [(str(NUM_WORDS[t]) if t in NUM_WORDS else t, s) for t, s in raw]
    out, i = [], 0
    while i < len(toks):
        t, s = toks[i]
        j = i + 2 if i + 1 < len(toks) and toks[i + 1][0] in ("e", "y", "et", "and") else i + 1
        if t.isdigit() and 20 <= int(t) <= 90 and int(t) % 10 == 0 and j < len(toks) and toks[j][0] in "123456789" and len(toks[j][0]) == 1:
            out.append((str(int(t) + int(toks[j][0])), s))
            i = j + 1
        else:
            out.append((t, s))
            i += 1
    return out


def tok_hit(word, tok):
    """Número tem que ser igual; palavra, começar igual."""
    return word == tok if tok.isdigit() else word.startswith(tok)


def find_cue(cue, ws, after):
    """Primeiro momento (s), a partir de `after`, em que a fala diz a deixa (uma ou mais palavras, começo de palavra)."""
    toks = [t for t, _ in num_tokens([(t, 0) for t in norm(cue).split()])]
    if not toks:
        return None
    words = num_tokens([(t, x[1]) for x in ws for t in norm(x[0]).split()])
    for i in range(len(words)):
        if words[i][1] < after:
            continue
        if all(i + k < len(words) and tok_hit(words[i + k][0], toks[k]) for k in range(len(toks))):
            return words[i][1]
    return None


def plan_brolls(n, cues, ws, jd):
    """[(índice do b-roll, início em s)] na ordem dos b-rolls, sem sobreposição e dentro do vídeo."""
    plan, free_at, slot = [], 0.0, 0
    for i in range(n):
        cue = cues[i] if i < len(cues) else ""
        t = None
        if cue:
            hit = find_cue(cue, ws, free_at)
            if hit is not None:
                t = round(max(0.0, hit - 0.1), 2)
                log(f"b-roll {i + 1}: deixa \"{cue}\" falada em {hit:.1f}s")
            else:
                log(f"b-roll {i + 1}: deixa \"{cue}\" não encontrada na fala; usando a grade do padrão")
        if t is None:
            while FIRST_BR + slot * SPACING < free_at:
                slot += 1
            t = round(FIRST_BR + slot * SPACING, 2)
            slot += 1
        if t + BR_CLIP > jd:
            continue
        plan.append((i, t))
        free_at = t + BR_CLIP + 0.3
    return plan


def join_avatars(paths, w):
    """Vários vídeos do avatar (ex.: gancho + body, várias tomadas): junta na ordem, no mesmo tamanho e fps,
    antes dos cortes. Daí em diante a montagem trata como um vídeo só."""
    for i, p in enumerate(paths):
        if not has_audio(p):
            raise RuntimeError(f"o vídeo do avatar {i + 1} não tem áudio")
    inputs, filters, pairs = [], [], ""
    for i, p in enumerate(paths):
        inputs += ["-i", p]
        filters.append(f"[{i}:v]{NORMALIZE},format=yuv420p,setpts=PTS-STARTPTS[v{i}]")
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]")
        pairs += f"[v{i}][a{i}]"
    filters.append(f"{pairs}concat=n={len(paths)}:v=1:a=1[v][a]")
    out = os.path.join(w, "avatar_junto.mp4")
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
         *ENC, "-c:a", "aac", "-b:a", "192k", out], "juntar avatares")
    log(f"{len(paths)} vídeos do avatar juntados ({duration(out):.1f}s)")
    return out


def process(job):
    w = job["workdir"]
    os.makedirs(w, exist_ok=True)
    lang = job.get("lang") or "es"
    fx = {**FX_DEFAULTS, **(job.get("fx") or {})}
    log(f"START {job['name']}")
    on = [k for k in FX_DEFAULTS if fx[k] != FX_DEFAULTS[k] and k not in ("cor_destaque", "musica_volume")]
    if on:
        log(f"efeitos: {', '.join(on)}")

    avatars = job.get("avatars") or [job["avatar"]]
    av = join_avatars(avatars, w) if len(avatars) > 1 else avatars[0]
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
            # Zoom nos cortes (opcional): trechos ímpares 10% mais fechados, alternando o enquadramento a cada corte.
            vf = NORMALIZE + (",scale=1188:2112,crop=1080:1920" if fx["zoom_cortes"] and i % 2 == 1 else "")
            run(["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", av, "-vf", vf, *ENC,
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

    # Linha do tempo das palavras depois dos cortes (o hub usa para os gráficos animados entrarem na palavra certa).
    if job.get("timeline_out"):
        with open(job["timeline_out"], "w", encoding="utf-8") as f:
            json.dump({"duration": jd, "words": [{"w": x[0], "s": x[1], "e": x[2]} for x in ws2]}, f, ensure_ascii=False)

    # Blocos de legenda (cada um guarda as palavras com tempo, para o estilo "destaque")
    groups = []; cur = []; cs = ce = None
    for wd in caption_words(ws2):
        txt = " ".join(x[0] for x in cur) + (" " if cur else "") + wd[0]
        if len(txt) > MAX_CHARS and cur:
            groups.append((cs, ce, cur)); cur = [wd]; cs, ce = wd[1], wd[2]
        else:
            if not cur: cs = wd[1]
            cur.append(wd); ce = wd[2]
    if cur:
        groups.append((cs, ce, cur))

    with open(os.path.join(w, "s.ass"), "w", encoding="utf-8") as f:
        f.write(ASS_HEADER + caption_events(groups, fx))
    log(f"legendas: {len(groups)} blocos{' (palavra em destaque)' if fx['legenda'] == 'destaque' else ''}")

    # B-rolls com dissolve, nos momentos certos: com "deixa" (palavra falada), entra quando ela é dita;
    # sem deixa (ou deixa não encontrada), segue a grade do padrão (6s, depois a cada 7s). Nunca se sobrepõem.
    brolls = job.get("brolls") or []
    cues = job.get("broll_cues") or []
    plan = plan_brolls(len(brolls), cues, ws2, jd)
    vs = os.path.join(w, "vs.mp4")
    inputs = ["-i", jc]
    flt = f"[0:v]{NORMALIZE}[base];"
    prev = "[base]"
    trans = fx["transicao"] if fx["transicao"] in ("dissolve", "zoom", "slide") else "dissolve"
    for k, (i, t) in enumerate(plan):
        inputs += ["-i", brolls[i]]
        # Transição de entrada: dissolve (padrão), zoom (entra 15% mais perto e assenta) ou slide (entra pela direita).
        zoom = ",scale=w='trunc(1080*(1+0.15*max(0,1-t/0.4))/2)*2':h=-2:eval=frame,crop=1080:1920" if trans == "zoom" else ""
        fade_in = "" if trans == "slide" else f"fade=t=in:st=0:d={FADE_DUR}:alpha=1,"
        flt += (f"[{k + 1}:v]trim=0:{BR_CLIP},setpts=PTS-STARTPTS,{NORMALIZE}{zoom},format=yuva420p,"
                f"{fade_in}fade=t=out:st={BR_CLIP - FADE_DUR}:d={FADE_DUR}:alpha=1,"
                f"setpts=PTS+{t}/TB[br{k}];")
        x = f"'if(lt(t-{t},0.22),W*(1-(t-{t})/0.22),0)'" if trans == "slide" else "0"
        flt += f"{prev}[br{k}]overlay=x={x}:y=0:eof_action=pass[v{k}];"
        prev = f"[v{k}]"
    # Correção de cor (opcional), aplicada no conjunto para avatar e b-roll ficarem com a mesma cara.
    grade = GRADES.get(fx["cor"])
    flt += f"{prev}{grade}[vout]" if grade else f"{prev}null[vout]"
    run(["ffmpeg", "-y", *inputs, "-filter_complex", flt, "-map", "[vout]", "-map", "0:a", *ENC, "-c:a", "copy", vs], "b-roll")
    if len(brolls) > len(plan):
        log(f"{len(brolls) - len(plan)} b-roll(s) não couberam no tempo do vídeo")
    log(f"b-rolls aplicados: {len(plan)} em {', '.join(f'{t}s' for _, t in sorted(plan, key=lambda p: p[1])) or '-'}")

    # Queima a legenda (roda dentro da pasta de trabalho para o caminho do .ass não precisar de escape)
    fonts = os.path.join(w, "fonts")
    shutil.copytree(job["fontsdir"], fonts, dirs_exist_ok=True)
    # Finalização: legenda + (opcionais) barra de progresso, whoosh nos b-rolls e música que abaixa quando há fala.
    inputs = ["-i", "vs.mp4"]
    vf = "[0:v]ass=s.ass:fontsdir=fonts[vsub]"
    vlast = "[vsub]"
    if fx["barra_progresso"]:
        inputs += ["-f", "lavfi", "-i", f"color=c={(fx.get('cor_destaque') or '#22FF66').replace('#', '0x')}:s=1080x14:d={jd:.3f}:r=30"]
        vf += f";{vlast}[1:v]overlay=x='-W+W*t/{jd:.3f}':y=H-14:eof_action=pass[vbar]"
        vlast = "[vbar]"
    audio_parts, af = ["[0:a]"], []
    if fx["sons"] and plan:
        wpath = make_whoosh(w)
        for k, (_i, t) in enumerate(plan):
            inputs += ["-i", wpath]
            n = sum(1 for x in inputs if x == "-i") - 1
            delay = max(0, int((t - 0.15) * 1000))
            af.append(f"[{n}:a]adelay={delay}|{delay}[wh{k}]")
            audio_parts.append(f"[wh{k}]")
    if fx["musica"] and os.path.exists(fx["musica"]):
        inputs += ["-stream_loop", "-1", "-i", fx["musica"]]
        n = sum(1 for x in inputs if x == "-i") - 1
        vol = min(1.0, max(0.02, float(fx.get("musica_volume") or 0.18)))
        af.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol}[mus]")
        af.append("[mus][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[duck]")
        audio_parts.append("[duck]")
    if len(audio_parts) > 1:
        af.append(f"{''.join(audio_parts)}amix=inputs={len(audio_parts)}:duration=first:normalize=0[aout]")
        graph = ";".join([vf, *af])
        amap, acodec = "[aout]", ["-c:a", "aac", "-b:a", "192k"]
    else:
        graph, amap, acodec = vf, "0:a", ["-c:a", "copy"]
    run(["ffmpeg", "-y", *inputs, "-filter_complex", graph, "-map", vlast, "-map", amap, *ENC, *acodec, "-t", f"{jd:.3f}", "out.mp4"],
        "finalização", cwd=w)

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
