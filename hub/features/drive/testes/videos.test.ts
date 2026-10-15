import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as estadoDaMigracao, POST as migrar } from "@/app/api/drive/migrar/route";
import { DELETE as apagarUma, PATCH as mudarUma } from "@/app/api/generations/[id]/route";
import { DELETE as limpar } from "@/app/api/generations/route";
import { GET as midia } from "@/app/api/media/[file]/route";
import { bancoDeTeste } from "@/db/teste";
import type { Chave } from "@/features/acesso/contrato";
import { criarConta } from "@/features/acesso/testes/ajuda";
import { criarLinkDeDownload, entregarDownload } from "@/features/conector/servicos/links";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import type { ArquivoDrive } from "@/features/drive/contrato";
import { abrirTrecho, baixarParaTemp, enviarArquivo, moverParaLixeira, renomear, situacao } from "@/features/drive/servicos/arquivos";
import { DriveNaoConectado } from "@/features/drive/servicos/conta";
import { arquivoLocal, guardarNoDrive, pastaDaGeracao, sincronizarComDrive, zerarVideosNoDrive } from "@/features/drive/servicos/videos";
import { downloadName, type Generation } from "@/lib/generations";
import { MEDIA_DIR } from "@/lib/server/media";
import * as store from "@/lib/server/store";

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
  situacao: vi.fn(),
  ArquivoForaDoDrive: class ArquivoForaDoDrive extends Error {},
}));
vi.mock("@/features/drive/servicos/conta", () => ({
  DriveNaoConectado: class DriveNaoConectado extends Error {
    constructor() {
      super("O Google Drive não está conectado. Um admin precisa conectar em Integrações → Google Drive.");
    }
  },
}));
// As gerações ficam na memória do teste e a pasta de dados é temporária (a mídia vai para <temp>/media). Como o
// store de verdade (que relê o JSON do disco), cada leitura devolve uma cópia.
vi.mock("@/lib/server/store", async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const caminho = await import("node:path");
  const geracoes: Generation[] = [];
  const copia = <T,>(g: T): T => structuredClone(g);
  return {
    DATA_DIR: mkdtempSync(caminho.join(os.tmpdir(), "hub-drive-videos-")),
    geracoes,
    listGenerations: async (tool?: string, opcoes: { incluirForaDoDrive?: boolean } = {}) =>
      [...geracoes].reverse().filter((g) => (!tool || g.tool === tool) && (opcoes.incluirForaDoDrive || !g.foraDoDrive)).map(copia),
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
    zerarVideosNoDrive();
    geracoes.length = 0;
    sessao.logado = null;
    await rm(MEDIA_DIR, { recursive: true, force: true });
    await mkdir(MEDIA_DIR, { recursive: true });
    let n = 0;
    vi.mocked(enviarArquivo).mockImplementation(async (_caminho, opcoes) => arquivoNoDrive(`drv-${++n}`, opcoes.nome));
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

    it("cada origem vai para a sua pasta; imagens, áudios e anexos das pessoas ficam no disco", async () => {
      const pasta = (dados: Partial<Generation>) => pastaDaGeracao({ id: "x", tool: "flora", kind: "video", status: "done", prompt: "", params: {}, createdAt: "", ...dados } as Generation);
      expect(pasta({ tool: "montagem" })).toBe("edicao-final");
      expect(pasta({ tool: "montagem", params: { formato: "batida" } })).toBe("batida");
      expect(pasta({ tool: "montagem", params: { formato: "sem-legenda" } })).toBe("sem-legenda");
      expect(pasta({ tool: "editor" })).toBe("editor");
      expect(pasta({ tool: "heygen-traducao" })).toBe("traducao");
      expect(pasta({ tool: "flora" })).toBe("broll");
      expect(pasta({ tool: "heygen" })).toBe("avatar");
      expect(pasta({ tool: "higgsfield" })).toBe("outros");
      expect(pasta({ tool: "upload", params: { origem: "conector" } })).toBe("entregas");
      expect(pasta({ tool: "upload" })).toBeNull();
      expect(pasta({ tool: "flora", kind: "image" })).toBeNull();
      expect(pasta({ tool: "heygen-traducao", kind: "audio" })).toBeNull();

      const anexo = await novoVideo({ tool: "upload", prompt: "video-do-celular.mp4" });
      const rodando = await novoVideo({ status: "running" });
      expect(await guardarNoDrive(anexo)).toMatchObject({ id: anexo.id, file: anexo.file });
      await guardarNoDrive(rodando);
      expect(enviarArquivo).not.toHaveBeenCalled();
      expect(await existe(anexo.file!)).toBe(true);
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
      expect(abrirTrecho).toHaveBeenCalledWith("drv-7", "bytes=0-99");
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
  });

  describe("espelho do Drive", () => {
    it("marca apagados e os da lixeira, acompanha o nome e traz de volta o que saiu da lixeira", async () => {
      const apagado = await novoVideo({ drive: { id: "a", pasta: "broll" } }, { local: false });
      const naLixeira = await novoVideo({ drive: { id: "b", pasta: "broll" } }, { local: false });
      const renomeado = await novoVideo({ drive: { id: "c", pasta: "edicao-final" }, tool: "montagem", name: "Edição AD 3" }, { local: false });
      const devolvido = await novoVideo({ drive: { id: "d", pasta: "broll" }, foraDoDrive: true }, { local: false });
      const igual = await novoVideo({ drive: { id: "e", pasta: "broll" }, name: "Café" }, { local: false });
      const local = await novoVideo();
      vi.mocked(situacao).mockResolvedValue([
        arquivoNoDrive("b", downloadName(naLixeira), { noLixo: true }),
        arquivoNoDrive("c", "Edição AD 3 versão final.mp4"),
        arquivoNoDrive("d", downloadName(devolvido)),
        arquivoNoDrive("e", downloadName(igual)),
      ]);

      await sincronizarComDrive();

      expect(situacao).toHaveBeenCalledTimes(1);
      expect(vi.mocked(situacao).mock.calls[0][0].sort()).toEqual(["a", "b", "c", "d", "e"]);
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
      expect(situacao).toHaveBeenCalledTimes(1);
    });

    it("erro de login ou de conexão não muda nada", async () => {
      const gen = await novoVideo({ drive: { id: "a", pasta: "broll" }, name: "Original" }, { local: false });
      vi.mocked(situacao).mockRejectedValue(new DriveNaoConectado());
      await sincronizarComDrive();
      expect(daMemoria(gen.id)).toEqual(gen);

      zerarVideosNoDrive();
      vi.mocked(situacao).mockRejectedValue(new Error("O Google não aceitou o login do Drive."));
      await sincronizarComDrive();
      expect(daMemoria(gen.id)).toEqual(gen);
    });

    it("sem nenhum vídeo no Drive, nem chama o Google", async () => {
      await novoVideo();
      await sincronizarComDrive();
      expect(situacao).not.toHaveBeenCalled();
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
      expect(inicio).toEqual({ rodando: true, total: 3, feitos: 0, falhas: 0, ultimoErro: null });
      // Já rodando: o segundo pedido só devolve o estado.
      expect(await (await pedirMigracao()).json()).toMatchObject({ rodando: true, total: 3 });

      primeiro.resolver();
      await vi.waitFor(async () => expect((await verMigracao()).rodando).toBe(false));
      expect(await verMigracao()).toEqual({ rodando: false, total: 3, feitos: 2, falhas: 1, ultimoErro: "O Google Drive está sem espaço." });
      expect(enviarArquivo).toHaveBeenCalledTimes(3);

      expect(daMemoria(entrega.id)!.drive).toEqual({ id: "drv-entregas", pasta: "entregas" });
      expect(daMemoria(broll.id)!.drive).toEqual({ id: "drv-broll", pasta: "broll" });
      expect(daMemoria(broll.id)!.params.paraDrive).toBeUndefined();
      expect(daMemoria(edicao.id)!.params.paraDrive).toBe(true);
      expect(await existe(edicao.file!)).toBe(true);
      expect(await existe(anexo.file!)).toBe(true);
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
});
