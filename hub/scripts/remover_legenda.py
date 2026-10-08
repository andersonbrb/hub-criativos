"""
Remover legenda queimada de um vídeo com o LaMa (inpainting: preenche a área do texto com o que "estaria atrás").

Uso: python remover_legenda.py job.json
job.json = {
  "input": "C:/.../video.mp4", "out": "C:/.../saida.mp4", "workdir": "C:/.../tmp", "model": "C:/.../big-lama.pt",
  "region": "baixo" | "meio" | "topo" | "tudo",   # onde procurar a legenda (padrão: baixo)
  "mode": "auto" | "faixa",                        # auto: só os pixels do texto; faixa: a faixa inteira onde há texto
  "band": [0.62, 0.92]                             # opcional: faixa vertical exata (fração da altura) no lugar de region
}

Como funciona, quadro a quadro (o áudio sai igual ao original):
1. Acha o texto: legenda queimada é texto claro (branco, amarelo, verde…) com contorno ou sombra escura. Procura pixels
   claros encostados em pixels escuros, junta em linhas e descarta o que não tem forma de linha de texto.
2. Junta com a máscara do quadro anterior (pega palavras que entram com animação).
3. Recorta só o retângulo do texto (com margem), passa pelo LaMa e cola de volta só onde havia texto.
Quadros sem legenda passam direto. Modelo: big-lama (LaMa, Apache 2.0) em TorchScript, rodando na CPU ou na GPU.
"""

import json
import os
import shutil
import subprocess
import sys
import time

import cv2
import numpy as np
import torch

MODEL_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
REGIONS = {"baixo": (0.55, 0.96), "meio": (0.33, 0.72), "topo": (0.03, 0.42), "tudo": (0.0, 1.0)}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
                        "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True)
    d = json.loads(r.stdout)
    s = d["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    fps = num / den if den else 30.0
    dur = float(d["format"]["duration"])
    n = int(s.get("nb_frames") or 0) or int(round(dur * fps))
    return int(s["width"]), int(s["height"]), fps, n, dur


def has_audio(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return bool(r.stdout.strip())


def text_mask(frame, y0, y1, mode):
    """Máscara (uint8 0/255) do texto da legenda dentro da faixa [y0, y1)."""
    h, w = frame.shape[:2]
    band = frame[y0:y1]
    hsv = cv2.cvtColor(band, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2]
    bright = (v > 195).astype(np.uint8)
    dark = (v < 75).astype(np.uint8)
    k = max(3, int(round(h / 400)) * 2 + 1)                 # ~5 px em 1080x1920
    near_dark = cv2.dilate(dark, np.ones((k, k), np.uint8))
    cand = bright & near_dark                               # claro encostado no escuro = letra com contorno/sombra
    # linhas de texto: junta as letras na horizontal e descarta o que não tem forma de linha
    lw = max(9, w // 40)
    lines = cv2.morphologyEx(cand * 255, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (lw, max(3, k))))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(lines, 8)
    keep = np.zeros_like(lines)
    min_h, max_h = h * 0.008, h * 0.13
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bh < min_h or bh > max_h or bw < w * 0.04 or bw < bh * 1.2:
            continue
        fill = cand[y:y + bh, x:x + bw].mean()
        if fill < 0.04:                                     # muito vazio para ser texto
            continue
        if mode == "faixa":
            keep[y:y + bh, x:x + bw] = 255
        else:
            keep[y:y + bh, x:x + bw] = np.maximum(keep[y:y + bh, x:x + bw], cand[y:y + bh, x:x + bw] * 255)
    if not keep.any():
        return None
    # cobre também o contorno/sombra em volta das letras
    keep = cv2.dilate(keep, np.ones((k * 2 + 1, k * 2 + 1), np.uint8))
    full = np.zeros((h, w), np.uint8)
    full[y0:y1] = keep
    return full


class Lama:
    def __init__(self, path):
        self.dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.m = torch.jit.load(path, map_location=self.dev)
        self.m.eval()
        torch.set_grad_enabled(False)

    def __call__(self, img_bgr, mask):
        """img_bgr uint8 HxWx3, mask uint8 HxW (255 = preencher). Devolve uint8 HxWx3 (BGR)."""
        h, w = mask.shape
        ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        if ph or pw:
            rgb = cv2.copyMakeBorder(rgb, 0, ph, 0, pw, cv2.BORDER_REFLECT)
            mask = cv2.copyMakeBorder(mask, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        t_img = torch.from_numpy(rgb).permute(2, 0, 1)[None].float().div(255).to(self.dev)
        t_mask = torch.from_numpy((mask > 127).astype(np.float32))[None, None].to(self.dev)
        with torch.inference_mode():
            out = self.m(t_img, t_mask)
        res = (out[0].permute(1, 2, 0).clamp(0, 1).mul(255).byte().cpu().numpy())[:h, :w]
        return cv2.cvtColor(res, cv2.COLOR_RGB2BGR)


def fill(lama, frame, mask):
    """Recorta o retângulo do texto (com margem), reduz se for grande, passa no LaMa e cola só onde havia texto."""
    h, w = mask.shape
    ys, xs = np.where(mask > 0)
    pad = max(24, h // 60)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    crop, cm = frame[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    ch, cw = cm.shape
    scale = 1.0 if ch * cw <= 160_000 else (160_000 / (ch * cw)) ** 0.5   # limita o custo por quadro
    if scale < 1.0:
        sc = cv2.resize(crop, (max(8, int(cw * scale)), max(8, int(ch * scale))), interpolation=cv2.INTER_AREA)
        sm = cv2.resize(cm, (sc.shape[1], sc.shape[0]), interpolation=cv2.INTER_NEAREST)
        sm = cv2.dilate(sm, np.ones((3, 3), np.uint8))
        res = cv2.resize(lama(sc, sm), (cw, ch), interpolation=cv2.INTER_CUBIC)
    else:
        res = lama(crop, cm)
    # borda suave entre o preenchido e o original
    alpha = cv2.GaussianBlur((cm > 0).astype(np.float32), (0, 0), 1.5)[..., None]
    out = frame.copy()
    out[y0:y1, x0:x1] = (res * alpha + crop * (1 - alpha)).astype(np.uint8)
    return out


def process(job):
    src = job["input"]
    w_, h_, fps, n, dur = probe(src)
    band = job.get("band")
    f0, f1 = (float(band[0]), float(band[1])) if band else REGIONS.get(job.get("region") or "baixo", REGIONS["baixo"])
    y0, y1 = int(h_ * max(0.0, f0)), int(h_ * min(1.0, f1))
    mode = job.get("mode") if job.get("mode") in ("auto", "faixa") else "auto"
    log(f"START {os.path.basename(src)}: {w_}x{h_}, {fps:.2f} fps, ~{n} quadros, faixa {f0:.2f}–{f1:.2f}, modo {mode}")
    if not os.path.exists(job["model"]):   # primeira vez: baixa o modelo (~200 MB) para .data/models
        import urllib.request
        os.makedirs(os.path.dirname(job["model"]), exist_ok=True)
        log("baixando o modelo LaMa (~200 MB, só na primeira vez)")
        urllib.request.urlretrieve(MODEL_URL, job["model"] + ".part")
        os.replace(job["model"] + ".part", job["model"])
    lama = Lama(job["model"])
    log(f"LaMa carregado ({'GPU' if lama.dev.type == 'cuda' else 'CPU'})")

    os.makedirs(job["workdir"], exist_ok=True)
    tmp = os.path.join(job["workdir"], "video.mp4")
    rd = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    wr = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w_}x{h_}", "-r", f"{fps:.6f}",
                           "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", tmp], stdin=subprocess.PIPE)
    size = w_ * h_ * 3
    prev = None
    done = filled = 0
    t0 = time.time()
    next_report = 0.05
    while True:
        buf = rd.stdout.read(size)
        if len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(h_, w_, 3)
        mask = text_mask(frame, y0, y1, mode)
        both = mask if prev is None else (prev if mask is None else cv2.bitwise_or(mask, prev))
        prev = mask
        if both is not None and both.any():
            frame = fill(lama, frame, both)
            filled += 1
        wr.stdin.write(frame.tobytes())
        done += 1
        if n and done / n >= next_report:
            el = time.time() - t0
            rest = el / done * max(0, n - done)
            log(f"[{done}/{n}] {done / n:.0%} · {filled} quadros com legenda · ~{rest / 60:.1f} min restantes")
            next_report += 0.05
    rd.stdout.close()
    rd.wait()
    wr.stdin.close()
    wr.wait()
    if wr.returncode != 0:
        raise RuntimeError("falha ao gravar o vídeo")
    if has_audio(src):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-i", src, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
                        "-movflags", "+faststart", job["out"]], check=True)
    else:
        shutil.move(tmp, job["out"])
    log(f"{done} quadros, {filled} com legenda removida, em {(time.time() - t0) / 60:.1f} min")
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
