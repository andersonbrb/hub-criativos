import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { access, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as baixarCard } from "@/app/api/board/cards/[id]/download/route";
import { GET as estadoDaMigracao, POST as migrar } from "@/app/api/drive/migrar/route";
import { DELETE as apagarUma, PATCH as mudarUma } from "@/app/api/generations/[id]/route";
import { DELETE as limpar } from "@/app/api/generations/route";
import { GET as midia } from "@/app/api/media/[file]/route";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Chave } from "@/features/acesso/contrato";
import { criarConta } from "@/features/acesso/testes/ajuda";
import { criarLinkDeDownload, entregarDownload, receberEnvio } from "@/features/conector/servicos/links";
import { chamar, conectar, criarPessoa, prepararTeste } from "@/features/conector/testes/apoio";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import type { ArquivoDrive } from "@/features/drive/contrato";
import {
  abrirTrecho,
  ArquivoForaDoDrive,
  baixarParaTemp,
  enviarArquivo,
  listarArquivosDoHub,
  moverParaLixeira,
  renomear,
} from "@/features/drive/servicos/arquivos";
import { DriveNaoConectado, driveConectado, tokenDeAcesso } from "@/features/drive/servicos/conta";
import { faxinaDosVideos, MOTIVO_DO_DESCARTE, MOTIVO_SEM_ARQUIVO, zerarFaxinaDosVideos } from "@/features/drive/servicos/faxina";
import {
  arquivoLocal,
  concluirComArquivo,
  estadoDaMigracao as migracaoAgora,
  exigirDriveParaVideo,
  guardarNoDrive,
  md5DoArquivo,
  pastaDaGeracao,
  sincronizarComDrive,
  zerarVideosNoDrive,
} from "@/features/drive/servicos/videos";
import { downloadName, type Generation } from "@/lib/generations";
import { createCard } from "@/lib/server/board";
import { trechoDoArquivo } from "@/lib/server/media";
import { pastaDeMidiaDa, usarRaizDosDados } from "@/lib/server/pastas";
import * as store from "@/lib/server/store";

// Os arquivos das organizações vão para uma pasta temporária (a mídia da padrão fica em <temp>/media).
usarRaizDosDados(mkdtempSync(path.join(os.tmpdir(), "hub-drive-videos-")));
const MEDIA_DIR = pastaDeMidiaDa(ORGANIZACAO_PADRAO.id);

// Vídeos gerados moram só no Google Drive: sobem quando ficam prontos, o hub toca e baixa de lá, e o que a pessoa
// apaga ou renomeia no Drive aparece no hub (espelho). O Drive em si (arquivos.ts e conta.ts) é simulado aqui.

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
vi.mock("@/features/drive/servicos/arquivos", () => ({
  enviarArquivo: vi.fn(),
  abrirTrecho: vi.fn(),
  baixarParaTemp: vi.fn(),
  moverParaLixeira: vi.fn(),
  renomear: vi.fn(),
  listarArquivosDoHub: vi.fn(),
  ArquivoForaDoDrive: class ArquivoForaDoDrive extends Error {},
  copiaSegurada: vi.fn(() => false),
  limparTemp: vi.fn(async () => undefined),
  SEM_USO_MAXIMO_MS: 30 * 60 * 1000,
}));
vi.mock("@/features/drive/servicos/conta", () => ({
  DriveNaoConectado: class DriveNaoConectado extends Error {
    constructor() {
      super("O Google Drive não está conectado. Um admin precisa conectar em Integrações → Google Drive.");
    }
  },
  tokenDeAcesso: vi.fn(),
  driveConectado: vi.fn(async () => true),
}));
// As gerações ficam na memória do teste e a pasta de dados é temporária (a mídia vai para <temp>/media). Como o
// store de verdade (que relê o JSON do disco), cada leitura devolve uma cópia. `leituras.listas` conta as listagens
// (cada uma, no store de verdade, relê o db.json inteiro).
vi.mock("@/lib/server/store", async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const caminho = await import("node:path");
  const geracoes: Generation[] = [];
  const leituras = { listas: 0 };
  const copia = <T,>(g: T): T => structuredClone(g);
  const DATA_DIR = mkdtempSync(caminho.join(os.tmpdir(), "hub-drive-videos-"));
  return {
    DATA_DIR,
    arquivoDoBanco: async () => caminho.join(DATA_DIR, "db.json"),
    geracoes,
    leituras,
    listGenerations: async (tool?: string, opcoes: { incluirForaDoDrive?: boolean } = {}) => {
      leituras.listas++;
      return [...geracoes].reverse().filter((g) => (!tool || g.tool === tool) && (opcoes.incluirForaDoDrive || !g.foraDoDrive)).map(copia);
    },
    getGeneration: async (id: string) => copia(geracoes.find((g) => g.id === id)),
    createGeneration: async (dados: Omit<Generation, "id" | "createdAt">) => {
      const g = { ...dados, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as Generation;
      geracoes.push(g);
      return copia(g);
    },
    updateGeneration: async (id: string, patch: Partial<Generation>) => {
      const g = geracoes.find((x) => x.id === id);
      if (g) Object.assign(g, copia(patch));
      return copia(g);
    },
    deleteGeneration: async (id: string) => {
      const i = geracoes.findIndex((g) => g.id === id);
      if (i >= 0) geracoes.splice(i, 1);
      return i >= 0;
    },
    clearGenerations: async (tool: string, opcoes: { ids?: string[] } = {}) => {
      const sai = geracoes.filter((g) => g.tool === tool && !g.saved && (g.status === "done" || g.status === "failed") && (!opcoes.ids || opcoes.ids.includes(g.id)));
      for (const g of sai) geracoes.splice(geracoes.indexOf(g), 1);
      return sai.map(copia);
    },
  };
});

const geracoes = (store as unknown as { geracoes: Generation[] }).geracoes;
const leituras = (store as unknown as { leituras: { listas: number } }).leituras;
const BASE = "https://hub.teste";
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const existe = (file: string) => access(path.join(MEDIA_DIR, file)).then(() => true, () => false);
const daMemoria = (id: string) => geracoes.find((g) => g.id === id);

async function entrarCom(chaves: Chave[]) {
  const conta = await criarConta({ email: `${chaves.join("-") || "nada"}-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves, senha: null });
  sessao.logado = conta.id;
}

// Vídeo pronto (b-roll do FLORA, a menos que `dados` diga outra coisa), com o arquivo no disco se `local`.
async function novoVideo(dados: Partial<Generation> = {}, { local = true } = {}) {
  const file = `${crypto.randomUUID()}.mp4`;
  if (local) await writeFile(path.join(MEDIA_DIR, file), new Uint8Array(1000).map((_, i) => i % 256));
  return store.createGeneration({ tool: "flora", kind: "video", status: "done", prompt: "b-roll da xícara às 16h", params: {}, file, ...dados });
}

const arquivoNoDrive = (id: string, nome: string, extra: Partial<ArquivoDrive> = {}): ArquivoDrive => ({
  id,
  nome,
  mimeType: "video/mp4",
  tamanho: 1000,
  modificadoEm: "2026-10-15T12:00:00.000Z",
  noLixo: false,
  ...extra,
});

function adiado<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

describe("vídeos no Google Drive", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    zerarVideosNoDrive();
    geracoes.length = 0;
    sessao.logado = null;
    await rm(MEDIA_DIR, { recursive: true, force: true });
    await mkdir(MEDIA_DIR, { recursive: true });
    let n = 0;
    vi.mocked(enviarArquivo).mockImplementation(async (_caminho, opcoes) => arquivoNoDrive(`drv-${++n}`, opcoes.nome));
    vi.mocked(moverParaLixeira).mockResolvedValue(undefined);
  });
  afterAll(() => rm(path.dirname(MEDIA_DIR), { recursive: true, force: true }));

  describe("guardarNoDrive", () => {
    it("sobe para a pasta do tipo, grava o id do Drive e só então apaga a cópia local", async () => {
      const gen = await novoVideo({ name: "Xícara 16h" });
      const salva = await guardarNoDrive(gen);

      expect(enviarArquivo).toHaveBeenCalledTimes(1);
      expect(enviarArquivo).toHaveBeenCalledWith(path.join(MEDIA_DIR, gen.file!), { nome: "Xicara 16h.mp4", pasta: "broll", mimeType: "video/mp4" });
      expect(salva.drive).toEqual({ id: "drv-1", pasta: "broll" });
      expect(daMemoria(gen.id)).toMatchObject({ drive: { id: "drv-1", pasta: "broll" }, file: gen.file, status: "done", params: { tamanhoNoDrive: 1000 } });
      expect(await existe(gen.file!)).toBe(false);
    });

    it("cada origem vai para a sua pasta, inclusive o vídeo que a equipe envia; imagens e áudios ficam no disco", async () => {
      const pasta = (dados: Partial<Generation>) => pastaDaGeracao({ id: "x", tool: "flora", kind: "video", status: "done", prompt: "", params: {}, createdAt: "", ...dados } as Generation);
      expect(pasta({ tool: "montagem" })).toBe("edicao-final");
      expect(pasta({ tool: "montagem", params: { formato: "batida" } })).toBe("batida");
      expect(pasta({ tool: "montagem", params: { formato: "sem-legenda" } })).toBe("sem-legenda");
      expect(pasta({ tool: "editor" })).toBe("editor");
      expect(pasta({ tool: "heygen-traducao" })).toBe("traducao");
      expect(pasta({ tool: "flora" })).toBe("broll");
      expect(pasta({ tool: "heygen" })).toBe("avatar");
      expect(pasta({ tool: "higgsfield" })).toBe("outros");
      expect(pasta({ tool: "elevenlabs" })).toBe("outros");
      expect(pasta({ tool: "upload", params: { origem: "conector" } })).toBe("entregas");
      expect(pasta({ tool: "upload" })).toBe("enviados");
      expect(pasta({ tool: "flora", kind: "image" })).toBeNull();
      expect(pasta({ tool: "upload", kind: "image" })).toBeNull();
      expect(pasta({ tool: "heygen-traducao", kind: "audio" })).toBeNull();

      const anexo = await novoVideo({ tool: "upload", prompt: "video-do-celular.mp4" });
      const rodando = await novoVideo({ status: "running" });
      expect((await guardarNoDrive(anexo)).drive).toEqual({ id: "drv-1", pasta: "enviados" });
      await guardarNoDrive(rodando);
      expect(enviarArquivo).toHaveBeenCalledTimes(1);
      expect(await existe(anexo.file!)).toBe(false);
      expect(await existe(rodando.file!)).toBe(true);
    });

    it("impressão digital diferente no Drive: a cópia de lá vai para a lixeira e o vídeo fica no hub", async () => {
      vi.mocked(enviarArquivo).mockImplementationOnce(async (_caminho, opcoes) => arquivoNoDrive("drv-trocado", opcoes.nome, { md5: "0".repeat(32) }));
      const gen = await novoVideo({ tool: "editor" });
      const depois = await guardarNoDrive(gen);
      expect(depois.drive).toBeUndefined();
      expect(moverParaLixeira).toHaveBeenCalledWith("drv-trocado");
      expect(daMemoria(gen.id)).toMatchObject({ status: "done", params: { paraDrive: true } });
      expect(await existe(gen.file!)).toBe(true);
    });

    it("impressão digital igual: o vídeo fica no Drive e sai do hub", async () => {
      const gen = await novoVideo({ tool: "editor" });
      const md5 = await md5DoArquivo(path.join(MEDIA_DIR, gen.file!));
      vi.mocked(enviarArquivo).mockImplementationOnce(async (_caminho, opcoes) => arquivoNoDrive("drv-certo", opcoes.nome, { md5 }));
      expect((await guardarNoDrive(gen)).drive).toEqual({ id: "drv-certo", pasta: "editor" });
      expect(moverParaLixeira).not.toHaveBeenCalled();
      expect(await existe(gen.file!)).toBe(false);
    });

    it("concluirComArquivo: vídeo novo ganha o prazo de 12 horas e já sobe; o prazo sai quando chega ao Drive", async () => {
      const gen = await novoVideo({ status: "running" });
      const pronta = await concluirComArquivo(gen.id, { file: gen.file! });
      expect(pronta).toMatchObject({ status: "done", params: { prazoNoHub: expect.any(String) } });
      const prazo = Date.parse(String(pronta!.params.prazoNoHub)) - Date.now();
      expect(prazo).toBeGreaterThan(11.9 * 3600_000);
      expect(prazo).toBeLessThanOrEqual(12 * 3600_000);
      await vi.waitFor(() => expect(daMemoria(gen.id)!.drive).toEqual({ id: "drv-1", pasta: "broll" }));
      expect(daMemoria(gen.id)!.params.prazoNoHub).toBeUndefined();
      expect(await existe(gen.file!)).toBe(false);
    });

    it("concluirComArquivo: geração apagada durante o trabalho apaga o arquivo novo na hora", async () => {
      const gen = await novoVideo({ status: "running" });
      await store.deleteGeneration(gen.id);
      expect(await concluirComArquivo(gen.id, { file: gen.file! })).toBeUndefined();
      expect(await existe(gen.file!)).toBe(false);
      expect(enviarArquivo).not.toHaveBeenCalled();
    });

    it("sem Drive conectado, gerar ou enviar vídeo é recusado com a explicação", async () => {
      vi.mocked(driveConectado).mockResolvedValue(false);
      await expect(exigirDriveParaVideo()).rejects.toThrow("O Google Drive desta organização não está conectado.");
      vi.mocked(driveConectado).mockResolvedValue(true);
      await expect(exigirDriveParaVideo()).resolves.toBeUndefined();
    });

    it("sem Drive conectado (ou com falha no envio), o vídeo fica no disco marcado para depois", async () => {
      vi.mocked(enviarArquivo).mockRejectedValueOnce(new DriveNaoConectado());
      const gen = await novoVideo({ tool: "montagem", params: { formato: "batida" } });
      const depois = await guardarNoDrive(gen);
      expect(depois.drive).toBeUndefined();
      expect(daMemoria(gen.id)).toMatchObject({ status: "done", params: { formato: "batida", paraDrive: true } });
      expect(daMemoria(gen.id)!.drive).toBeUndefined();
      expect(await existe(gen.file!)).toBe(true);

      vi.mocked(enviarArquivo).mockRejectedValueOnce(new Error("O Google Drive está sem espaço."));
      const outro = await novoVideo({ tool: "editor" });
      await expect(guardarNoDrive(outro)).resolves.toMatchObject({ id: outro.id, params: { paraDrive: true } });
      expect(await existe(outro.file!)).toBe(true);

      // Na próxima vez que der certo, a marca sai.
      const levado = await guardarNoDrive(daMemoria(gen.id)!);
      expect(levado.drive).toEqual({ id: "drv-1", pasta: "batida" });
      expect(levado.params.paraDrive).toBeUndefined();
      expect(await existe(gen.file!)).toBe(false);
    });

    it("duas chamadas ao mesmo tempo (o refresh rodando duas vezes) sobem uma vez só", async () => {
      const envio = adiado<ArquivoDrive>();
      vi.mocked(enviarArquivo).mockImplementationOnce(() => envio.promessa);
      const gen = await novoVideo({ tool: "heygen" });

      const primeira = guardarNoDrive(gen);
      const segunda = guardarNoDrive(gen);
      // Enquanto sobe, o arquivo local continua servindo.
      expect(await existe(gen.file!)).toBe(true);
      envio.resolver(arquivoNoDrive("drv-avatar", downloadName(gen)));
      const [a, b] = await Promise.all([primeira, segunda]);

      expect(enviarArquivo).toHaveBeenCalledTimes(1);
      expect(a.drive).toEqual({ id: "drv-avatar", pasta: "avatar" });
      expect(b.drive).toEqual({ id: "drv-avatar", pasta: "avatar" });
      // Uma chamada atrasada, com a cópia antiga da geração (sem `drive`), também não sobe de novo.
      expect((await guardarNoDrive(gen)).drive).toEqual({ id: "drv-avatar", pasta: "avatar" });
      expect(enviarArquivo).toHaveBeenCalledTimes(1);
    });

    it("apagada no hub durante o envio: o arquivo que chegou ao Drive vai para a lixeira de lá", async () => {
      const envio = adiado<ArquivoDrive>();
      vi.mocked(enviarArquivo).mockImplementationOnce(() => envio.promessa);
      const gen = await novoVideo();
      const levando = guardarNoDrive(gen);
      await store.deleteGeneration(gen.id);
      envio.resolver(arquivoNoDrive("drv-orfao", downloadName(gen)));
      await levando;
      expect(moverParaLixeira).toHaveBeenCalledWith("drv-orfao");
    });

    it("tamanho diferente no Drive: a cópia de lá vai para a lixeira e o vídeo fica no hub para ir de novo", async () => {
      vi.mocked(enviarArquivo).mockImplementationOnce(async (_caminho, opcoes) => arquivoNoDrive("drv-cortado", opcoes.nome, { tamanho: 640 }));
      const gen = await novoVideo({ tool: "editor" });
      const depois = await guardarNoDrive(gen);

      expect(depois.drive).toBeUndefined();
      expect(moverParaLixeira).toHaveBeenCalledWith("drv-cortado");
      expect(daMemoria(gen.id)).toMatchObject({ status: "done", params: { paraDrive: true } });
      expect(daMemoria(gen.id)!.drive).toBeUndefined();
      expect(await existe(gen.file!)).toBe(true);
    });

    it("params que mudaram durante o envio não se perdem", async () => {
      const envio = adiado<ArquivoDrive>();
      vi.mocked(enviarArquivo).mockImplementationOnce(() => envio.promessa);
      const gen = await novoVideo({ tool: "montagem", params: { formato: "sem-legenda" } });
      const levando = guardarNoDrive(gen);
      await vi.waitFor(() => expect(enviarArquivo).toHaveBeenCalled());
      await store.updateGeneration(gen.id, { params: { formato: "sem-legenda", duracao: 42 } });
      envio.resolver(arquivoNoDrive("drv-1", downloadName(gen)));
      await levando;
      expect(daMemoria(gen.id)!.params).toEqual({ formato: "sem-legenda", duracao: 42, tamanhoNoDrive: 1000 });
      expect(daMemoria(gen.id)!.drive).toEqual({ id: "drv-1", pasta: "sem-legenda" });
    });
  });

  describe("arquivoLocal", () => {
    it("usa a cópia do disco quando existe e baixa do Drive quando não", async () => {
      const local = await novoVideo();
      expect(await arquivoLocal(local.file!)).toBe(path.join(MEDIA_DIR, local.file!));

      const noDrive = await novoVideo({ drive: { id: "drv-9", pasta: "broll" } }, { local: false });
      vi.mocked(baixarParaTemp).mockResolvedValue("/tmp/drive/drv-9.mp4");
      expect(await arquivoLocal(noDrive.file!)).toBe("/tmp/drive/drv-9.mp4");
      expect(baixarParaTemp).toHaveBeenCalledTimes(1);
      expect(baixarParaTemp).toHaveBeenCalledWith("drv-9", "mp4");
    });

    it("vídeo apagado no Drive vira um erro legível", async () => {
      const apagado = await novoVideo({ drive: { id: "drv-x", pasta: "broll" }, foraDoDrive: true }, { local: false });
      await expect(arquivoLocal(apagado.file!)).rejects.toThrow("Esse vídeo foi apagado no Drive.");
      expect(baixarParaTemp).not.toHaveBeenCalled();
    });

    it("cópia pedida durante o envio (ffmpeg, Python) não é apagada quando o envio termina", async () => {
      const envio = adiado<ArquivoDrive>();
      vi.mocked(enviarArquivo).mockImplementationOnce(() => envio.promessa);
      const gen = await novoVideo();
      const levando = guardarNoDrive(gen);
      const caminho = await arquivoLocal(gen.file!);
      envio.resolver(arquivoNoDrive("drv-1", downloadName(gen)));
      expect((await levando).drive).toEqual({ id: "drv-1", pasta: "broll" });
      expect(caminho).toBe(path.join(MEDIA_DIR, gen.file!));
      expect(await existe(gen.file!)).toBe(true);
    });
  });

  describe("/api/media", () => {
    const pedirMidia = (file: string, headers: Record<string, string> = {}) => midia(new Request(`${BASE}/api/media/${file}`, { headers }), ctx({ file }));

    beforeEach(() => bancoDeTeste());

    it("vídeo no Drive: repassa o Range e mantém as travas do hub", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } }, { local: false });
      vi.mocked(abrirTrecho).mockResolvedValue({
        status: 206,
        cabecalhos: { "Content-Type": "application/octet-stream", "Content-Length": "100", "Content-Range": "bytes 0-99/1000", "Accept-Ranges": "bytes" },
        corpo: new Response(new Uint8Array(100).fill(7)).body,
      });

      const res = await pedirMidia(gen.file!, { range: "bytes=0-99" });
      expect(abrirTrecho).toHaveBeenCalledWith("drv-7", "bytes=0-99", expect.any(AbortSignal));
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-99/1000");
      expect(res.headers.get("content-length")).toBe("100");
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(100).fill(7));
    });

    it("sem tela de produção: 403, e o Drive nem é consultado", async () => {
      await entrarCom(["memoria"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } }, { local: false });
      expect((await pedirMidia(gen.file!)).status).toBe(403);
      expect(abrirTrecho).not.toHaveBeenCalled();
    });

    it("vídeo apagado no Drive: 404 com o aviso", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" }, foraDoDrive: true }, { local: false });
      const res = await pedirMidia(gen.file!);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Esse vídeo foi apagado no Drive.");
      expect(abrirTrecho).not.toHaveBeenCalled();
    });

    it("vídeo que ainda não foi para o Drive sai do disco, como antes", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo();
      const res = await pedirMidia(gen.file!, { range: "bytes=10-19" });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
      expect(abrirTrecho).not.toHaveBeenCalled();
    });

    it("vídeo já no Drive com a cópia local ainda no disco: serve a local, sem ir ao Drive", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } });
      const res = await pedirMidia(gen.file!, { range: "bytes=0-9" });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-9/1000");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(10).map((_, i) => i));
      expect(abrirTrecho).not.toHaveBeenCalled();
    });

    it("o player que desiste antes de o Drive responder cancela o pedido ao Drive", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } }, { local: false });
      const player = new AbortController();
      let cancelado: boolean | undefined;
      vi.mocked(abrirTrecho).mockImplementation(async (_id, _faixa, sinal) => {
        player.abort(); // o player pulou enquanto o Drive respondia
        cancelado = sinal?.aborted;
        return { status: 200, cabecalhos: {}, corpo: null };
      });
      await midia(new Request(`${BASE}/api/media/${gen.file}`, { signal: player.signal }), ctx({ file: gen.file! }));
      expect(cancelado).toBe(true);
    });

    it("depois que o Drive respondeu, o pedido do navegador não mexe mais na conexão (quem para é a leitura)", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } }, { local: false });
      const player = new AbortController();
      vi.mocked(abrirTrecho).mockResolvedValue({ status: 200, cabecalhos: {}, corpo: null });
      await midia(new Request(`${BASE}/api/media/${gen.file}`, { signal: player.signal }), ctx({ file: gen.file! }));
      player.abort();
      expect(vi.mocked(abrirTrecho).mock.calls[0][2]?.aborted).toBe(false);
    });

    it("vídeo do disco: o player que fecha no meio só solta o arquivo, e o trecho chega exato", async () => {
      const arquivo = path.join(MEDIA_DIR, "trecho-grande.bin");
      const conteudo = Buffer.alloc(1024 * 1024, 0).map((_, i) => i % 251);
      await mkdir(MEDIA_DIR, { recursive: true });
      await writeFile(arquivo, conteudo);

      const meio = trechoDoArquivo(arquivo, 0, conteudo.length - 1).getReader();
      expect((await meio.read()).value!.length).toBeGreaterThan(0);
      await meio.cancel(); // sem erro, e nada mais é lido depois
      expect(await meio.read()).toEqual({ done: true, value: undefined });

      const inteiro = new Uint8Array(await new Response(trechoDoArquivo(arquivo, 1000, 700_000)).arrayBuffer());
      expect(Buffer.from(inteiro).equals(conteudo.subarray(1000, 700_001))).toBe(true);
    });

    it("404 do Drive não marca na hora: o espelho confere a lista e só então marca", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo({ drive: { id: "drv-7", pasta: "broll" } }, { local: false });
      vi.mocked(abrirTrecho).mockRejectedValue(new ArquivoForaDoDrive());

      // A lista do Drive ainda tem o vídeo (o 404 foi passageiro): nada muda.
      vi.mocked(listarArquivosDoHub).mockResolvedValueOnce([arquivoNoDrive("drv-7", downloadName(gen))]);
      expect((await pedirMidia(gen.file!)).status).toBe(404);
      await vi.waitFor(() => expect(listarArquivosDoHub).toHaveBeenCalledTimes(1));
      await sincronizarComDrive(); // espera o espelho que está rodando
      expect(daMemoria(gen.id)!.foraDoDrive).toBeUndefined();

      // A lista confirma que ele sumiu: aí sim é marcado.
      zerarVideosNoDrive();
      vi.mocked(listarArquivosDoHub).mockResolvedValueOnce([]);
      const res = await pedirMidia(gen.file!);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Esse vídeo foi apagado no Drive.");
      await vi.waitFor(() => expect(daMemoria(gen.id)!.foraDoDrive).toBe(true));
    });

    it("o índice dos arquivos não relê o db.json enquanto ele não muda", async () => {
      await entrarCom(["biblioteca"]);
      const gen = await novoVideo();
      const banco = path.join(store.DATA_DIR, "db.json");
      await writeFile(banco, "{}");
      try {
        const antes = leituras.listas;
        for (const range of ["bytes=0-9", "bytes=10-19", "bytes=20-29"]) {
          const res = await pedirMidia(gen.file!, { range });
          expect(res.status).toBe(206);
          await res.arrayBuffer();
        }
        expect(leituras.listas - antes).toBe(1);

        // O db.json mudou (outra data de modificação): relê uma vez.
        const depois = new Date(Date.now() + 60_000);
        await utimes(banco, depois, depois);
        await (await pedirMidia(gen.file!, { range: "bytes=0-9" })).arrayBuffer();
        await (await pedirMidia(gen.file!, { range: "bytes=0-9" })).arrayBuffer();
        expect(leituras.listas - antes).toBe(2);
      } finally {
        await rm(banco, { force: true });
      }
    });
  });

  describe("espelho do Drive", () => {
    it("marca apagados e os da lixeira, acompanha o nome e traz de volta o que saiu da lixeira", async () => {
      const apagado = await novoVideo({ drive: { id: "a", pasta: "broll" } }, { local: false });
      const naLixeira = await novoVideo({ drive: { id: "b", pasta: "broll" } }, { local: false });
      const renomeado = await novoVideo({ drive: { id: "c", pasta: "edicao-final" }, tool: "montagem", name: "Edição AD 3" }, { local: false });
      const devolvido = await novoVideo({ drive: { id: "d", pasta: "broll" }, foraDoDrive: true }, { local: false });
      const igual = await novoVideo({ drive: { id: "e", pasta: "broll" }, name: "Café" }, { local: false });
      // Vídeo ainda no disco (sem `drive`): o espelho não o marca; ele vai para o Drive pela fila.
      const local = await novoVideo({ tool: "upload" });
      vi.mocked(listarArquivosDoHub).mockResolvedValue([
        arquivoNoDrive("b", downloadName(naLixeira), { noLixo: true }),
        arquivoNoDrive("c", "Edição AD 3 versão final.mp4"),
        arquivoNoDrive("d", downloadName(devolvido)),
        arquivoNoDrive("e", downloadName(igual)),
        arquivoNoDrive("de-outro-lugar", "Solto.mp4"),
      ]);

      await sincronizarComDrive();

      // Uma lista só, no lugar de uma consulta por vídeo.
      expect(listarArquivosDoHub).toHaveBeenCalledTimes(1);
      expect(daMemoria(apagado.id)!.foraDoDrive).toBe(true);
      expect(daMemoria(naLixeira.id)!.foraDoDrive).toBe(true);
      expect(daMemoria(renomeado.id)).toMatchObject({ name: "Edição AD 3 versão final" });
      expect(daMemoria(renomeado.id)!.foraDoDrive).toBeUndefined();
      expect(daMemoria(devolvido.id)!.foraDoDrive).toBe(false);
      expect(daMemoria(igual.id)).toMatchObject({ name: "Café" });
      expect(daMemoria(igual.id)!.foraDoDrive).toBeUndefined();
      expect(daMemoria(local.id)!.foraDoDrive).toBeUndefined();
      // As listas deixam de mostrar o que saiu do Drive.
      expect((await store.listGenerations()).map((g) => g.id).sort()).toEqual([renomeado.id, devolvido.id, igual.id, local.id].sort());

      // Intervalo mínimo: a próxima lista, logo em seguida, não consulta o Drive de novo.
      await sincronizarComDrive();
      expect(listarArquivosDoHub).toHaveBeenCalledTimes(1);
    });

    it("erro de login ou de conexão não muda nada", async () => {
      const gen = await novoVideo({ drive: { id: "a", pasta: "broll" }, name: "Original" }, { local: false });
      vi.mocked(listarArquivosDoHub).mockRejectedValue(new DriveNaoConectado());
      await sincronizarComDrive();
      expect(daMemoria(gen.id)).toEqual(gen);

      zerarVideosNoDrive();
      vi.mocked(listarArquivosDoHub).mockRejectedValue(new Error("O Google não aceitou o login do Drive."));
      await sincronizarComDrive();
      expect(daMemoria(gen.id)).toEqual(gen);
    });

    it("muitos vídeos sumindo de uma vez (outra conta conectada?) não marca nada", async () => {
      const gens: Generation[] = [];
      for (let i = 0; i < 6; i++) gens.push(await novoVideo({ drive: { id: `v${i}`, pasta: "broll" }, name: `Vídeo ${i}` }, { local: false }));
      // Até o nome mudado de um que ainda está lá espera: a lista inteira está sob suspeita.
      vi.mocked(listarArquivosDoHub).mockResolvedValue([arquivoNoDrive("v0", "Outro nome.mp4")]);

      await sincronizarComDrive();

      for (const g of gens) expect(daMemoria(g.id)).toEqual(g);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("conta trocada?"));
    });

    it("poucos vídeos sumindo (menos de 5) são o que alguém apagou: são marcados", async () => {
      const gens: Generation[] = [];
      for (let i = 0; i < 4; i++) gens.push(await novoVideo({ drive: { id: `v${i}`, pasta: "broll" } }, { local: false }));
      vi.mocked(listarArquivosDoHub).mockResolvedValue([]);
      await sincronizarComDrive();
      for (const g of gens) expect(daMemoria(g.id)!.foraDoDrive).toBe(true);
    });

    it("a fila vai sozinha para o Drive: o espelho começa a migração em segundo plano", async () => {
      const noDrive = await novoVideo({ drive: { id: "a", pasta: "broll" } }, { local: false });
      const naFila = await novoVideo({ tool: "montagem", params: { paraDrive: true } });
      vi.mocked(listarArquivosDoHub).mockResolvedValue([arquivoNoDrive("a", downloadName(noDrive))]);

      await sincronizarComDrive();
      await vi.waitFor(async () => expect((await migracaoAgora()).rodando).toBe(false));

      expect(enviarArquivo).toHaveBeenCalledTimes(1);
      expect(daMemoria(naFila.id)!.drive).toEqual({ id: "drv-1", pasta: "edicao-final" });
      expect(daMemoria(naFila.id)!.params.paraDrive).toBeUndefined();
      expect(await existe(naFila.file!)).toBe(false);
      // A lista do Drive já mostrou que ele está conectado.
      expect(tokenDeAcesso).not.toHaveBeenCalled();
    });

    it("sem vídeo no Drive, a fila só vai se o Drive estiver conectado", async () => {
      const naFila = await novoVideo();
      vi.mocked(tokenDeAcesso).mockRejectedValue(new DriveNaoConectado());
      await sincronizarComDrive();
      expect((await migracaoAgora()).rodando).toBe(false);
      expect(enviarArquivo).not.toHaveBeenCalled();
      expect(daMemoria(naFila.id)!.drive).toBeUndefined();

      zerarVideosNoDrive();
      vi.mocked(tokenDeAcesso).mockResolvedValue("token");
      await sincronizarComDrive();
      await vi.waitFor(async () => expect((await migracaoAgora()).rodando).toBe(false));
      expect(daMemoria(naFila.id)!.drive).toEqual({ id: "drv-1", pasta: "broll" });
      expect(listarArquivosDoHub).not.toHaveBeenCalled();
    });

    it("sem nenhum vídeo no Drive nem na fila, nem chama o Google", async () => {
      await novoVideo({ tool: "elevenlabs", kind: "audio" });
      await novoVideo({ tool: "upload", kind: "image" });
      await sincronizarComDrive();
      expect(listarArquivosDoHub).not.toHaveBeenCalled();
      expect(tokenDeAcesso).not.toHaveBeenCalled();
    });
  });

  describe("apagar e renomear pelo hub", () => {
    const pedirApagar = (id: string) => apagarUma(new Request(`${BASE}/api/generations/${id}`, { method: "DELETE" }), ctx({ id }));
    const pedirRenomear = (id: string, name: string) =>
      mudarUma(new Request(`${BASE}/api/generations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }), ctx({ id }));

    beforeEach(async () => {
      await bancoDeTeste();
      await entrarCom(["biblioteca", "estudios"]);
    });

    it("apagar manda o vídeo para a lixeira do Drive (não apaga de vez) e tira do hub", async () => {
      const gen = await novoVideo({ drive: { id: "drv-1", pasta: "broll" } }, { local: false });
      const res = await pedirApagar(gen.id);
      expect(res.status).toBe(200);
      expect(moverParaLixeira).toHaveBeenCalledWith("drv-1");
      expect(daMemoria(gen.id)).toBeUndefined();
    });

    it("se o Drive recusar, o vídeo não é apagado e a tela recebe o motivo", async () => {
      vi.mocked(moverParaLixeira).mockRejectedValue(new Error("O Google Drive está instável agora."));
      const gen = await novoVideo({ drive: { id: "drv-1", pasta: "broll" } }, { local: false });
      const res = await pedirApagar(gen.id);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("Não consegui mandar o vídeo para a lixeira do Google Drive, então ele não foi apagado. O Google Drive está instável agora.");
      expect(daMemoria(gen.id)).toBeDefined();
    });

    it("vídeo que só estava no disco é apagado como antes, sem chamar o Drive", async () => {
      const gen = await novoVideo();
      expect((await pedirApagar(gen.id)).status).toBe(200);
      expect(moverParaLixeira).not.toHaveBeenCalled();
      expect(await existe(gen.file!)).toBe(false);
    });

    it("renomear renomeia no Drive com a extensão; se o Drive falhar, o nome não muda", async () => {
      const gen = await novoVideo({ drive: { id: "drv-1", pasta: "broll" } }, { local: false });
      const res = await pedirRenomear(gen.id, "Xícara na mesa");
      expect(res.status).toBe(200);
      expect(renomear).toHaveBeenCalledWith("drv-1", "Xicara na mesa.mp4");
      expect(daMemoria(gen.id)!.name).toBe("Xícara na mesa");

      vi.mocked(renomear).mockRejectedValueOnce(new Error("O Google Drive pediu uma pausa."));
      const falhou = await pedirRenomear(gen.id, "Outro nome");
      expect(falhou.status).toBe(502);
      expect((await falhou.json()).error).toContain("o nome não mudou");
      expect(daMemoria(gen.id)!.name).toBe("Xícara na mesa");
    });

    it("“Limpar” do estúdio manda os vídeos do Drive para a lixeira; o que o Drive recusar fica", async () => {
      const vai = await novoVideo({ drive: { id: "drv-ok", pasta: "broll" } }, { local: false });
      const fica = await novoVideo({ drive: { id: "drv-falha", pasta: "broll" } }, { local: false });
      const salvo = await novoVideo({ drive: { id: "drv-salvo", pasta: "broll" }, saved: true }, { local: false });
      const soLocal = await novoVideo();
      vi.mocked(moverParaLixeira).mockImplementation(async (id) => {
        if (id === "drv-falha") throw new Error("O Google Drive negou o acesso.");
      });

      const res = await limpar(new Request(`${BASE}/api/generations?tool=flora`, { method: "DELETE" }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("1 vídeo não foi para a lixeira do Google Drive");
      expect(moverParaLixeira).toHaveBeenCalledTimes(2);
      expect(moverParaLixeira).not.toHaveBeenCalledWith("drv-salvo");
      expect(daMemoria(vai.id)).toBeUndefined();
      expect(daMemoria(soLocal.id)).toBeUndefined();
      expect(daMemoria(fica.id)).toBeDefined();
      expect(daMemoria(salvo.id)).toBeDefined();
    });

    it("“Limpar” nunca apaga os escondidos pelo espelho (podem voltar com a conta antiga do Drive)", async () => {
      const escondido = await novoVideo({ drive: { id: "drv-antigo", pasta: "broll" }, foraDoDrive: true }, { local: false });
      const vai = await novoVideo({ drive: { id: "drv-ok", pasta: "broll" } }, { local: false });

      const res = await limpar(new Request(`${BASE}/api/generations?tool=flora`, { method: "DELETE" }));
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toEqual([vai.id]);
      expect(daMemoria(escondido.id)).toBeDefined();
      expect(moverParaLixeira).toHaveBeenCalledTimes(1);
      expect(moverParaLixeira).toHaveBeenCalledWith("drv-ok");
    });
  });

  describe("zip dos vídeos de um card do Fluxo", () => {
    const pedirZip = (id: string) => baixarCard(new Request(`${BASE}/api/board/cards/${id}/download`), ctx({ id }));

    beforeEach(async () => {
      await bancoDeTeste();
      await entrarCom(["fluxo"]);
    });

    it("com vídeo no Drive e o Drive desconectado: 400 com o motivo, em vez de um zip cortado", async () => {
      const gen = await novoVideo({ drive: { id: "drv-1", pasta: "broll" } }, { local: false });
      const card = await createCard({ title: "Card do zip", generationIds: [gen.id] });
      vi.mocked(tokenDeAcesso).mockRejectedValue(new DriveNaoConectado());

      const res = await pedirZip(card.id);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Google Drive, e ele não está conectado");
      expect(abrirTrecho).not.toHaveBeenCalled();
    });

    it("relê cada vídeo na hora de pôr no zip: o que foi para o Drive no meio do caminho vem de lá", async () => {
      const gen = await novoVideo({ name: "Cena" });
      const card = await createCard({ title: "Card do zip", generationIds: [gen.id] });
      const res = await pedirZip(card.id);
      expect(res.status).toBe(200);
      // Só vídeo do disco na hora do pedido: nem confere o Drive.
      expect(tokenDeAcesso).not.toHaveBeenCalled();

      // Antes de o zip chegar a ele, o vídeo sobe para o Drive e sai do disco.
      daMemoria(gen.id)!.drive = { id: "drv-z", pasta: "broll" };
      await rm(path.join(MEDIA_DIR, gen.file!));
      const conteudo = new TextEncoder().encode("bytes-que-vieram-do-drive");
      vi.mocked(abrirTrecho).mockResolvedValue({ status: 200, cabecalhos: { "Content-Length": String(conteudo.length) }, corpo: new Response(conteudo).body });

      const zip = Buffer.from(await res.arrayBuffer());
      expect(abrirTrecho).toHaveBeenCalledWith("drv-z", null);
      expect(zip.includes(Buffer.from(conteudo))).toBe(true);
    });
  });

  describe("link de download do conector", () => {
    beforeEach(() => bancoDeTeste());

    it("vídeo no Drive vem de lá, em stream, com o nome do download", async () => {
      const conta = await criarConta({ email: `claude-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves: ["conector_claude", "biblioteca"], senha: null });
      const gen = await novoVideo({ drive: { id: "drv-entrega", pasta: "entregas" }, name: "Entrega final", params: { tamanhoNoDrive: 5 } }, { local: false });
      vi.mocked(abrirTrecho).mockResolvedValue({ status: 200, cabecalhos: { "Content-Length": "5" }, corpo: new Response(new Uint8Array([1, 2, 3, 4, 5])).body });

      const { url } = await criarLinkDeDownload(conta.id, gen.id, downloadName(gen), BASE);
      const res = await entregarDownload(url.split("/").pop()!);
      expect(res.status).toBe(200);
      expect(abrirTrecho).toHaveBeenCalledWith("drv-entrega", null);
      expect(res.headers.get("content-length")).toBe("5");
      expect(res.headers.get("content-disposition")).toContain('filename="Entrega final.mp4"');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

      // Apagado no Drive: o link responde que o vídeo não existe mais.
      geracoes[0].foraDoDrive = true;
      const apagado = await entregarDownload(url.split("/").pop()!);
      expect(apagado.status).toBe(404);
      expect((await apagado.json()).error).toContain("apagado no Google Drive");
    });

    // O jeito padrão de trabalho (decisão do Vinícius): o Claude Code de cada PC, ligado ao hub pelo conector.
    it("ponta a ponta pelo Claude Code: o vídeo enviado vai ao Drive, aparece na Biblioteca e no Fluxo, e o download vem do Drive", async () => {
      await prepararTeste();
      const pessoa = await criarPessoa({ chaves: ["conector_claude", "biblioteca", "fluxo"] });
      const { access_token: acesso } = await conectar(pessoa.id);
      vi.mocked(driveConectado).mockResolvedValue(true);
      // Google Drive simulado: guarda os bytes que chegaram e devolve tamanho e impressão digital de verdade.
      const noDrive = new Map<string, Buffer>();
      vi.mocked(enviarArquivo).mockImplementation(async (caminho, opcoes) => {
        const bytes = await readFile(caminho);
        noDrive.set("drv-entrega-claude", bytes);
        return arquivoNoDrive("drv-entrega-claude", opcoes.nome, { tamanho: bytes.length, md5: createHash("md5").update(bytes).digest("hex") });
      });
      vi.mocked(abrirTrecho).mockImplementation(async (id) => {
        const bytes = noDrive.get(id)!;
        return { status: 200, cabecalhos: { "Content-Length": String(bytes.length) }, corpo: new Response(new Uint8Array(bytes)).body };
      });
      const urlDoComando = (texto: string) => /"(https:\/\/hub\.teste\/api\/conector\/arquivos\/[^"]+)"/.exec(texto)![1];

      // 1. Envio: o Claude pede o link e roda o curl.
      const envio = await chamar(acesso, "link_de_envio", { nome_arquivo: "AD 01 - TESTE-9x16-ES-V1.mp4" });
      expect(envio.isError).toBe(false);
      const url = urlDoComando(envio.texto);
      const video = randomBytes(300_000);
      const res = await receberEnvio(new Request(url, { method: "PUT", body: video, headers: { "content-length": String(video.length) } }), url.split("/").pop()!);
      expect(res.status).toBe(201);
      const dados = await res.json();
      // A resposta só volta depois de o vídeo estar no Drive, conferido, e diz isso.
      expect(dados).toMatchObject({ ok: true, no_drive: true, tamanho_bytes: video.length });
      expect(dados.mensagem).toContain("guardado no Google Drive");
      expect(enviarArquivo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pasta: "entregas", nome: "AD 01 - TESTE-9x16-ES-V1.mp4" }));
      const gen = daMemoria(dados.generation_id)!;
      expect(gen.drive).toEqual({ id: "drv-entrega-claude", pasta: "entregas" });
      // Regra do dono: nenhuma cópia fica no disco do hub.
      expect(await existe(gen.file!)).toBe(false);

      // 2. Biblioteca: o vídeo aparece (está no Drive).
      const lista = JSON.parse((await chamar(acesso, "biblioteca_listar", { tipo: "video" })).texto);
      expect(lista.itens).toEqual([expect.objectContaining({ id: dados.generation_id, tipo: "video", tamanho_bytes: video.length })]);

      // 3. Fluxo: o card ganha o vídeo.
      const card = await chamar(acesso, "fluxo_salvar_card", { titulo: "TESTE · AD 01", adicionar_geracoes: [dados.generation_id] });
      expect(card.isError).toBe(false);
      expect(JSON.stringify(JSON.parse((await chamar(acesso, "fluxo_ver")).texto))).toContain(dados.generation_id);

      // 4. Download para o PC: vem do Drive, inteiro, com o nome do arquivo.
      const pedido = await chamar(acesso, "link_de_download", { generation_id: dados.generation_id });
      expect(pedido.isError).toBe(false);
      const baixado = await entregarDownload(urlDoComando(pedido.texto).split("/").pop()!);
      expect(baixado.status).toBe(200);
      expect(baixado.headers.get("content-type")).toBe("video/mp4");
      expect(baixado.headers.get("content-disposition")).toContain('filename="AD 01 - TESTE-9x16-ES-V1.mp4"');
      expect(Buffer.from(await baixado.arrayBuffer()).equals(video)).toBe(true);
      expect(abrirTrecho).toHaveBeenCalledWith("drv-entrega-claude", null);
    });

    it("pelo Claude Code, se o Drive não aceitar na hora, a resposta do curl diz que o vídeo ainda não está na Biblioteca", async () => {
      await prepararTeste();
      const pessoa = await criarPessoa({ chaves: ["conector_claude", "biblioteca"] });
      const { access_token: acesso } = await conectar(pessoa.id);
      vi.mocked(driveConectado).mockResolvedValue(true);
      vi.mocked(enviarArquivo).mockRejectedValue(new Error("O Google Drive está sem espaço."));
      const url = /"(https:\/\/hub\.teste\/api\/conector\/arquivos\/[^"]+)"/.exec((await chamar(acesso, "link_de_envio", { nome_arquivo: "AD 02.mp4" })).texto)![1];
      const video = randomBytes(1000);
      const res = await receberEnvio(new Request(url, { method: "PUT", body: video, headers: { "content-length": "1000" } }), url.split("/").pop()!);
      expect(res.status).toBe(201);
      const dados = await res.json();
      expect(dados.no_drive).toBe(false);
      expect(dados.mensagem).toContain("não aceitou agora");
      // Não aparece na Biblioteca enquanto não chega ao Drive; fica no disco só até o prazo de 12 horas.
      expect(JSON.parse((await chamar(acesso, "biblioteca_listar", {})).texto).itens).toEqual([]);
      expect(daMemoria(dados.generation_id)!.params).toMatchObject({ paraDrive: true, prazoNoHub: expect.any(String) });
    });
  });

  describe("migração para o Drive", () => {
    const pedirMigracao = () => migrar();
    const verMigracao = async () => (await estadoDaMigracao()).json();

    beforeEach(() => bancoDeTeste());

    it("leva um por vez os vídeos que ficaram no disco, conta feitos e falhas e não roda duas vezes", async () => {
      await entrarCom(["integracoes"]);
      const primeiro = adiado<void>();
      vi.mocked(enviarArquivo).mockImplementation(async (_caminho, opcoes) => {
        if (opcoes.pasta === "entregas") await primeiro.promessa;
        if (opcoes.pasta === "edicao-final") throw new Error("O Google Drive está sem espaço.");
        return arquivoNoDrive(`drv-${opcoes.pasta}`, opcoes.nome);
      });
      const broll = await novoVideo({ params: { paraDrive: true } });
      const edicao = await novoVideo({ tool: "montagem" });
      const entrega = await novoVideo({ tool: "upload", params: { origem: "conector" } });
      const anexo = await novoVideo({ tool: "upload" });
      const jaNoDrive = await novoVideo({ drive: { id: "drv-antigo", pasta: "broll" } }, { local: false });
      const audio = await novoVideo({ tool: "elevenlabs", kind: "audio" });

      const inicio = await (await pedirMigracao()).json();
      expect(inicio).toEqual({ rodando: true, total: 4, feitos: 0, falhas: 0, ultimoErro: null, bytes: 0 });
      // Já rodando: o segundo pedido só devolve o estado.
      expect(await (await pedirMigracao()).json()).toMatchObject({ rodando: true, total: 4 });

      primeiro.resolver();
      await vi.waitFor(async () => expect((await verMigracao()).rodando).toBe(false));
      expect(await verMigracao()).toEqual({ rodando: false, total: 4, feitos: 3, falhas: 1, ultimoErro: "O Google Drive está sem espaço.", bytes: 3000 });
      expect(enviarArquivo).toHaveBeenCalledTimes(4);

      expect(daMemoria(entrega.id)!.drive).toEqual({ id: "drv-entregas", pasta: "entregas" });
      expect(daMemoria(anexo.id)!.drive).toEqual({ id: "drv-enviados", pasta: "enviados" });
      expect(daMemoria(broll.id)!.drive).toEqual({ id: "drv-broll", pasta: "broll" });
      expect(daMemoria(broll.id)!.params.paraDrive).toBeUndefined();
      expect(daMemoria(edicao.id)!.params.paraDrive).toBe(true);
      expect(await existe(edicao.file!)).toBe(true);
      expect(await existe(anexo.file!)).toBe(false);
      expect(await existe(audio.file!)).toBe(true);
      expect(daMemoria(jaNoDrive.id)!.drive).toEqual({ id: "drv-antigo", pasta: "broll" });
    });

    it("sem Drive conectado, para no primeiro e conta o resto como falha", async () => {
      await entrarCom(["integracoes"]);
      vi.mocked(enviarArquivo).mockRejectedValue(new DriveNaoConectado());
      await novoVideo();
      await novoVideo({ tool: "editor" });
      await pedirMigracao();
      await vi.waitFor(async () => expect((await verMigracao()).rodando).toBe(false));
      expect(await verMigracao()).toMatchObject({ total: 2, feitos: 0, falhas: 2, ultimoErro: expect.stringContaining("não está conectado") });
      expect(enviarArquivo).toHaveBeenCalledTimes(1);
    });

    it("só quem cuida das Integrações", async () => {
      await entrarCom(["biblioteca", "estudios"]);
      expect((await pedirMigracao()).status).toBe(403);
      expect((await estadoDaMigracao()).status).toBe(403);
      expect(enviarArquivo).not.toHaveBeenCalled();
    });
  });

  // Regra do dono: vídeo só fica guardado no Google Drive. A faxina roda na subida e a cada 5 minutos.
  describe("faxina dos vídeos", () => {
    const HORA = 3600_000;
    const marcaDaRegra = path.join(path.dirname(MEDIA_DIR), "videos-so-no-drive.json");
    const solto = async (quando: Date, sufixo = "") => {
      const nome = `${crypto.randomUUID()}.mp4${sufixo}`;
      await writeFile(path.join(MEDIA_DIR, nome), new Uint8Array(1000));
      await utimes(path.join(MEDIA_DIR, nome), quando, quando);
      return nome;
    };

    beforeEach(async () => {
      await bancoDeTeste();
      await zerarFaxinaDosVideos();
      await rm(marcaDaRegra, { force: true });
    });

    it("vídeo novo que passou do prazo sem chegar ao Drive sai do disco e vira falha; o vídeo antigo de quem não tem Drive fica", async () => {
      vi.mocked(driveConectado).mockResolvedValue(false);
      const vencido = await novoVideo({ params: { prazoNoHub: new Date(Date.now() - 1000).toISOString(), paraDrive: true } });
      const noPrazo = await novoVideo({ params: { prazoNoHub: new Date(Date.now() + HORA).toISOString(), paraDrive: true } });
      const antigo = await novoVideo({ tool: "montagem" });
      const semArquivo = await novoVideo({ tool: "editor" }, { local: false });

      await faxinaDosVideos();

      expect(daMemoria(vencido.id)).toMatchObject({ status: "failed", error: MOTIVO_DO_DESCARTE });
      expect(daMemoria(vencido.id)!.file).toBeUndefined();
      expect(await existe(vencido.file!)).toBe(false);
      expect(daMemoria(noPrazo.id)!.status).toBe("done");
      expect(await existe(noPrazo.file!)).toBe(true);
      expect(daMemoria(antigo.id)!.status).toBe("done");
      expect(await existe(antigo.file!)).toBe(true);
      expect(daMemoria(semArquivo.id)).toMatchObject({ status: "failed", error: MOTIVO_SEM_ARQUIVO });
      expect(enviarArquivo).not.toHaveBeenCalled();
    });

    it("com Drive conectado, leva ao Drive o vídeo que ficou no disco e só então apaga daqui", async () => {
      vi.mocked(driveConectado).mockResolvedValue(true);
      vi.mocked(tokenDeAcesso).mockResolvedValue("token");
      const antigo = await novoVideo({ tool: "montagem" });
      await faxinaDosVideos();
      await vi.waitFor(() => expect(daMemoria(antigo.id)!.drive).toEqual({ id: "drv-1", pasta: "edicao-final" }));
      expect(await existe(antigo.file!)).toBe(false);
    });

    it("vídeo solto de antes da regra: sem Drive fica; com Drive vai para Recuperados do hub e só então sai", async () => {
      const antigo = await solto(new Date(Date.now() - 24 * HORA));
      vi.mocked(driveConectado).mockResolvedValue(false);
      await faxinaDosVideos();
      expect(await existe(antigo)).toBe(true);
      expect(enviarArquivo).not.toHaveBeenCalled();

      vi.mocked(driveConectado).mockResolvedValue(true);
      await faxinaDosVideos();
      await vi.waitFor(async () => expect(await existe(antigo)).toBe(false));
      expect(enviarArquivo).toHaveBeenCalledWith(path.join(MEDIA_DIR, antigo), expect.objectContaining({ pasta: "recuperados" }));
    });

    it("vídeo solto que não chegou inteiro ao Drive não sai do hub", async () => {
      const antigo = await solto(new Date(Date.now() - 24 * HORA));
      vi.mocked(driveConectado).mockResolvedValue(true);
      vi.mocked(enviarArquivo).mockImplementation(async (_caminho, opcoes) => arquivoNoDrive("drv-cortado", opcoes.nome, { tamanho: 10 }));
      await faxinaDosVideos();
      await vi.waitFor(() => expect(moverParaLixeira).toHaveBeenCalledWith("drv-cortado"));
      expect(await existe(antigo)).toBe(true);
    });

    it("resto de trabalho solto de depois da regra sai depois de 1 hora sem mudar; o recente fica", async () => {
      vi.mocked(driveConectado).mockResolvedValue(false);
      // A regra começou há 2 horas.
      await faxinaDosVideos({ agora: Date.now() - 2 * HORA });
      const velho = await solto(new Date(Date.now() - 90 * 60_000));
      const pelaMetade = await solto(new Date(Date.now() - 90 * 60_000), ".parcial");
      const recente = await solto(new Date());
      const comRegistro = await novoVideo({ tool: "montagem" });

      await faxinaDosVideos();

      expect(await existe(velho)).toBe(false);
      expect(await existe(pelaMetade)).toBe(false);
      expect(await existe(recente)).toBe(true);
      expect(await existe(comRegistro.file!)).toBe(true);
      expect(enviarArquivo).not.toHaveBeenCalled();
    });
  });
});
