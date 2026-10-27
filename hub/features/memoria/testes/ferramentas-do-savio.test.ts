import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// As ferramentas seguem o contexto do Sávio (decisão de 20/10/2026): HeyGen sempre em speed e com os parâmetros de
// lipsync dele, FLORA no COD sem a regra antiga de crianças, voz padrão Multilingual v2, transcrição local primeiro e a
// edição final recebendo roteiro, formato, resolução, CTA e aviso. Nada sai para os serviços: tudo simulado.

const DADOS = mkdtempSync(path.join(os.tmpdir(), "hub-savio-"));
const urlOriginal = process.env.DATABASE_URL;

vi.mock("@/lib/server/pastas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/pastas")>();
  return { ...real, DATA_DIR: DADOS };
});
vi.mock("@/lib/server/heygen-mcp", () => ({
  callTool: vi.fn(async (nome: string) =>
    nome === "list_video_translation_languages" ? { languages: ["Spanish (Mexico)", "French (France)"] } : { video_translation_ids: ["t1"] },
  ),
  uploadAsset: vi.fn(async () => "asset1"),
}));
vi.mock("@/features/drive/servicos/videos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/drive/servicos/videos")>();
  return {
    ...real,
    exigirDriveParaVideo: vi.fn(async () => undefined),
    arquivoLocal: vi.fn(async (file: string) => path.join(DADOS, "media", file)),
    apagarDaMidia: vi.fn(async () => undefined),
    concluirComArquivo: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/server/video", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/video")>();
  return { ...real, palavrasDaFala: vi.fn(async () => [{ text: "hola", start: 0.1, end: 0.4 }]) };
});
vi.mock("@/lib/server/providers/elevenlabs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/providers/elevenlabs")>();
  return { ...real, elevenlabsConnected: vi.fn(async () => true), transcribeFull: vi.fn(async () => ({ language: "spa", languageProbability: 0.9, text: "hola", words: [] })) };
});
// Nenhum processo de verdade: o ffmpeg "funciona", o Whisper devolve uma transcrição e o Python da edição não roda.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const execFile = vi.fn((bin: string, args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const script = args.find((a) => a.endsWith("transcrever.py"));
    const saida = script ? JSON.stringify({ language: "es", probability: 0.9, duration: 1, segments: [{ start: 0, end: 1, text: "hola" }], words: [{ text: "hola", start: 0.1, end: 0.4 }] }) : "";
    cb(null, saida, "");
    return { stdin: { end() {} } };
  });
  const spawn = vi.fn(() => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { end() {} } }));
  return { ...real, execFile, spawn };
});

const { callTool } = await import("@/lib/server/heygen-mcp");
const { usarRaizDosDados } = await import("@/lib/server/pastas");
const { createGeneration } = await import("@/lib/server/store");
const { runTranslation } = await import("@/lib/server/video-translation");
const { applyRules } = await import("@/lib/flora-models");
const { DEFAULT_ELEVEN_MODEL } = await import("@/lib/elevenlabs-models");
const { transcribeGeneration } = await import("@/lib/server/transcription");
const { transcribeFull } = await import("@/lib/server/providers/elevenlabs");
const { runMontage } = await import("@/lib/server/montage");

const video = (extra: Record<string, unknown> = {}) =>
  createGeneration({ tool: "upload", kind: "video", status: "done", prompt: "vídeo", file: "v.mp4", params: {}, ...extra } as never);

describe("ferramentas no padrão do Sávio", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL; // PC sem banco: organização padrão, gerações em arquivo (pasta temporária)
    usarRaizDosDados(DADOS);
    vi.mocked(callTool).mockClear();
  });
  afterAll(() => {
    usarRaizDosDados(undefined);
    if (urlOriginal !== undefined) process.env.DATABASE_URL = urlOriginal;
  });

  it("HeyGen: nunca precision; com áudio próprio, os parâmetros de lipsync do Sávio", async () => {
    const v = await video();
    const audio = await createGeneration({ tool: "elevenlabs", kind: "audio", status: "done", prompt: "texto", file: "a.mp3", params: {} } as never);
    await runTranslation({ videoGenerationId: v.id, outputLanguages: ["Spanish (Mexico)"], mode: "precision" });
    const traducao = vi.mocked(callTool).mock.calls.find((c) => c[0] === "create_video_translation")![1] as Record<string, unknown>;
    expect(traducao.mode).toBe("speed");
    expect(traducao.enableDynamicDuration).toBe(true);

    vi.mocked(callTool).mockClear();
    await runTranslation({ videoGenerationId: v.id, outputLanguages: ["Spanish (Mexico)"], audioGenerationId: audio.id, mode: "precision" });
    const lipsync = vi.mocked(callTool).mock.calls.find((c) => c[0] === "create_video_translation")![1] as Record<string, unknown>;
    expect(lipsync).toMatchObject({ mode: "speed", enableDynamicDuration: false, keepTheSameFormat: true, fpsMode: "cfr" });
  });

  it("FLORA no COD: idioma travado, sem texto nem música; a regra antiga de crianças saiu", () => {
    const p = applyRules("Mulher na cozinha", "video", "cod", "cl");
    expect(p).toContain("All speech in Chilean Spanish only");
    expect(p).toContain("No on-screen text, no subtitles, no background music.");
    expect(p).not.toMatch(/children|Continuous energetic/);
    expect(applyRules("Produto na mesa", "image", "cod")).not.toMatch(/children/);
  });

  it("voz padrão: eleven_multilingual_v2", () => {
    expect(DEFAULT_ELEVEN_MODEL).toBe("eleven_multilingual_v2");
  });

  it("transcrição: Whisper local primeiro, com as palavras; o Scribe (pago) não é chamado", async () => {
    const v = await video();
    const t = await transcribeGeneration(v.id);
    expect(t.engine).toBe("local");
    expect(t.words?.[0]).toMatchObject({ text: "hola" });
    expect(transcribeFull).not.toHaveBeenCalled();
  });

  it("edição final: roteiro da narração do avatar, CTA com setas, formato, resolução e aviso chegam ao script", async () => {
    const avatar = await createGeneration({
      tool: "heygen",
      kind: "video",
      status: "done",
      prompt: "[excited] Paga dos y llévate tres. Pide el tuyo.",
      file: "av.mp4",
      params: { mode: "audio" },
    } as never);
    const g = await runMontage({
      avatarIds: [avatar.id],
      name: "AD 07 - YARA-9x16-ES-V1",
      formato: "4:5",
      resolucao: "720",
      aviso: "Solo con fines demostrativos. Algunas escenas están aceleradas.",
      graphics: [{ tipo: "cta", texto: "", deixa: "pide" }, { tipo: "titulo", texto: "OFERTA" }],
      fx: { musica_volume: 0.9, legenda: "destaque" },
    });
    expect(g.name).toBe("AD 07 - YARA-9x16-ES-V1");
    // O trabalho do Python é escrito em segundo plano.
    const jobFile = path.join(DADOS, "montagem", `${g.id}.json`);
    let job: Record<string, unknown> | null = null;
    for (let i = 0; i < 50 && !job; i++) {
      try {
        job = JSON.parse(readFileSync(jobFile, "utf8"));
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    expect(job).toMatchObject({
      roteiro: "Paga dos y llévate tres. Pide el tuyo.",
      formato: "4:5",
      resolucao: "720",
      limite_mb: 30,
      cta: { palavra: "pide" },
      aviso: "Solo con fines demostrativos. Algunas escenas están aceleradas.",
      // A camada visual (legenda, aviso, setas) sai sempre pelo Remotion depois do Python; o título fica de fora no 4:5.
      graficos_depois: true,
      camada_out: path.join(DADOS, "montagem", `${g.id}.camada.json`),
      avatar_words: [[["hola", 0.1, 0.4]]],
    });
    // Volume livre da música e cor de destaque antigos não passam para o script.
    expect(job!.fx).toEqual({});
  });
});
