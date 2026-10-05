import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hasKey, requireKey } from "@/lib/server/env";
import { InputError, ProviderError } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";
import { getGeneration } from "@/lib/server/store";

// Transcrição de vídeo/áudio do hub + identificação do idioma (agente "Transcrição").
// Motor principal: ElevenLabs Scribe (mais preciso, devolve idioma e confiança). Reserva: Whisper local (grátis).

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const SCRIPT = path.join(process.cwd(), "scripts", "transcrever.py");

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = {
  engine: "elevenlabs" | "local";
  languageCode: string; // ISO 639-1 quando possível (es, pt, en…)
  languageName: string; // em português
  confidence: number | null; // 0..1
  duration: number | null; // segundos
  text: string;
  segments: TranscriptSegment[];
};

function run(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // PYTHONUTF8: no Windows o Python escreveria o JSON em cp1252 e os acentos chegariam quebrados.
    const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
    const child = execFile(bin, args, { timeout, maxBuffer: 50 * 1024 * 1024, windowsHide: true, encoding: "utf8", env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stdout || stderr || err.message).trim().split("\n").slice(-3).join(" ")));
      else resolve(stdout);
    });
    child.stdin?.end();
  });
}

// ISO 639-3 (Scribe) → 639-1, para nomear o idioma.
const ISO3: Record<string, string> = {
  spa: "es", por: "pt", eng: "en", fra: "fr", ita: "it", deu: "de", ron: "ro", rus: "ru", jpn: "ja", kor: "ko",
  cmn: "zh", zho: "zh", ara: "ar", hin: "hi", tur: "tr", pol: "pl", nld: "nl", swe: "sv", fin: "fi", ind: "id",
  fil: "fil", tgl: "tl", ukr: "uk", ces: "cs", ell: "el", heb: "he", hun: "hu", vie: "vi", tha: "th", cat: "ca",
};

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Junta palavras do Scribe em frases: quebra em pontuação final, pausa longa ou ~16 palavras.
function wordsToSegments(words: { text: string; start: number; end: number }[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ").replace(/\s+([,.!?;:…])/g, "$1") });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && w.start - prev.end > 0.8) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text) || cur.length >= 16) flush();
  });
  flush();
  return out;
}

async function scribe(file: string): Promise<Transcript> {
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("tag_audio_events", "false");
  form.set("timestamps_granularity", "word");
  form.set("file", new Blob([new Uint8Array(await readFile(file))], { type: "audio/mpeg" }), path.basename(file));
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": requireKey("elevenlabs") },
    body: form,
  });
  if (!res.ok) throw new ProviderError("ElevenLabs", res.status, await res.text());
  const data = (await res.json()) as {
    language_code?: string;
    language_probability?: number;
    text?: string;
    words?: { text: string; start: number; end: number; type: string }[];
  };
  const words = (data.words ?? []).filter((w) => w.type === "word").map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
  const raw = (data.language_code ?? "").toLowerCase();
  const code = ISO3[raw] ?? raw;
  return {
    engine: "elevenlabs",
    languageCode: code,
    languageName: languageName(code),
    confidence: typeof data.language_probability === "number" ? data.language_probability : null,
    duration: words.length ? words[words.length - 1].end : null,
    text: (data.text ?? words.map((w) => w.text).join(" ")).trim(),
    segments: wordsToSegments(words),
  };
}

async function whisper(file: string): Promise<Transcript> {
  const out = await run(process.env.PYTHON_BIN || "python", ["-W", "ignore", SCRIPT, file], 900_000);
  const data = JSON.parse(out.trim().split("\n").pop() ?? "{}") as {
    error?: string;
    language?: string;
    probability?: number;
    duration?: number;
    segments?: TranscriptSegment[];
  };
  if (data.error) throw new Error(`Whisper: ${data.error}`);
  const segments = data.segments ?? [];
  const code = data.language ?? "";
  return {
    engine: "local",
    languageCode: code,
    languageName: languageName(code),
    confidence: data.probability ?? null,
    duration: data.duration ?? null,
    text: segments.map((s) => s.text).join(" "),
    segments,
  };
}

export type Engine = "auto" | "elevenlabs" | "local";

export async function transcribeGeneration(generationId: string, engine: Engine = "auto"): Promise<Transcript> {
  const g = await getGeneration(generationId);
  if (!g || (g.kind !== "video" && g.kind !== "audio")) throw new InputError("Escolha um vídeo ou áudio do hub (o anexo do chat também vale).");
  if (g.status !== "done" || !g.file) throw new InputError("Esse vídeo ainda não está pronto.");

  const tmp = await mkdtemp(path.join(os.tmpdir(), "hub-transcricao-"));
  try {
    // Só o áudio, mono 16 kHz: upload pequeno e o mesmo formato que o editor usa.
    const audio = path.join(tmp, "audio.mp3");
    await run(FFMPEG, ["-y", "-loglevel", "error", "-i", path.join(MEDIA_DIR, g.file), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audio], 600_000).catch(() => {
      throw new InputError("Não encontrei áudio nesse arquivo para transcrever.");
    });

    const useScribe = engine === "elevenlabs" || (engine === "auto" && hasKey("elevenlabs"));
    if (!useScribe) return await whisper(audio);
    try {
      return await scribe(audio);
    } catch (err) {
      if (engine === "elevenlabs") throw err;
      return await whisper(audio); // ElevenLabs falhou (créditos, rede…): cai para o Whisper local
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// Texto com marcação de tempo por frase, para o agente entregar.
export const timeline = (t: Transcript) => t.segments.map((s) => `[${mmss(s.start)}] ${s.text}`).join("\n");
