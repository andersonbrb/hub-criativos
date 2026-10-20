"""
Edição final do criativo (hub_montage no chat e tela Edição), rodando local, sem custo.

Segue o contexto do Sávio (decisão do Vinícius em 20/10/2026: como fazer vídeo segue só o contexto do Sávio;
documento "decisoes-pendentes" da Memória). Em resumo:
- Silêncio acima de 0,35 s cortado deixando 0,12 s; os cortes caem na fronteira das palavras.
- Legenda pelo roteiro quando há roteiro: o texto é o do roteiro e o tempo vem da fala dos vídeos ORIGINAIS do avatar,
  antes dos cortes (nunca de uma transcrição do vídeo montado, que já deslizou até 0,7 s).
- Estilo "drop" (padrão): Poppins Bold ~107 px com centro em y=1060; estilo "sb": Anton ~116 px em y=1480. Branca com
  contorno preto, 1 palavra-chave amarela por bloco, até 3 palavras/16 caracteres, "pop" de entrada.
- Troca de plano a cada 1,1 a 4 s (enquadramento alternando 1,00/1,13, o jump cut do Sávio); b-roll de 2 a 4 s na
  tela; sem deixa, o b-roll entra a cada ~10–15 s de avatar.
- Voz a -15 LUFS; música a -32 LUFS sob a fala, com ducking de 11 dB; final a -14 LUFS com pico de -1,5 dBTP.
- Entrega: H.264 high, yuv420p, 30 fps, AAC 48 kHz estéreo 128k, +faststart, até 30 MB (piso de 900 kbps: se não
  couber sem descer dele, sai maior e o registro avisa). 720 de largura quando a origem é baixa (lado menor abaixo de
  720 px), 1080 nos outros casos ou quando pedirem. Formatos 9:16 (padrão), 4:5 e 1:1.
- CTA sem cara de botão: 2 setas vermelhas que entram na palavra do CTA e ficam até o fim. Aviso opcional numa faixa
  opaca no rodapé (ex.: "Solo con fines demostrativos. Algunas escenas están aceleradas.").
- Whoosh opcional na entrada de cada b-roll (o lote Yara validado usa whoosh e punch-in).

Uso: python montagem.py job.json              edição completa
     python montagem.py --finalizar job.json  só a entrega (depois dos gráficos animados, que o hub aplica)

job.json = {
  "name": "AD 01 - OFERTA-9x16-ES-V1", "avatars": ["C:/.../a1.mp4", ...], "brolls": [...], "broll_cues": [...],
  "lang": "es", "out": "C:/.../saida.mp4", "workdir": "C:/.../tmp", "fontsdir": "C:/.../fonts",
  "avatar_words": [[["palavra", 0.1, 0.4], ...], ...]   (opcional: palavras com tempo de cada vídeo do avatar)
  "roteiro": "texto falado" | null, "formato": "9:16" | "4:5" | "1:1", "resolucao": "auto" | "720" | "1080",
  "limite_mb": 30, "cta": {"palavra": "pide"} | {"inicio": 22.5} | null, "aviso": "texto" | null,
  "graficos_depois": false, "entrega_out": "C:/.../id.entrega.json", "timeline_out": "C:/.../id.timeline.json",
  "fx": {...}  (FX_DEFAULTS)
}

Correções em relação ao código original do playbook: áudio lido pelo ffmpeg (a DLL do PyAV é bloqueada pelo Controle
de Aplicativo do Windows), cortes reencodados (com "-c copy" o corte cai no keyframe), "-fps_mode cfr" no lugar de
"-vsync" e fontes carregadas da pasta do hub (fontsdir).
"""

import difflib
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

# ---------- Parâmetros (contexto do Sávio) ----------
MIN_SIL = 0.35   # silêncio acima disto é cortado (audio.py pausas --min 0.35)
PRE_BUF = 0.05   # do silêncio cortado sobram 0,12 s: 0,05 antes da fala seguinte...
POST_BUF = 0.07  # ...e 0,07 depois da fala anterior (--manter 0.12)
PLANO_MIN = 1.1  # troca de plano a cada 1,1 a 4 s
PLANO_MAX = 4.0
ZOOM_FECHADO = 1.13  # jump cut: enquadramento alternando 1,00/1,13 (zoom de montagem até ~1,2x)
BR_MIN = 2.0     # b-roll fica na tela até o fim da frase, entre BR_MIN e BR_MAX segundos (troca de plano até 4 s)
BR_MAX = 4.0
BR_AVATAR_MIN = 10.0  # sem deixa: b-roll a cada ~10–15 s de avatar
BR_AVATAR_MAX = 15.0
FADE_DUR = 0.25  # dissolve de entrada e saída (só nas transições dissolve/zoom)
MAX_CHARS = 16   # legenda: blocos de até 3 palavras/16 caracteres
MAX_WORDS = 3
WHISPER_MODEL = "small"  # NUNCA "tiny" (causa desync)

VOZ_LUFS = -15.0     # voz
MUSICA_LUFS = -32.0  # música sob a fala
DUCK_DB = 11.0       # ducking: a música sobe 11 dB onde não há fala
FINAL_LUFS = -14.0   # final entre -16 e -13, alvo ~-14
FINAL_TP = -1.5      # pico verdadeiro (<= -1 dBTP)
SR = 48000

LIMITE_MB = 30.0
PISO_KBPS = 900      # o montar_ad_rapido do kit usa piso de 900 kbps em 720
AUDIO_KBPS = 128
FORMATOS = {"9:16": 1920, "4:5": 1350, "1:1": 1080}  # altura do quadro base de 1080 de largura

# Posições em px do quadro base de 1080 de largura de cada formato (tabela do kit do Sávio).
LEGENDA_Y = {"9:16": {"drop": 1060, "sb": 1480}, "4:5": {"drop": 745, "sb": 745}, "1:1": {"drop": 596, "sb": 596}}
SETAS = {"9:16": (1630, 1.0), "4:5": (1114, 0.85), "1:1": (876, 0.75)}  # (y do topo, escala)
SETAS_COM_AVISO = {"9:16": 1490}  # com faixa no rodapé as setas sobem (selo ~1110, setas ~1490)
SETA_PX = 170
SETA_CENTROS = (385, 695)  # setas de ~170 px em x 300 e 610 (bordas esquerdas)
AVISO_TOPO_REL = 0.898     # faixa de aviso no rodapé (1150 de 1280)
ESTILOS = {
    "drop": {"fonte": "Poppins", "px": 107, "negrito": -1},  # Poppins Bold
    "sb": {"fonte": "Anton", "px": 116, "negrito": 0},       # o Anton já é pesado (sem negrito falso)
}
AMARELO = "#FFE000"
VERMELHO = (225, 20, 20)

# Intermediários com pouca perda; a qualidade final sai na entrega.
ENC = ["-c:v", "libx264", "-r", "30", "-fps_mode", "cfr", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "17"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, label, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{label}: {r.stderr[-400:]}")
    return r


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path], capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def video_size(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        w, h = r.stdout.strip().splitlines()[0].split(",")[:2]
        return int(w), int(h)
    except (ValueError, IndexError):
        return None


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


def audio_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return duration(path)


def given_words(job, paths):
    """Palavras com tempo que o hub já tem (transcrição em cache de cada vídeo do avatar), uma lista por vídeo;
    somadas pela duração do áudio de cada vídeo, viram a linha do tempo do avatar juntado."""
    lists = job.get("avatar_words")
    if not lists or len(lists) != len(paths):
        return None
    out, off = [], 0.0
    for p, lst in zip(paths, lists):
        out += [(str(w), off + float(s), off + float(e)) for w, s, e in lst if str(w).strip()]
        off += audio_duration(p)
    return out


def remap(ws, merged):
    """Leva os tempos das palavras para a linha do tempo depois dos cortes de silêncio (sem transcrever de novo).
    Palavra que caiu num silêncio cortado (ex.: palavra do roteiro que a transcrição não ouviu) fica colada no fim do
    trecho anterior, para não sumir da legenda."""
    out, acc = [], 0.0
    spans = []
    for a, b in merged:
        spans.append((a, b, acc))
        acc += b - a
    for w, s, e in ws:
        hit = None
        for a, b, off in spans:
            if a - 0.05 <= s < b:
                hit = (w, off + max(0.0, s - a), off + max(0.0, min(e, b) - a))
                break
        if hit is None:
            prev = [sp for sp in spans if sp[1] <= s]
            if prev:
                a, b, off = prev[-1]
                t = off + (b - a)
                hit = (w, max(0.0, t - 0.06), t)
            elif spans:
                hit = (w, 0.0, 0.06)
        if hit:
            out.append(hit)
    return out


def ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60); c = int(round((t % 1) * 100))
    if c >= 100: s += 1; c = 0
    if s >= 60: m += 1; s = 0
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def normalize_vf(h):
    return f"scale=1080:{h}:force_original_aspect_ratio=increase,crop=1080:{h},setsar=1,fps=30"


# ---------- Efeitos (job["fx"]) ----------
FX_DEFAULTS = {
    "estilo": "drop",           # estilo da legenda do Sávio: "drop" (Poppins, y=1060) | "sb" (Anton, y=1480)
    "legenda": "bloco",         # "bloco" (o bloco inteiro com a palavra-chave em amarelo) | "palavra" (palavra a palavra)
    "maiusculas": False,        # ignorado: a legenda sai do jeito que foi falada (decisão do Vinícius, 20/10/2026)
    "zoom_cortes": True,        # troca de plano: alterna 1,00/1,13 a cada 1,1–4 s
    "transicao": "corte",       # entrada do b-roll: "corte" (seco, padrão) | "dissolve" | "zoom" | "slide"
    "whoosh": False,            # som de whoosh na entrada de cada b-roll
    "musica": None,             # caminho de um áudio do hub para fundo (-32 LUFS sob a fala, ducking de 11 dB)
    "cor": "nenhuma",           # correção de cor: "nenhuma" | "quente" | "fria" | "vivo"
    "barra_progresso": False,   # barra fina no rodapé mostrando o andamento do vídeo
}
GRADES = {
    "quente": "eq=saturation=1.12:gamma_r=1.04:gamma_b=0.96",
    "fria": "eq=saturation=1.05:gamma_r=0.97:gamma_b=1.05",
    "vivo": "eq=saturation=1.25:contrast=1.06",
}


def fx_de(job):
    fx = {**FX_DEFAULTS, **{k: v for k, v in (job.get("fx") or {}).items() if v is not None}}
    if fx.get("estilo") not in ESTILOS:
        fx["estilo"] = "drop"
    # Nomes antigos ("padrao"/"destaque") viram o bloco com palavra-chave em amarelo do Sávio.
    if fx.get("legenda") not in ("bloco", "palavra"):
        fx["legenda"] = "bloco"
    return fx


def ass_color(hex_color, default="FFE000"):
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


def clean_word(w):
    """Legenda sem pontuação de fim (vírgula, ponto, dois-pontos): fica mais limpa. Mantém ? e !."""
    return re.sub(r"[.,;:…]+$", "", w) or w


def keyword_index(ws):
    """Palavra-chave do bloco: número/preço primeiro; senão a palavra mais longa com 5+ letras; senão nenhuma."""
    for k, (w, _s, _e) in enumerate(ws):
        if re.search(r"\d", w):
            return k
    best = max(range(len(ws)), key=lambda k: len(clean_word(ws[k][0])))
    return best if len(clean_word(ws[best][0])) >= 5 else None


def caption_events(groups, fx, y):
    """Eventos ASS, um bloco curto por vez, centrado em (540, y), com "pop" de entrada.
    bloco: o bloco inteiro de uma vez, com 1 palavra-chave em amarelo (kit do Sávio).
    palavra: cada palavra aparece quando é dita; a palavra-chave do bloco fica em amarelo."""
    hl = ass_color(AMARELO)
    out = []
    for a, b, ws in groups:
        # Do jeito que foi falada: maiúsculas e minúsculas normais, nunca tudo em caixa alta (decisão do Vinícius, 20/10/2026).
        words_txt = [clean_word(w) for w, _s, _e in ws]
        key = keyword_index(ws)
        chars = len(" ".join(words_txt))
        # Palavra única muito longa: aperta na horizontal para caber na área segura.
        sx = 100 * MAX_CHARS / chars if chars > MAX_CHARS + 2 else 100
        pop = (f"\\fscx{sx * 0.82:.0f}\\fscy82\\t(0,80,\\fscx{sx * 1.06:.0f}\\fscy106)"
               f"\\t(80,150,\\fscx{sx:.0f}\\fscy100)")
        squeeze = f"\\fscx{sx:.0f}" if sx != 100 else ""
        pos = f"\\an5\\pos(540,{y})"

        def paint(k, x):
            return f"{{\\c{hl}}}{x}{{\\c&H00FFFFFF&}}" if k == key else x

        if fx["legenda"] != "palavra":
            text = " ".join(paint(k, x) for k, x in enumerate(words_txt))
            out.append(f"Dialogue: 0,{ts(a)},{ts(b)},Default,,0,0,0,,{{{pos}{pop}}}{text}\n")
            continue
        for j in range(len(ws)):
            start = a if j == 0 else ws[j][1]
            end = ws[j + 1][1] if j + 1 < len(ws) else b
            if end <= start:
                continue
            parts = [paint(k, x) if k <= j else f"{{\\alpha&HFF&}}{x}{{\\alpha&H00&}}" for k, x in enumerate(words_txt)]
            anim = pop if j == 0 else squeeze
            out.append(f"Dialogue: 0,{ts(start)},{ts(end)},Default,,0,0,0,,{{{pos}{anim}}}{' '.join(parts)}\n")
    return "".join(out)


def ass_header(fx, h, aviso_px):
    est = ESTILOS[fx["estilo"]]
    return (
        f"[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nPlayResX: 1080\nPlayResY: {h}\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{est['fonte']},{est['px']},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,"
        f"{est['negrito']},0,0,0,100,100,0,0,1,6,2,5,40,40,0,1\n"
        f"Style: Aviso,Poppins,{aviso_px},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,"
        "-1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def sentence_starts(ws, jd):
    """Pontos de troca de enquadramento (depois dos cortes): início de frase ou de trecho (depois de . , ! ? ; :
    ou de uma pausa > 0,3s), com PLANO_MIN entre trocas e no máximo PLANO_MAX sem troca."""
    starts = [0.0]
    for k in range(1, len(ws)):
        s = max(0.0, ws[k][1] - 0.05)
        if s >= jd - 0.8 or s - starts[-1] < PLANO_MIN:
            continue
        boundary = re.search(r"[.,!?;:…]$", ws[k - 1][0]) or ws[k][1] - ws[k - 1][2] > 0.3
        if boundary or s - starts[-1] > PLANO_MAX:
            starts.append(round(s, 3))
    # Trecho longo sem palavra (ex.: gancho visual antes da fala) também troca de plano dentro do limite.
    filled = []
    for k, s in enumerate(starts):
        filled.append(s)
        nxt = starts[k + 1] if k + 1 < len(starts) else jd
        while nxt - filled[-1] > PLANO_MAX + 0.01:
            filled.append(round(filled[-1] + PLANO_MAX, 3))
    return filled


def rhythm_zoom(starts, jd, h):
    """Troca de plano: a cada frase o enquadramento alterna entre aberto (100%) e fechado (113%), com uma aproximação
    lenta dentro da frase. Enquadra um pouco acima do centro para não cortar a cabeça."""
    ends = starts[1:] + [jd]
    expr = "1"
    for k in range(len(starts) - 1, -1, -1):
        z0 = 1.0 if k % 2 == 0 else ZOOM_FECHADO
        dur = max(0.5, ends[k] - starts[k])
        expr = f"if(lt(t,{ends[k]:.3f}),{z0}+0.04*(t-{starts[k]:.3f})/{dur:.3f},{expr})"
    return (f"scale=w='trunc(1080*({expr})/2)*2':h=-2:eval=frame,"
            f"crop=1080:{h}:(iw-1080)/2:(ih-{h})*0.3")


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


def cue_hits(cue, ws, after=0.0):
    """Todos os momentos (s), a partir de `after`, em que a fala diz a deixa (uma ou mais palavras, começo de palavra)."""
    toks = [t for t, _ in num_tokens([(t, 0) for t in norm(cue).split()])]
    if not toks:
        return []
    words_ = num_tokens([(t, x[1]) for x in ws for t in norm(x[0]).split()])
    hits = []
    for i in range(len(words_)):
        if words_[i][1] < after:
            continue
        if all(i + k < len(words_) and tok_hit(words_[i + k][0], toks[k]) for k in range(len(toks))):
            hits.append(words_[i][1])
    return hits


def find_cue(cue, ws, after):
    hits = cue_hits(cue, ws, after)
    return hits[0] if hits else None


# ---------- Legenda pelo roteiro ----------
AUDIO_TAG = re.compile(r"\[[^\]\n]{1,40}\]")


def script_tokens(roteiro):
    """Palavras do roteiro como serão escritas na legenda (sem as tags de emoção do ElevenLabs, como [excited])."""
    texto = AUDIO_TAG.sub(" ", roteiro or "")
    return [t for t in texto.split() if norm(t)]


def align_script(roteiro, ws):
    """Legenda pelo roteiro: cada palavra do roteiro recebe o tempo da palavra correspondente na fala original
    (ws: palavras ouvidas nos vídeos do avatar, antes dos cortes). Trecho que a transcrição ouviu diferente recebe o
    tempo daquele trecho, dividido pelo tamanho das palavras; palavra que ela não ouviu fica no vão entre as vizinhas.
    Devolve (palavras, fração do roteiro que bateu) ou (None, fração) quando o roteiro não é desta fala."""
    toks = script_tokens(roteiro)
    if not toks or not ws:
        return None, 0.0
    a = [norm(t) for t in toks]
    b = [norm(w) for w, _s, _e in ws]
    out = [None] * len(toks)
    matched = 0
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)

    def spread(i1, i2, t0, t1):
        n = i2 - i1
        if n <= 0:
            return
        t1 = max(t1, t0 + 0.06 * n)
        weights = [max(1, len(a[i])) for i in range(i1, i2)]
        total = float(sum(weights))
        t = t0
        for k, i in enumerate(range(i1, i2)):
            d = (t1 - t0) * weights[k] / total
            out[i] = (toks[i], round(t, 3), round(t + d, 3))
            t += d

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                _w, s, e = ws[j1 + k]
                out[i1 + k] = (toks[i1 + k], s, e)
            matched += i2 - i1
        elif op == "replace":
            spread(i1, i2, ws[j1][1], ws[j2 - 1][2])
        elif op == "delete":
            t0 = ws[j1 - 1][2] if j1 > 0 else max(0.0, ws[0][1] - 0.3)
            t1 = ws[j1][1] if j1 < len(ws) else t0 + 0.3 * (i2 - i1)
            spread(i1, i2, t0, max(t0, t1))
        # insert: palavra ouvida que não está no roteiro (improviso ou erro da transcrição) não entra na legenda.
    ratio = matched / len(toks)
    if ratio < 0.5:
        return None, ratio
    # Garante a ordem no tempo (tempos emprestados do vão nunca voltam para trás).
    res, last = [], 0.0
    for x in out:
        if x is None:
            continue
        w, s, e = x
        s = max(s, last)
        e = max(e, s + 0.04)
        res.append((w, s, e))
        last = s
    return res, ratio


# ---------- B-roll ----------
def phrase_end(t, ws):
    """Fim da frase falada em t: a primeira palavra (a partir de t + BR_MIN) que termina em pontuação ou é seguida
    de uma pausa. O b-roll fica até ali, entre BR_MIN e BR_MAX."""
    for k, (w, _s, e) in enumerate(ws):
        if e < t + BR_MIN:
            continue
        gap = ws[k + 1][1] - e if k + 1 < len(ws) else 1.0
        if re.search(r"[.!?…,;:]$", w) or gap > 0.25:
            return min(t + BR_MAX, e + 0.1)
        if e > t + BR_MAX:
            break
    return t + min(BR_MAX, 3.0)


def plan_brolls(n, cues, ws, jd, cuts=(), src=()):
    """[(índice do b-roll, início, duração)] na ordem dos b-rolls, sem sobreposição e dentro do vídeo.
    Com deixa: entra quando a palavra é dita. Sem deixa: depois de ~10–15 s de avatar (regra do Sávio para vídeo com
    avatar), puxado para o corte de silêncio mais próximo dentro dessa janela (o b-roll cobre o pulo do jump cut).
    Duração: até o fim da frase."""
    plan, free_at = [], 0.0
    for i in range(n):
        cue = cues[i] if i < len(cues) else ""
        t = None
        if cue:
            hit = find_cue(cue, ws, free_at)
            if hit is not None:
                t = round(max(0.0, hit - 0.1), 2)
                log(f"b-roll {i + 1}: deixa \"{cue}\" falada em {hit:.1f}s")
            else:
                log(f"b-roll {i + 1}: deixa \"{cue}\" não encontrada na fala; entra depois de ~10–15 s de avatar")
        if t is None:
            lo, hi = free_at + BR_AVATAR_MIN, free_at + BR_AVATAR_MAX
            near = [c - 0.4 for c in cuts if lo <= c - 0.4 <= hi]
            mid = free_at + (BR_AVATAR_MIN + BR_AVATAR_MAX) / 2
            t = round(min(near, key=lambda c: abs(c - mid)) if near else free_at + 12.0, 2)
        d = phrase_end(t, ws) - t
        if i < len(src) and src[i]:
            d = min(d, src[i] - 0.05)
        d = round(max(BR_MIN, min(BR_MAX, d)), 2)
        if t + d > jd:
            continue
        plan.append((i, t, d))
        free_at = t + d
    return plan


def join_avatars(paths, w, h):
    """Vários vídeos do avatar (ex.: gancho + body, várias tomadas): junta na ordem, no mesmo tamanho e fps,
    antes dos cortes. Daí em diante a montagem trata como um vídeo só."""
    for i, p in enumerate(paths):
        if not has_audio(p):
            raise RuntimeError(f"o vídeo do avatar {i + 1} não tem áudio")
    inputs, filters, pairs = [], [], ""
    for i, p in enumerate(paths):
        inputs += ["-i", p]
        filters.append(f"[{i}:v]{normalize_vf(h)},format=yuv420p,setpts=PTS-STARTPTS[v{i}]")
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]")
        pairs += f"[v{i}][a{i}]"
    filters.append(f"{pairs}concat=n={len(paths)}:v=1:a=1[v][a]")
    out = os.path.join(w, "avatar_junto.mov")
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
         *ENC, "-c:a", "pcm_s16le", out], "juntar avatares")
    log(f"{len(paths)} vídeos do avatar juntados ({duration(out):.1f}s)")
    return out


def pick_width(pedido, paths):
    """Largura de entrega (regra do Sávio): origem baixa (lado menor abaixo de 720 px) sai em 720; 1080 só com origem de
    720 ou mais (ou AD vencedor refeito, quando pedirem 1080)."""
    if str(pedido) in ("720", "1080"):
        log(f"resolução pedida: {pedido} de largura")
        return int(pedido)
    lados = []
    for p in paths:
        sz = video_size(p)
        if sz:
            lados.append(min(sz))
    menor = min(lados) if lados else 1080
    largura = 720 if menor < 720 else 1080
    log(f"resolução: {largura} de largura (origem com lado menor de {menor} px)")
    return largura


# ---------- Áudio (voz -15, música -32 sob a fala com ducking de 11 dB, final -14) ----------
def raw_in(path):
    return ["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", path]


def measure_lufs(args_in):
    """Loudness integrado (LUFS) do que entra em args_in; None se não houver som."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args_in, "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.findall(r"I:\s+(-?[\d.]+|-inf)\s+LUFS", r.stderr)
    if not m or m[-1] == "-inf":
        return None
    v = float(m[-1])
    return v if v > -70 else None


def read_pcm(path, dur, loop=False):
    args = ["ffmpeg", "-v", "error"] + (["-stream_loop", "-1"] if loop else []) + ["-i", path, "-t", f"{dur:.3f}",
                                                                                  "-vn", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"áudio: {r.stderr.decode('utf-8', 'replace')[-300:]}")
    return np.frombuffer(r.stdout, np.float32).reshape(-1, 2).copy()


def fit(arr, n):
    if len(arr) >= n:
        return arr[:n]
    return np.vstack([arr, np.zeros((n - len(arr), 2), np.float32)])


def speech_envelope(ws, dur, fps=100, ataque=0.08, soltura=0.35):
    """1 onde há fala, 0 onde não há, com subida (a música abaixa um pouco antes da fala) e descida suaves."""
    n = int(np.ceil(dur * fps)) + 2
    alvo = np.zeros(n)
    spans = []
    for _w, s, e in ws:
        if spans and s - spans[-1][1] < 0.4:
            spans[-1][1] = max(spans[-1][1], e)
        else:
            spans.append([s, e])
    for s, e in spans:
        alvo[max(0, int((s - ataque) * fps)):min(n, int(np.ceil((e + 0.05) * fps)))] = 1.0
    env = np.zeros(n)
    y = 0.0
    up, down = 1.0 / max(1, ataque * fps), 1.0 / max(1, soltura * fps)
    for i in range(n):
        y = min(alvo[i], y + up) if alvo[i] > y else max(alvo[i], y - down)
        env[i] = y
    return env, fps


def whoosh(w):
    """Whoosh curto sintetizado aqui (ruído rosa filtrado, sobe e some), sem direito autoral."""
    path = os.path.join(w, "whoosh.f32")
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:r=48000:a=0.6",
         "-af", "highpass=f=350,lowpass=f=5000,afade=t=in:st=0:d=0.32:curve=exp,afade=t=out:st=0.32:d=0.18",
         "-f", "f32le", "-ac", "2", "-ar", str(SR), path], "whoosh")
    arr = np.fromfile(path, np.float32).reshape(-1, 2)
    peak = float(np.max(np.abs(arr))) or 1.0
    return arr * (10 ** (-18 / 20) / peak)


def build_audio(jc, ws2, jd, fx, w, broll_starts):
    """Voz tratada a -15 LUFS + música a -32 LUFS sob a fala (11 dB acima onde não há fala) + whoosh opcional.
    Devolve o arquivo cru do mix e o filtro da normalização final (-14 LUFS, pico -1,5 dBTP) em duas passadas."""
    n = int(round(jd * SR))
    voz_path = os.path.join(w, "voz.f32")
    run(["ffmpeg", "-y", "-v", "error", "-i", jc, "-vn", "-af",
         "aresample=48000,aformat=channel_layouts=stereo,highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=5:release=150:makeup=1.6",
         "-f", "f32le", "-ac", "2", "-ar", str(SR), voz_path], "voz")
    voz = fit(np.fromfile(voz_path, np.float32).reshape(-1, 2), n)
    lv = measure_lufs(raw_in(voz_path))
    if lv is not None:
        voz = voz * (10 ** ((VOZ_LUFS - lv) / 20))
        log(f"voz: {lv:.1f} LUFS -> {VOZ_LUFS:.0f} LUFS")
    mix = voz.astype(np.float32)

    musica = fx.get("musica")
    if musica and os.path.exists(musica):
        mus = fit(read_pcm(musica, jd, loop=True), n)
        mus_path = os.path.join(w, "musica.f32")
        mus.astype(np.float32).tofile(mus_path)
        lm = measure_lufs(raw_in(mus_path))
        if lm is None:
            log("música sem som; seguindo sem música")
        else:
            env, fps = speech_envelope(ws2, jd)
            t = np.arange(n) / SR
            fala = np.interp(t, np.arange(len(env)) / fps, env)
            ganho = (10 ** ((MUSICA_LUFS - lm) / 20)) * (10 ** ((DUCK_DB * (1.0 - fala)) / 20))
            mix = mix + mus * ganho[:, None].astype(np.float32)
            log(f"música: {lm:.1f} LUFS -> {MUSICA_LUFS:.0f} LUFS sob a fala, ducking de {DUCK_DB:.0f} dB")

    if fx.get("whoosh") and broll_starts:
        sfx = whoosh(w)
        pico = int(0.32 * SR)
        for t0 in broll_starts:
            a = int(round(t0 * SR)) - pico
            s0 = max(0, -a)
            a = max(0, a)
            b = min(n, a + len(sfx) - s0)
            if b > a:
                mix[a:b] += sfx[s0:s0 + (b - a)]
        log(f"whoosh em {len(broll_starts)} entrada(s) de b-roll")

    mix_path = os.path.join(w, "mix.f32")
    mix.astype(np.float32).tofile(mix_path)
    # Normalização final em duas passadas (ganho linear, sem mexer na dinâmica do mix).
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *raw_in(mix_path), "-af",
                        f"loudnorm=I={FINAL_LUFS}:TP={FINAL_TP}:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if m:
        st = json.loads(m.group(0))
        flt = (f"loudnorm=I={FINAL_LUFS}:TP={FINAL_TP}:LRA=11:measured_I={st['input_i']}:measured_TP={st['input_tp']}"
               f":measured_LRA={st['input_lra']}:measured_thresh={st['input_thresh']}:offset={st['target_offset']}"
               ":linear=true,aresample=48000")
    else:
        flt = f"loudnorm=I={FINAL_LUFS}:TP={FINAL_TP}:LRA=11,aresample=48000"
    return mix_path, flt


# ---------- Setas do CTA e faixa de aviso ----------
def arrow_png(w, escala):
    """Seta vermelha apontando para baixo (~170 px), com contorno preto, desenhada aqui (sem depender de imagem)."""
    s = max(40, int(round(SETA_PX * escala)))
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) + 0.5
    c = s / 2.0

    def inside(m):
        # haste no terço de cima + ponta (triângulo) embaixo, com margem m (contorno)
        haste = (np.abs(xx - c) <= s * 0.17 + m) & (yy >= s * 0.04 - m) & (yy <= s * 0.55 + m)
        topo, base = s * 0.45 - m, s * 0.96 + m
        meia = (base - yy) / max(1.0, base - topo) * (s * 0.46 + m)
        ponta = (yy >= topo) & (yy <= base) & (np.abs(xx - c) <= meia)
        return haste | ponta

    borda = inside(s * 0.035)
    miolo = inside(0.0)
    img = np.zeros((s, s, 4), np.uint8)
    img[borda] = (0, 0, 0, 255)
    img[miolo] = (*VERMELHO, 255)
    raw = os.path.join(w, "seta.rgba")
    img.tofile(raw)
    png = os.path.join(w, "seta.png")
    run(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{s}x{s}", "-i", raw, png], "seta")
    return png, s


def cta_start(cta, ws2, jd):
    if not cta:
        return None
    if cta.get("inicio") not in (None, ""):
        try:
            return max(0.0, min(float(cta["inicio"]), jd - 0.5))
        except (TypeError, ValueError):
            pass
    palavra = str(cta.get("palavra") or "").strip()
    if palavra:
        hits = cue_hits(palavra, ws2)
        if hits:
            log(f"CTA: setas entram em \"{palavra}\" ({hits[-1]:.1f}s) e ficam até o fim")
            return max(0.0, hits[-1] - 0.05)
        log(f"CTA: \"{palavra}\" não encontrada na fala; setas nos últimos 3,5 s")
    return max(0.0, jd - 3.5)


# ---------- Entrega ----------
def deliver(src, dst, largura, limite_mb):
    """Padrão de entrega do Sávio: H.264 high, yuv420p, 30 fps, AAC 48 kHz estéreo 128k (já vem pronto), +faststart,
    até limite_mb (bitrate calculado; piso de 900 kbps). Redimensiona para 720 de largura quando for o caso."""
    dur = duration(src)
    limite = float(limite_mb or LIMITE_MB)
    alvo = int(limite * 1e6 * 8 * 0.96 / dur / 1000) - AUDIO_KBPS
    abaixo_do_piso = alvo < PISO_KBPS
    if abaixo_do_piso:
        alvo = PISO_KBPS
    vf = ["-vf", f"scale={largura}:-2:flags=lanczos"] if largura != 1080 else []

    def enc(extra):
        tmp = dst + ".tmp.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", src, *vf, "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast",
             *extra, "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr", "-c:a", "copy", "-movflags", "+faststart", tmp],
            "entrega")
        os.replace(tmp, dst)
        return os.path.getsize(dst) / 1e6

    mb = enc(["-crf", "20", "-maxrate", f"{alvo}k", "-bufsize", f"{2 * alvo}k"])
    if mb > limite and not abaixo_do_piso:
        alvo2 = max(PISO_KBPS, int(alvo * limite / mb * 0.95))
        mb = enc(["-b:v", f"{alvo2}k", "-maxrate", f"{alvo2}k", "-bufsize", f"{alvo2}k"])
    sz = video_size(dst) or (0, 0)
    log(f"entrega: {sz[0]}x{sz[1]}, {mb:.1f} MB, {duration(dst):.1f}s, AAC {AUDIO_KBPS}k")
    if mb > limite:
        log(f"AVISO: passou de {limite:.0f} MB ({mb:.1f} MB): não dá para caber sem descer do piso de {PISO_KBPS} kbps")


def finalize_only(job):
    """--finalizar: entrega do vídeo que já recebeu os gráficos animados (no lugar, no mesmo arquivo)."""
    with open(job["entrega_out"], encoding="utf-8") as f:
        ent = json.load(f)
    # Mesmo nome de sobra que o hub já apaga se algo der errado.
    src = job["out"] + ".gfx.mp4"
    os.replace(job["out"], src)
    try:
        deliver(src, job["out"], int(ent.get("largura") or 1080), ent.get("limite_mb") or LIMITE_MB)
    except Exception:
        os.replace(src, job["out"])
        raise
    os.remove(src)
    log("DONE")


def process(job):
    w = job["workdir"]
    os.makedirs(w, exist_ok=True)
    lang = job.get("lang") or "es"
    fx = fx_de(job)
    formato = job.get("formato") if job.get("formato") in FORMATOS else "9:16"
    h = FORMATOS[formato]
    log(f"START {job['name']}")
    log(f"formato {formato}; legenda {fx['estilo']} ({fx['legenda']})")
    on = [k for k in ("transicao", "whoosh", "musica", "cor", "barra_progresso") if fx[k] != FX_DEFAULTS[k]]
    if not fx["zoom_cortes"]:
        on.append("sem troca de enquadramento")
    if on:
        log(f"efeitos: {', '.join(on)}")

    avatars = job.get("avatars") or [job["avatar"]]
    largura = pick_width(job.get("resolucao") or "auto", avatars)
    av = join_avatars(avatars, w, h) if len(avatars) > 1 else avatars[0]
    if not has_audio(av):
        raise RuntimeError("o vídeo do avatar não tem áudio")
    du = duration(av)
    log(f"duração do avatar: {du:.1f}s")

    # Palavras com tempo da fala ORIGINAL (antes dos cortes): as do hub (transcrição em cache) ou o Whisper local.
    ws = given_words(job, avatars)
    if ws is not None:
        log(f"transcrição: {job.get('motor_das_palavras') or 'do hub'} ({len(ws)} palavras)")
    else:
        from faster_whisper import WhisperModel
        log(f"transcrição: Whisper local '{WHISPER_MODEL}'")
        model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
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
    # O começo e o fim não são cortados a seco: o gancho visual antes da fala e a última palavra ficam.
    merged[0][0] = 0.0 if merged[0][0] < 0.6 else merged[0][0]

    jc = os.path.join(w, "jc.mov")
    copied = len(merged) == 1 and merged[0][0] < 0.1 and merged[0][1] > du - 0.5
    vf = normalize_vf(h)
    if copied:
        run(["ffmpeg", "-y", "-v", "error", "-i", av, "-vf", vf, *ENC, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", jc], "base")
        log("sem silêncios para cortar")
    else:
        parts = []
        for i, (a, b) in enumerate(merged):
            p = os.path.join(w, f"c{i}.mov")
            seg = b - a
            # Micro fade no áudio de cada corte: sem estalo na emenda.
            af = f"afade=t=in:d=0.015,afade=t=out:st={max(0.0, seg - 0.025):.3f}:d=0.025"
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", av, "-vf", vf, "-af", af, *ENC,
                 "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", p], "corte")
            parts.append(p)
        lst = os.path.join(w, "l.txt")
        with open(lst, "w", encoding="utf-8") as f:
            f.write("\n".join(f"file '{p.replace(os.sep, '/')}'" for p in parts))
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", jc], "concat")
        log(f"{len(merged)} trechos de fala, {len(merged) - 1} cortes (silêncio acima de {MIN_SIL}s fica com 0,12s)")
    jd = duration(jc)
    log(f"duração após cortes: {jd:.1f}s (era {du:.1f}s)")
    # Onde ficaram os cortes de silêncio na linha do tempo nova (o b-roll sem deixa cai em cima deles).
    cuts, acc = [], 0.0
    for a, b in merged[:-1]:
        acc += b - a
        cuts.append(round(acc, 2))

    # Legenda pelo roteiro: texto do roteiro, tempo da fala original (antes dos cortes).
    cap = ws
    roteiro = (job.get("roteiro") or "").strip()
    if roteiro:
        alinhado, ratio = align_script(roteiro, ws)
        if alinhado:
            cap = alinhado
            log(f"legenda pelo roteiro ({len(alinhado)} palavras; {round(ratio * 100)}% bateu com a fala)")
        else:
            log(f"o roteiro não bate com a fala ({round(ratio * 100)}%): legenda pela transcrição da fala original")
    else:
        log("sem roteiro: legenda pela transcrição da fala original (antes dos cortes)")
    # Tempos depois dos cortes: remapeados (nunca transcrevendo o vídeo já cortado).
    ws2 = cap if copied else remap(cap, merged)

    # Linha do tempo das palavras depois dos cortes (o hub usa para os gráficos animados entrarem na palavra certa).
    if job.get("timeline_out"):
        with open(job["timeline_out"], "w", encoding="utf-8") as f:
            json.dump({"duration": jd, "words": [{"w": x[0], "s": x[1], "e": x[2]} for x in ws2]}, f, ensure_ascii=False)

    # Blocos de legenda: até 3 palavras/16 caracteres; fim de frase fecha o bloco.
    groups = []; cur = []; cs = ce = None
    for wd in caption_words(ws2):
        txt = " ".join(x[0] for x in cur) + (" " if cur else "") + wd[0]
        if cur and (len(txt) > MAX_CHARS or len(cur) >= MAX_WORDS):
            groups.append((cs, ce, cur)); cur = [wd]; cs, ce = wd[1], wd[2]
        else:
            if not cur: cs = wd[1]
            cur.append(wd); ce = wd[2]
        if re.search(r"[.!?…]$", wd[0]):
            groups.append((cs, ce, cur)); cur = []
    if cur:
        groups.append((cs, ce, cur))
    # Cada bloco fica até o próximo começar (sem piscar entre blocos), no máximo 0,6s depois da última palavra,
    # e a última palavra fica legível por pelo menos 0,3s.
    groups = [(a, max(g[-1][1] + 0.3, min(groups[k + 1][0], b + 0.6)) if k + 1 < len(groups) else b + 0.3, g)
              for k, (a, b, g) in enumerate(groups)]
    groups = [(a, min(b, groups[k + 1][0]) if k + 1 < len(groups) else b, g) for k, (a, b, g) in enumerate(groups)]

    aviso = (job.get("aviso") or "").strip()
    aviso_topo = int(round(h * AVISO_TOPO_REL))
    aviso_px = 34 if h >= 1350 else 30
    events = caption_events(groups, fx, LEGENDA_Y[formato][fx["estilo"]])
    if aviso:
        y = (aviso_topo + h) // 2
        events += f"Dialogue: 1,{ts(0)},{ts(jd + 1)},Aviso,,0,0,0,,{{\\an5\\pos(540,{y})}}{aviso}\n"
    with open(os.path.join(w, "s.ass"), "w", encoding="utf-8") as f:
        f.write(ass_header(fx, h, aviso_px) + events)
    log(f"legendas: {len(groups)} blocos (palavra-chave em amarelo){'; aviso no rodapé' if aviso else ''}")

    # B-rolls nos momentos certos: com "deixa" (palavra falada), entra quando ela é dita; sem deixa (ou deixa não
    # encontrada), depois de ~10–15 s de avatar. Nunca se sobrepõem.
    brolls = job.get("brolls") or []
    cues = job.get("broll_cues") or []
    plan = plan_brolls(len(brolls), cues, ws2, jd, cuts, [duration(b) for b in brolls])
    vs = os.path.join(w, "vs.mov")
    inputs = ["-i", jc]
    if fx["zoom_cortes"]:
        starts = sentence_starts(ws2, jd)
        flt = f"[0:v]{vf},{rhythm_zoom(starts, jd, h)}[base];"
        log(f"troca de plano: {len(starts)} enquadramentos (1,00/{ZOOM_FECHADO:.2f}, a cada {PLANO_MIN}–{PLANO_MAX:.0f}s)")
    else:
        flt = f"[0:v]{vf}[base];"
    prev = "[base]"
    trans = fx["transicao"] if fx["transicao"] in ("corte", "dissolve", "zoom", "slide") else "corte"
    for k, (i, t, d) in enumerate(plan):
        inputs += ["-i", brolls[i]]
        zoom = f",scale=w='trunc(1080*(1+0.15*max(0,1-t/0.4))/2)*2':h=-2:eval=frame,crop=1080:{h}" if trans == "zoom" else ""
        fade_in = f"fade=t=in:st=0:d={FADE_DUR}:alpha=1," if trans in ("dissolve", "zoom") else ""
        fade_out = f"fade=t=out:st={d - FADE_DUR:.3f}:d={FADE_DUR}:alpha=1," if trans in ("dissolve", "zoom") else ""
        flt += (f"[{k + 1}:v]trim=0:{d:.3f},setpts=PTS-STARTPTS,{vf}{zoom},format=yuva420p,"
                f"{fade_in}{fade_out}"
                f"setpts=PTS+{t}/TB[br{k}];")
        x = f"'if(lt(t-{t},0.22),W*(1-(t-{t})/0.22),0)'" if trans == "slide" else "0"
        flt += f"{prev}[br{k}]overlay=x={x}:y=0:eof_action=pass[v{k}];"
        prev = f"[v{k}]"
    grade = GRADES.get(fx["cor"])
    flt += f"{prev}{grade}[vout]" if grade else f"{prev}null[vout]"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", flt, "-map", "[vout]", "-an", *ENC, vs], "b-roll")
    if len(brolls) > len(plan):
        log(f"{len(brolls) - len(plan)} b-roll(s) não couberam no tempo do vídeo")
    log(f"b-rolls aplicados: {len(plan)} em {', '.join(f'{t}s ({d}s)' for _, t, d in sorted(plan, key=lambda p: p[1])) or '-'}")

    # Áudio final (voz, música, whoosh) e normalização em duas passadas.
    mix_path, loud = build_audio(jc, ws2, jd, fx, w, [t for _, t, _ in plan])

    # Mestre: legenda + aviso + barra + setas do CTA + áudio final, no quadro base de 1080.
    fonts = os.path.join(w, "fonts")
    shutil.copytree(job["fontsdir"], fonts, dirs_exist_ok=True)
    ins = ["-i", "vs.mov", *raw_in("mix.f32")]
    n_in = 2
    chain = "[0:v]"
    vfs = []
    if aviso:
        # Faixa quase opaca (alpha >= 250, para nada por baixo aparecer).
        vfs.append(f"{chain}drawbox=x=0:y={aviso_topo}:w=iw:h=ih-{aviso_topo}:color=black@0.985:t=fill[vav]")
        chain = "[vav]"
    vfs.append(f"{chain}ass=s.ass:fontsdir=fonts[vsub]")
    chain = "[vsub]"
    if fx["barra_progresso"]:
        bar_y = (aviso_topo if aviso else h) - 14
        ins += ["-f", "lavfi", "-i", f"color=c=0xFFE000:s=1080x14:d={jd:.3f}:r=30"]
        vfs.append(f"{chain}[{n_in}:v]overlay=x='-W+W*t/{jd:.3f}':y={bar_y}:eof_action=pass[vbar]")
        n_in += 1
        chain = "[vbar]"
    t_cta = cta_start(job.get("cta"), ws2, jd)
    if t_cta is not None:
        y0, escala = SETAS[formato]
        if aviso:
            y0 = SETAS_COM_AVISO.get(formato, int(y0 - (h - aviso_topo) * 0.7))
        png, s = arrow_png(w, escala)
        ins += ["-loop", "1", "-framerate", "30", "-i", png]
        k = n_in
        n_in += 1
        vfs.append(f"[{k}:v]split=2[sa][sb]")
        osc = f"{y0}+20*sin(2*PI*1.5*(t-{t_cta:.3f}))"
        en = f"gte(t,{t_cta:.3f})"
        x1, x2 = SETA_CENTROS[0] - s // 2, SETA_CENTROS[1] - s // 2
        vfs.append(f"{chain}[sa]overlay=x={x1}:y='{osc}':enable='{en}':shortest=1[vc1]")
        vfs.append(f"[vc1][sb]overlay=x={x2}:y='{osc}':enable='{en}':shortest=1[vcta]")
        chain = "[vcta]"
        log(f"CTA: 2 setas vermelhas a partir de {t_cta:.1f}s")
    vfs.append(f"{chain}format=yuv420p[vfin]")
    vfs.append(f"[1:a]{loud}[aout]")
    mestre = os.path.join(w, "mestre.mp4")
    run(["ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", ";".join(vfs), "-map", "[vfin]", "-map", "[aout]",
         "-c:v", "libx264", "-r", "30", "-fps_mode", "cfr", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "16",
         "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ar", "48000", "-ac", "2", "-t", f"{jd:.3f}", "mestre.mp4"],
        "finalização", cwd=w)

    limite = float(job.get("limite_mb") or LIMITE_MB)
    if job.get("entrega_out"):
        with open(job["entrega_out"], "w", encoding="utf-8") as f:
            json.dump({"largura": largura, "limite_mb": limite, "formato": formato}, f)
    if job.get("graficos_depois"):
        # Os gráficos animados (Remotion, no hub) entram em cima deste mestre de 1080; a entrega vem depois (--finalizar).
        shutil.move(mestre, job["out"])
        log(f"mestre pronto para os gráficos animados ({os.path.getsize(job['out']) / 1e6:.1f} MB)")
    else:
        deliver(mestre, job["out"], largura, limite)
    log("DONE")


if __name__ == "__main__":
    finalizar = "--finalizar" in sys.argv
    job_path = [a for a in sys.argv[1:] if a != "--finalizar"][0]
    with open(job_path, encoding="utf-8") as fh:
        job = json.load(fh)
    try:
        if finalizar:
            finalize_only(job)
        else:
            process(job)
    except Exception as err:  # noqa: BLE001
        log(f"ERROR {err}")
        sys.exit(1)
    finally:
        if not finalizar and not job.get("keep_workdir"):
            shutil.rmtree(job["workdir"], ignore_errors=True)
