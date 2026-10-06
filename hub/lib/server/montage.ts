import "server-only";

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { MEDIA_DIR } from "@/lib/server/media";
import { createGeneration, DATA_DIR, getGeneration, updateGeneration } from "@/lib/server/store";

// Montagem automática do infoproduto (hub/playbooks/infoproduto-edicao-video.md), rodando nesta máquina:
// Python + faster-whisper + ffmpeg (scripts/montagem.py). Não gasta créditos de nenhuma ferramenta.

const SCRIPT = path.join(process.cwd(), "scripts", "montagem.py");
const FONTS = path.join(process.cwd(), "scripts", "fonts");
const LOG_DIR = path.join(DATA_DIR, "montagem");
export const LANGS = ["es", "pt", "fr", "en"] as const;

export const logPath = (id: string) => path.join(LOG_DIR, `${id}.log`);

// Montagens rodando neste processo do servidor (sobrevive ao hot reload do dev).
const running: Set<string> = ((globalThis as { __montagens?: Set<string> }).__montagens ??= new Set());

// avatarIds: vários vídeos do avatar, juntados na ordem antes dos cortes (gancho + body, várias tomadas).
// avatarId continua valendo (um só), para o chat e chamadas antigas.
export type MontageRequest = { avatarId?: string; avatarIds?: string[]; brollIds?: string[]; lang?: string; name?: string };

const MAX_AVATARS = 20;
const MAX_BROLLS = 40;

async function videoFile(id: string, label: string) {
  const g = await getGeneration(id);
  if (!g || g.kind !== "video" || g.status !== "done" || !g.file) throw new InputError(`${label} precisa ser um vídeo pronto do hub.`);
  return { g, file: path.join(MEDIA_DIR, g.file) };
}

export async function runMontage(req: MontageRequest): Promise<Generation> {
  const avatarIds = [...new Set((req.avatarIds?.length ? req.avatarIds : [req.avatarId ?? ""]).map(String).filter(Boolean))].slice(0, MAX_AVATARS);
  if (!avatarIds.length) throw new InputError("Escolha pelo menos um vídeo do avatar.");
  const avatars = await Promise.all(avatarIds.map((id, i) => videoFile(id, avatarIds.length > 1 ? `O avatar ${i + 1}` : "O avatar")));
  const avatar = avatars[0];
  const brollIds = (req.brollIds ?? []).map(String).filter(Boolean).slice(0, MAX_BROLLS);
  const brolls = await Promise.all(brollIds.map((id, i) => videoFile(id, `O b-roll ${i + 1}`)));
  const lang = LANGS.includes(req.lang as (typeof LANGS)[number]) ? (req.lang as string) : "es";
  const name = (String(req.name ?? "").trim() || "AD").replace(/[^\w-]+/g, "_").slice(0, 40);

  const gen = await createGeneration({
    tool: "montagem",
    kind: "video",
    status: "running",
    prompt: `Montagem ${name}: ${avatar.g.prompt}${avatars.length > 1 ? ` (+${avatars.length - 1})` : ""}`,
    params: { name, lang, avatarId: avatar.g.id, avatarIds: avatarIds.join(","), avatars: avatars.length, brolls: brolls.length, brollIds: brollIds.join(",") },
  });

  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  await writeFile(
    jobFile,
    JSON.stringify({
      name,
      avatar: avatar.file,
      avatars: avatars.map((a) => a.file),
      brolls: brolls.map((b) => b.file),
      lang,
      out: path.join(MEDIA_DIR, outName),
      workdir: path.join(DATA_DIR, "tmp", gen.id),
      fontsdir: FONTS,
    }),
  );

  // Roda em segundo plano; o log fica em .data/montagem/<id>.log e o status é atualizado ao terminar.
  const log: string[] = [];
  const python = process.env.PYTHON_BIN || "python";
  const child = spawn(python, ["-W", "ignore", SCRIPT, jobFile], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  child.stdin.end();
  running.add(gen.id);
  const collect = (chunk: Buffer) => {
    log.push(chunk.toString("utf8"));
    writeFile(logPath(gen.id), log.join("")).catch(() => {});
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (err) => {
    running.delete(gen.id);
    updateGeneration(gen.id, { status: "failed", error: `Não consegui rodar o Python (${err.message}). Defina PYTHON_BIN no .env.local.` });
  });
  child.on("close", async (code) => {
    running.delete(gen.id);
    const text = log.join("");
    if (code === 0 && text.includes("DONE")) {
      await updateGeneration(gen.id, { status: "done", file: outName });
    } else {
      const err = text.match(/ERROR (.+)/)?.[1] ?? text.trim().split("\n").slice(-2).join(" ");
      await updateGeneration(gen.id, { status: "failed", error: `Montagem: ${err.slice(0, 300) || `saiu com código ${code}`}` });
    }
  });

  return gen;
}

export async function readLog(id: string): Promise<string> {
  return readFile(logPath(id), "utf8").catch(() => "");
}

// Status atual; se o servidor reiniciou no meio, a montagem morreu junto e é marcada como interrompida.
export async function montageStatus(gen: Generation): Promise<Generation> {
  if (gen.status === "running" && !running.has(gen.id)) {
    return (await updateGeneration(gen.id, { status: "failed", error: "Montagem interrompida (o servidor reiniciou). Rode de novo." })) ?? gen;
  }
  return gen;
}
