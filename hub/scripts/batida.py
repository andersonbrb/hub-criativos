"""
Edição na batida ("motion na batida"): vídeo curto guiado pela música, com uma cena por batida do grave, palavras
gigantes batendo na tela e efeitos de movimento. Tudo em vídeo de tela cheia (nunca cartão). Roda local com ffmpeg.

Uso: python batida.py job.json
job.json = {
  "name": "AD01", "clips": ["C:/.../cena1.mp4", ...], "song": "C:/.../musica.mp3" | null, "song_start": 0,
  "dur": 15, "bpm": 140, "words": [["PASTEL", "", 2], ["DE", "FEIRA"], ...], "cta": ["CHAMA NO", "WHATSAPP"], "cta_clip": 0,
  (3º item de cada palavra, opcional = índice do vídeo que aparece com ela; sem ele, os vídeos se revezam)
  "accent": "#FFB627", "out": "C:/.../saida.mp4", "workdir": "C:/.../tmp", "fontsdir": "C:/.../fonts"
}
Sem música: gera uma batida própria (sintetizada aqui, sem direitos autorais) no BPM pedido.

Linguagem (padrão de edits que funcionam no feed): tensão antes da "virada" da música (câmera lenta, escuro,
aproximação), flash na virada, depois um corte em cada batida (0,35 a 0,9 s por cena) com entrada em zoom que assenta,
tremida, velocidades variando (rápido, câmera lenta), glitch de cor nas batidas, granulado e vinheta; um "respiro" em
câmera lenta sem palavra de tempos em tempos; no fim, a chamada pulsando no tempo da música.
Sem efeito sonoro de transição (pedido do usuário): o único som é a música.
"""

import json
import math
import os
import shutil
import subprocess
import sys
import time
import wave

import numpy as np

FPS = 60
W, H = 1080, 1920
SR = 44100
ENC = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS)]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, label, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{label}: {r.stderr[-500:]}")


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path], capture_output=True, text=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def q(t):
    """Arredonda para o quadro (1/60 s): cortes caem sempre num quadro inteiro."""
    return round(t * FPS) / FPS


def hsh(n):
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)


# ---------------------------------------------------------------- música
def synth_beat(path, dur, bpm):
    """Batida própria (phonk/trap simples): introdução com bumbo espaçado e subida, virada no 9º tempo, depois
    bumbo + grave em todo tempo, chimbal no contratempo e palma no 2 e 4. Devolve (hits, virada)."""
    b = 60.0 / bpm
    n = int(dur * SR)
    out = np.zeros(n)
    t_all = np.arange(n) / SR

    def add(sig, at, gain=1.0):
        i = int(at * SR)
        if i >= n:
            return
        m = min(len(sig), n - i)
        out[i:i + m] += sig[:m] * gain

    def kick(d=.45):
        t = np.arange(int(d * SR)) / SR
        f = 45 + 110 * np.exp(-t * 28)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)

    def hat(d=.05):
        t = np.arange(int(d * SR)) / SR
        nz = np.random.default_rng(int(d * 1e4)).standard_normal(len(t))
        nz = np.diff(nz, prepend=0)
        return nz * np.exp(-t * 90) * .4

    def clap(d=.25):
        t = np.arange(int(d * SR)) / SR
        nz = np.random.default_rng(3).standard_normal(len(t))
        env = np.exp(-t * 22) + .6 * np.exp(-((t - .012) * 300) ** 2) + .5 * np.exp(-((t - .024) * 300) ** 2)
        return nz * env * .35

    def bass(f, d):
        t = np.arange(int(d * SR)) / SR
        s = np.tanh(2.2 * np.sin(2 * np.pi * f * t)) * np.minimum(1, t * 80) * np.exp(-t * 2.2)
        return s * .55

    def bell(f, d=.18):
        t = np.arange(int(d * SR)) / SR
        return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.76 * t)) * np.exp(-t * 18) * .18

    drop = 8 * b
    hits = []
    # introdução: bumbo a cada 2 tempos + subida de ruído
    for i in range(0, 8, 2):
        add(kick(), i * b, .75)
        hits.append(i * b)
    seg_n = int(drop * SR)
    rng = np.random.default_rng(11)
    riser = rng.standard_normal(seg_n) * np.linspace(0, .22, seg_n) ** 1.6
    add(riser, 0, 1.0)
    # virada: impacto
    t_imp = np.arange(int(1.6 * SR)) / SR
    add(np.sin(2 * np.pi * (40 + 60 * np.exp(-t_imp * 9)) * t_imp) * np.exp(-t_imp * 2.5), drop, .9)
    mel = [69, 72, 74, 72, 69, 67, 64, 67]
    k, t = 0, drop
    while t < dur - 1.0:
        add(kick(), t, 1.0)
        add(bass(55.0 if k % 8 < 4 else 65.4, b * .95), t, 1.0)
        add(hat(), t + b / 2, 1.0)
        if k % 2 == 1:
            add(clap(), t, 1.0)
        add(bell(440 * 2 ** ((mel[k % 8] + 12 - 69) / 12)), t + b * .25, 1.0)
        hits.append(t)
        k += 1
        t += b
    add(np.sin(2 * np.pi * (38 + 50 * np.exp(-t_imp * 8)) * t_imp) * np.exp(-t_imp * 2.0), t, .8)
    out = np.tanh(out * 1.4)
    out *= .89 / (np.abs(out).max() + 1e-9)
    pcm = (out * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return [q(h) for h in hits], q(drop)


def load_mono(path, start, dur):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-i", path, "-t", str(dur), "-ac", "1", "-ar", str(SR),
                        "-f", "s16le", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("não consegui ler a música")
    return np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0


def map_beats(x):
    """Batidas do grave (onde entra cada corte) e a virada (maior salto de energia do grave).
    Fluxo espectral da faixa abaixo de 150 Hz, com picos acima de média + 1,5 desvio e no mínimo 0,2 s entre eles."""
    nfft, hop = 2048, 512
    win = np.hanning(nfft)
    frames = range(0, max(1, len(x) - nfft), hop)
    low_bins = int(150 / (SR / nfft)) + 1
    mag = np.array([np.abs(np.fft.rfft(x[i:i + nfft] * win))[:low_bins] for i in frames])
    energy = mag.sum(1)
    flux = np.maximum(np.diff(mag, axis=0), 0).sum(1)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    step = hop / SR
    hits, last = [], -1.0
    for i in range(1, len(flux) - 1):
        if flux[i] > 1.5 and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]:
            t = (i + 1) * step
            if t - last >= .2:
                hits.append(q(t))
                last = t
    # virada: onde a energia média dos 2 s seguintes mais cresce em relação aos 2 s anteriores
    w2 = int(2 / step)
    best, drop = 1.0, 0.0
    for i in range(int(1.5 / step), len(energy) - w2):
        before = energy[max(0, i - w2):i].mean() + 1e-9
        ratio = energy[i:i + w2].mean() / before
        if ratio > best:
            best, drop = ratio, i * step
    if best < 1.4:
        drop = 0.0
    if drop:
        near = [h for h in hits if abs(h - drop) < .35]
        drop = near[0] if near else q(drop)
    return hits, drop


# ---------------------------------------------------------------- roteiro de cenas
def plan_shots(hits, drop, dur, clips_dur, words, cta, cta_clip=None):
    """Uma cena por batida depois da virada (0,36 a 0,9 s), tensão antes dela, respiro sem palavra a cada ~9 cenas e a
    chamada nos últimos ~2,4 s. O trecho de cada vídeo sai dos primeiros 2/3 dele (vídeo de IA costuma desandar no fim)."""
    shots = []
    cta_at = q(max(drop + 2.0, dur - 2.4)) if cta and (cta[0] or cta[1]) else dur
    cand = [h for h in hits if h >= cta_at] if cta_at < dur else []
    if cand and cand[0] - cta_at < .6:
        cta_at = cand[0]
    if drop >= 1.0:
        shots.append({"t": 0.0, "kind": "build"})
    bounds, last = [], drop
    for h in hits:
        if h <= drop or h >= cta_at:
            continue
        if h - last < .36:
            continue
        while h - last > .9:   # sem batida por muito tempo: corta no meio
            last = q(last + (h - last) / 2 if h - last < 1.8 else last + .6)
            bounds.append(last)
        bounds.append(h)
        last = h
    starts = [drop] + bounds
    nclips = len(clips_dur)
    widx = 0
    speeds = [1.0, .55, 1.7, .8, 1.25, .45]
    zooms = [1.14, 1.4, 1.2, 1.55, 1.28]
    for k, t in enumerate(starts):
        breath = k > 0 and k % 9 == 8
        c = k % nclips
        cd = clips_dur[c]
        shot = {"t": q(t), "kind": "breath" if breath else ("drop" if k == 0 else "cut"), "clip": c,
                "off": round(hsh(k + 3) * max(.1, cd * .65 - .5), 2), "speed": .3 if breath else speeds[k % len(speeds)],
                "zoom": 1.15 if breath else zooms[k % len(zooms)], "mirror": k % 3 == 1, "words": None}
        if not breath and k > 0 and widx < len(words):
            shot["words"] = words[widx][:2]
            if words[widx][2] is not None:   # a palavra pede o vídeo que combina com ela
                shot["clip"] = words[widx][2] % nclips
                shot["off"] = round(hsh(k + 7) * max(.1, clips_dur[shot["clip"]] * .65 - .5), 2)
            widx += 1
        shots.append(shot)
    if cta_at < dur:
        shots.append({"t": q(cta_at), "kind": "cta", "clip": (cta_clip if cta_clip is not None else len(starts)) % nclips, "off": .5, "speed": .6, "zoom": 1.08,
                      "mirror": False, "words": cta})
    for i, s in enumerate(shots):
        s["d"] = q((shots[i + 1]["t"] if i + 1 < len(shots) else dur) - s["t"])
    return [s for s in shots if s["d"] > 0]


# ---------------------------------------------------------------- vídeo
def render_shot(i, s, clips, clips_dur, drop, w):
    """Uma cena: trecho do clipe na velocidade da cena, cobrindo 1080x1920, com zoom de entrada que assenta, tremida
    que decai, desfoque de chicote nos primeiros quadros e espelho alternado. Sai com o número exato de quadros."""
    out = os.path.join(w, f"s{i:03d}.mp4")
    n = max(1, round(s["d"] * FPS))
    if s["kind"] == "build":
        c, off, speed, d = 0, 0.0, .32, s["d"]
        z = f"(1.04+0.22*pow(t/{d:.3f},3))"
        shake = "0"
        blur = ""
    else:
        c, off, speed = s["clip"], s["off"], s["speed"]
        punch = .1 if s["kind"] == "cta" else .24
        z = f"({s['zoom']}+{punch}*exp(-t/0.11)+0.03*t)"
        amp = 0 if s["kind"] in ("breath", "cta") else 18
        shake = f"{amp}*exp(-t/0.14)*sin(t*83)"
        blur = ",boxblur=12:2:enable='lt(t,0.07)'" if s["kind"] in ("cut", "drop") else ""
    cd = clips_dur[c]
    off = min(off, max(0.0, cd - .3))
    vf = (f"setpts=(PTS-STARTPTS)/{speed},fps={FPS},"
          f"scale=w='trunc({W}*max({W}/iw\\,{H}/ih)*iw*{z}/{W}/2)*2':h=-2:eval=frame,"
          f"crop={W}:{H}:'(iw-{W})/2+{shake}':'(ih-{H})/2+({shake})*0.6'"
          + (",hflip" if s.get("mirror") else "") + blur + ",setsar=1,format=yuv420p")
    run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-ss", f"{off:.3f}", "-i", clips[c], "-vf", vf,
         "-frames:v", str(n), "-an", *ENC, out], f"cena {i + 1}")
    return out


def ass_color(hex_color):
    h = (hex_color or "#FFB627").lstrip("#")
    if len(h) != 6:
        h = "FFB627"
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60); c = int(round((t % 1) * 100))
    if c >= 100:
        s += 1; c = 0
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def size_for(txt):
    """Tamanho da palavra: o maior que cabe em 780 px (área segura), até 300."""
    n = max(1, len(txt))
    return int(max(130, min(360, 780 / (0.4 * n))))


def captions(shots, hits, accent, path):
    acc = ass_color(accent)
    head = ("[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nPlayResX: 1080\nPlayResY: 1920\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
            "MarginL, MarginR, MarginV, Encoding\n"
            "Style: W,Anton,200,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,0,9,5,150,150,0,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    ev = []
    for s in shots:
        if not s.get("words"):
            continue
        top, bot = [(x or "").upper().replace("{", "").replace("}", "") for x in (s["words"] + ["", ""])[:2]]
        a, b = s["t"], s["t"] + s["d"] - 0.01
        slam = "{\\fscx150\\fscy150\\t(0,110,\\fscx100\\fscy100)}"
        pulse = ""
        if s["kind"] == "cta":   # a chamada pulsa em cada batida enquanto estiver na tela
            for h in hits:
                if a + .15 < h < b:
                    ms = int((h - a) * 1000)
                    pulse += f"\\t({ms},{ms + 60},\\fscx108\\fscy108)\\t({ms + 60},{ms + 280},\\fscx100\\fscy100)"
        ft, fb = size_for(top), size_for(bot)
        if top and bot:
            y_top, y_bot = 960 - ft * .52, 960 + fb * .5
            ev.append(f"Dialogue: 0,{ts(a)},{ts(b)},W,,0,0,0,,{{\\pos(540,{y_top:.0f})\\fs{ft}}}{top}")
            ev.append(f"Dialogue: 1,{ts(a)},{ts(b)},W,,0,0,0,,{{\\pos(540,{y_bot:.0f})\\fs{fb}\\c{acc}{pulse}}}{slam if not pulse else ''}{bot}")
        else:
            txt, fs = (top, ft) if top else (bot, fb)
            color = "" if top else f"\\c{acc}"
            ev.append(f"Dialogue: 0,{ts(a)},{ts(b)},W,,0,0,0,,{{\\pos(540,960)\\fs{fs}{color}{pulse}}}{slam if not pulse else ''}{txt}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(head + "\n".join(ev) + "\n")
    return len(ev)


def process(job):
    w = job["workdir"]
    os.makedirs(w, exist_ok=True)
    log(f"START {job['name']}")
    clips = [c for c in job.get("clips") or [] if os.path.exists(c)]
    if not clips:
        raise RuntimeError("nenhum vídeo de cena")
    clips_dur = [duration(c) for c in clips]
    dur = float(job.get("dur") or 15)
    song = job.get("song")
    wav = os.path.join(w, "musica.wav")
    if song and os.path.exists(song):
        start = float(job.get("song_start") or 0)
        dur = min(dur, max(3.0, duration(song) - start))
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-i", song, "-t", f"{dur:.3f}", "-ar", "48000", "-ac", "2", wav], "música")
        hits, drop = map_beats(load_mono(song, start, dur))
        log(f"música: {dur:.1f}s, {len(hits)} batidas, virada em {drop:.2f}s")
    else:
        bpm = int(job.get("bpm") or 140)
        hits, drop = synth_beat(wav, dur, bpm)
        log(f"batida própria: {bpm} BPM, {len(hits)} batidas, virada em {drop:.2f}s")
    dur = q(dur)
    words = [[str(x[0] if len(x) > 0 else ""), str(x[1] if len(x) > 1 else ""),
              int(x[2]) if len(x) > 2 and str(x[2]).lstrip("-").isdigit() else None]
             for x in (job.get("words") or []) if x and (x[0] or (len(x) > 1 and x[1]))]
    cta = [str(x) for x in (job.get("cta") or ["", ""])][:2]
    cc = job.get("cta_clip")
    shots = plan_shots(hits, drop, dur, clips_dur, words, cta, int(cc) if isinstance(cc, int) else None)
    log(f"roteiro: {len(shots)} cenas ({sum(1 for s in shots if s.get('words'))} com palavras), {len(clips)} vídeos de origem")

    parts = [render_shot(i, s, clips, clips_dur, drop, w) for i, s in enumerate(shots)]
    lst = os.path.join(w, "l.txt")
    with open(lst, "w", encoding="utf-8") as f:
        f.write("\n".join(f"file '{p.replace(os.sep, '/')}'" for p in parts))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", os.path.join(w, "base.mp4")], "juntar cenas")
    log("cenas renderizadas")

    n_words = captions(shots, hits, job.get("accent"), os.path.join(w, "p.ass"))
    shutil.copytree(job["fontsdir"], os.path.join(w, "fonts"), dirs_exist_ok=True)
    # Acabamento: escuro antes da virada e flash nela; glitch de cor em batidas alternadas; vinheta; granulado; palavras.
    after = [h for h in hits if drop < h < dur - .2][::2]
    glitch = "+".join(f"between(t,{h:.3f},{h + .07:.3f})" for h in after) or "0"
    bright = (f"if(lt(t,{drop:.3f}),-0.22*(1-t/{max(drop, .01):.3f}),0.5*exp(-(t-{drop:.3f})/0.07))" if drop > 0 else "0")
    vf = (f"eq=brightness='{bright}':eval=frame,"
          f"rgbashift=rh=16:bh=-16:gv=6:enable='{glitch}',"
          "vignette=PI/4.5,noise=alls=10:allf=t,"
          "ass=p.ass:fontsdir=fonts,format=yuv420p")
    run(["ffmpeg", "-y", "-v", "error", "-i", "base.mp4", "-i", "musica.wav", "-vf", vf,
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000",
         "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "12M", "-bufsize", "24M",
         "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-t", f"{dur:.3f}", "-movflags", "+faststart", "out.mp4"], "acabamento", cwd=w)
    shutil.move(os.path.join(w, "out.mp4"), job["out"])
    log(f"palavras: {n_words} entradas; arquivo final: {os.path.getsize(job['out']) / 1e6:.1f} MB, {duration(job['out']):.1f}s")
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
