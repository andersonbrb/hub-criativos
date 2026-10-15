import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as apagarUma, PATCH as mudarUma } from "@/app/api/generations/[id]/route";
import { DELETE as limpar, GET as listar } from "@/app/api/generations/route";
import { GET as midia } from "@/app/api/media/[file]/route";
import { POST as enviar } from "@/app/api/uploads/route";
import VerPage from "@/app/ver/[id]/page";
import { bancoDeTeste } from "@/db/teste";
import type { Chave } from "@/features/acesso/contrato";
import { criarConta } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { MEDIA_DIR, saveUploadedMedia } from "@/lib/server/media";
import * as store from "@/lib/server/store";

// Quem pode listar, apagar, renomear, baixar e enviar gerações: cada rota exige a chave das telas que a chamam
// (antes bastava estar logado, e uma conta só com a Memória apagava a Biblioteca inteira).

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
// As gerações ficam na memória do teste e a pasta de dados é temporária (a mídia vai para <temp>/media).
vi.mock("@/lib/server/store", async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const caminho = await import("node:path");
  const geracoes: Generation[] = [];
  return {
    DATA_DIR: mkdtempSync(caminho.join(os.tmpdir(), "hub-geracoes-")),
    geracoes,
    listGenerations: async (tool?: string) => [...geracoes].reverse().filter((g) => !tool || g.tool === tool),
    getGeneration: async (id: string) => geracoes.find((g) => g.id === id),
    createGeneration: async (dados: Omit<Generation, "id" | "createdAt">) => {
      const g = { ...dados, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as Generation;
      geracoes.push(g);
      return g;
    },
    updateGeneration: async (id: string, patch: Partial<Generation>) => {
      const g = geracoes.find((x) => x.id === id);
      if (g) Object.assign(g, patch);
      return g;
    },
    deleteGeneration: async (id: string) => {
      const i = geracoes.findIndex((g) => g.id === id);
      if (i >= 0) geracoes.splice(i, 1);
      return i >= 0;
    },
    // Como o store de verdade: não apaga o que está salvo na Biblioteca nem o que ainda está gerando.
    clearGenerations: async (tool: string) => {
      const sai = geracoes.filter((g) => g.tool === tool && !g.saved && g.status !== "pending" && g.status !== "running");
      for (const g of sai) geracoes.splice(geracoes.indexOf(g), 1);
      return sai;
    },
  };
});
// A página /ver devolve o redirect como erro, para o teste ver o destino.
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const geracoes = (store as unknown as { geracoes: Generation[] }).geracoes;
const BASE = "https://hub.teste";

async function entrarCom(chaves: Chave[]) {
  const conta = await criarConta({ email: `${chaves.join("-") || "nada"}-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves, senha: null });
  sessao.logado = conta.id;
  return conta;
}

async function novaGeracao(dados: Partial<Generation> & { conteudo?: Uint8Array; ext?: string } = {}) {
  const { conteudo, ext = "mp4", ...resto } = dados;
  const file = `${crypto.randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, file), conteudo ?? new Uint8Array(1000).map((_, i) => i % 256));
  return store.createGeneration({ tool: "flora", kind: "video", status: "done", prompt: "teste", params: {}, file, ...resto });
}

const existe = (file: string) => readFile(path.join(MEDIA_DIR, file)).then(() => true, () => false);
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const pedirLista = (q = "") => listar(new Request(`${BASE}/api/generations${q}`));
const pedirLimpeza = (tool: string) => limpar(new Request(`${BASE}/api/generations?tool=${tool}`, { method: "DELETE" }));
const pedirApagar = (id: string) => apagarUma(new Request(`${BASE}/api/generations/${id}`, { method: "DELETE" }), ctx({ id }));
const pedirRenomear = (id: string, name: string) =>
  mudarUma(new Request(`${BASE}/api/generations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }), ctx({ id }));
const pedirMidia = (file: string, headers: Record<string, string> = {}) => midia(new Request(`${BASE}/api/media/${file}`, { headers }), ctx({ file }));

// Formulário como o navegador manda (multipart), em bytes, para dar para cortar ou partir em pedaços.
async function formulario(arquivo: File, extras: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extras)) form.set(k, v);
  form.set("file", arquivo);
  const r = new Response(form);
  return { bytes: new Uint8Array(await r.arrayBuffer()), tipo: r.headers.get("content-type")! };
}

// Corpo em stream, em pedaços de `tamanho` bytes (o separador do multipart chega partido entre pedaços).
// `lido.ate` diz até onde o servidor leu.
function emPedacos(bytes: Uint8Array, tamanho: number, lido = { ate: 0 }) {
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (lido.ate >= bytes.length) return c.close();
      c.enqueue(bytes.slice(lido.ate, lido.ate + tamanho));
      lido.ate += tamanho;
    },
  });
}

const pedirEnvio = (corpo: BodyInit, headers: Record<string, string> = {}) =>
  enviar(new Request(`${BASE}/api/uploads`, { method: "POST", body: corpo, headers, duplex: "half" } as RequestInit));

const arquivosNaPasta = async () => (await readdir(MEDIA_DIR).catch(() => [] as string[])).sort();

describe("rotas de gerações e mídia: chave da tela", () => {
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await bancoDeTeste();
    sessao.logado = null;
    geracoes.length = 0;
    await rm(MEDIA_DIR, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(MEDIA_DIR, { recursive: true });
  });
  afterAll(() => rm(path.dirname(MEDIA_DIR), { recursive: true, force: true }));

  it("sem login: 401 em tudo", async () => {
    const g = await novaGeracao();
    expect((await pedirLista()).status).toBe(401);
    expect((await pedirLimpeza("flora")).status).toBe(401);
    expect((await pedirApagar(g.id)).status).toBe(401);
    expect((await pedirMidia(g.file!)).status).toBe(401);
    expect(geracoes).toHaveLength(1);
  });

  it("conta só com a Memória não lista, não apaga, não renomeia, não baixa e não envia", async () => {
    const g = await novaGeracao();
    await entrarCom(["memoria", "memoria_editar", "conector_claude"]);
    expect((await pedirLista()).status).toBe(403);
    expect((await pedirLimpeza("flora")).status).toBe(403);
    expect((await pedirApagar(g.id)).status).toBe(403);
    expect((await pedirRenomear(g.id, "outro")).status).toBe(403);
    expect((await pedirMidia(g.file!)).status).toBe(403);
    const { bytes, tipo } = await formulario(new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" }));
    expect((await pedirEnvio(bytes, { "content-type": tipo })).status).toBe(403);
    // Nada mudou.
    expect(geracoes).toEqual([g]);
    expect(g.name).toBeUndefined();
    expect(await existe(g.file!)).toBe(true);
    expect(await arquivosNaPasta()).toEqual([g.file]);
  });

  it("listar: qualquer tela de produção serve", async () => {
    await novaGeracao({ saved: true });
    await novaGeracao();
    for (const chave of ["biblioteca", "estudios", "editor", "fluxo", "chat", "criativo-automatico"] as Chave[]) {
      await entrarCom([chave]);
      const res = await pedirLista("?saved=1");
      expect(res.status, chave).toBe(200);
      expect((await res.json()).generations).toHaveLength(1);
    }
  });

  it("Limpar (apagar em massa): só com os Estúdios, e só o histórico de um estúdio", async () => {
    const solta = await novaGeracao();
    const salva = await novaGeracao({ saved: true });
    const outraFerramenta = await novaGeracao({ tool: "elevenlabs", kind: "audio", ext: "mp3" });
    const envio = await novaGeracao({ tool: "upload" });

    // Biblioteca, Fluxo, Editor, Chat e Criativo automático não têm o botão Limpar.
    await entrarCom(["biblioteca", "fluxo", "editor", "chat", "criativo-automatico"]);
    const negado = await pedirLimpeza("flora");
    expect(negado.status).toBe(403);
    expect((await negado.json()).error).toContain("Estúdios");
    expect(geracoes).toHaveLength(4);

    await entrarCom(["estudios"]);
    // Anexos e exportações não têm "Limpar": não se apagam em massa.
    expect((await pedirLimpeza("upload")).status).toBe(400);
    expect((await pedirLimpeza("editor")).status).toBe(400);
    expect(await existe(envio.file!)).toBe(true);

    const res = await pedirLimpeza("flora");
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toEqual([solta.id]);
    expect(await existe(solta.file!)).toBe(false);
    expect(await existe(salva.file!)).toBe(true);
    expect(geracoes.map((g) => g.id).sort()).toEqual([salva.id, outraFerramenta.id, envio.id].sort());
  });

  it("apagar uma geração: as telas com lixeira; o Fluxo só tira do card", async () => {
    const g = await novaGeracao();
    await entrarCom(["fluxo"]);
    expect((await pedirApagar(g.id)).status).toBe(403);
    expect(await existe(g.file!)).toBe(true);

    for (const chave of ["biblioteca", "estudios", "editor", "chat", "criativo-automatico"] as Chave[]) {
      const outra = await novaGeracao();
      await entrarCom([chave]);
      expect((await pedirApagar(outra.id)).status, chave).toBe(200);
      expect(await existe(outra.file!), chave).toBe(false);
    }
  });

  it("renomear e salvar na Biblioteca: o card de geração do Fluxo também tem os botões", async () => {
    const g = await novaGeracao();
    await entrarCom(["fluxo"]);
    const res = await pedirRenomear(g.id, "  Nome   novo ");
    expect(res.status).toBe(200);
    expect((await res.json()).generation.name).toBe("Nome novo");
  });

  it("mídia: baixa com uma tela de produção; link aberto sem a chave vai para 'sem acesso'", async () => {
    const conteudo = new Uint8Array(1000).map((_, i) => i % 256);
    const g = await novaGeracao({ conteudo });
    await entrarCom(["memoria"]);
    const navegando = await pedirMidia(g.file!, { "sec-fetch-mode": "navigate" });
    expect(navegando.status).toBe(303);
    expect(navegando.headers.get("location")).toMatch(/^\/sem-acesso/);

    await entrarCom(["chat"]);
    const res = await pedirMidia(g.file!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), Buffer.from(conteudo))).toBe(0);
  });

  it("mídia: intervalos (Range) em stream, e 416 para intervalo inválido", async () => {
    const conteudo = new Uint8Array(1000).map((_, i) => i % 256);
    const g = await novaGeracao({ conteudo });
    await entrarCom(["biblioteca"]);

    const tudo = await pedirMidia(g.file!, { range: "bytes=0-" });
    expect(tudo.status).toBe(206);
    expect(tudo.headers.get("content-range")).toBe("bytes 0-999/1000");
    expect(tudo.headers.get("content-length")).toBe("1000");
    expect((await tudo.arrayBuffer()).byteLength).toBe(1000);

    const meio = await pedirMidia(g.file!, { range: "bytes=10-19" });
    expect(meio.status).toBe(206);
    expect(meio.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect([...new Uint8Array(await meio.arrayBuffer())]).toEqual([...conteudo.slice(10, 20)]);

    const fim = await pedirMidia(g.file!, { range: "bytes=-5" });
    expect(fim.headers.get("content-range")).toBe("bytes 995-999/1000");
    expect([...new Uint8Array(await fim.arrayBuffer())]).toEqual([...conteudo.slice(995)]);

    // Fim depois do tamanho: corta no fim do arquivo.
    const alem = await pedirMidia(g.file!, { range: "bytes=990-5000" });
    expect(alem.status).toBe(206);
    expect(alem.headers.get("content-range")).toBe("bytes 990-999/1000");

    for (const range of ["bytes=1000-", "bytes=5000-6000", "bytes=50-10", "bytes=-0", "bytes=-", "bytes=abc"]) {
      const res = await pedirMidia(g.file!, { range });
      expect(res.status, range).toBe(416);
      expect(res.headers.get("content-range"), range).toBe("bytes */1000");
    }

    // Unidade desconhecida ou vários intervalos: o arquivo inteiro.
    expect((await pedirMidia(g.file!, { range: "items=0-5" })).status).toBe(200);
    expect((await pedirMidia(g.file!, { range: "bytes=0-1,5-6" })).status).toBe(200);
  });

  it("mídia: arquivo que não é mídia conhecida só baixa (anexo), nunca abre como página", async () => {
    const g = await novaGeracao({ ext: "html", conteudo: new TextEncoder().encode("<script>alert(1)</script>") });
    await entrarCom(["chat"]);
    const res = await pedirMidia(g.file!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("envio: Editor, Fluxo e Estúdios enviam; o arquivo vai inteiro para o disco", async () => {
    await entrarCom(["chat", "biblioteca"]);
    const video = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
    const pedido = await formulario(new File([video], "Meu vídeo.MP4", { type: "video/mp4" }));
    expect((await pedirEnvio(pedido.bytes, { "content-type": pedido.tipo })).status).toBe(403);
    expect(geracoes).toHaveLength(0);

    for (const chave of ["editor", "fluxo", "estudios"] as Chave[]) {
      await entrarCom([chave]);
      const res = await pedirEnvio(pedido.bytes, { "content-type": pedido.tipo });
      expect(res.status, chave).toBe(200);
      const { generation } = (await res.json()) as { generation: Generation };
      expect(generation).toMatchObject({ tool: "upload", kind: "video", status: "done", prompt: "Meu vídeo.MP4" });
      expect(generation.file).toMatch(/^[\w-]+\.mp4$/);
      expect(Buffer.compare(await readFile(path.join(MEDIA_DIR, generation.file!)), Buffer.from(video))).toBe(0);
    }
  });

  it("envio: separador partido entre pedaços, outro campo antes do arquivo e bytes parecidos com o separador", async () => {
    await entrarCom(["editor"]);
    // Conteúdo com quebras de linha e traços, como um separador pela metade.
    const parecido = new TextEncoder().encode("\r\n--\r\n----WebKit\r\n-");
    const audio = new Uint8Array(50_000).map((_, i) => (i % 97 === 0 ? 13 : i % 89 === 0 ? 45 : i % 256));
    const conteudo = Buffer.concat([parecido, audio, parecido]);
    const pedido = await formulario(new File([conteudo], "voz.mp3", { type: "audio/mpeg" }), { nota: "campo de texto" });
    for (const tamanho of [1, 7, 64, 4096]) {
      const res = await pedirEnvio(emPedacos(pedido.bytes, tamanho), { "content-type": pedido.tipo });
      expect(res.status, String(tamanho)).toBe(200);
      const { generation } = (await res.json()) as { generation: Generation };
      expect(generation.kind).toBe("audio");
      expect(Buffer.compare(await readFile(path.join(MEDIA_DIR, generation.file!)), conteudo), String(tamanho)).toBe(0);
    }
  });

  it("envio: recusa o que não é mídia, arquivo vazio, corpo cortado e tamanho acima do teto, sem deixar nada no disco", async () => {
    await entrarCom(["estudios"]);
    // Recusa logo no começo, mas lê o resto do corpo até o fim: cortar a leitura derrubaria a conexão e a tela não
    // veria a mensagem.
    const texto = await formulario(new File([new Uint8Array(30_000).fill(65)], "nota.txt", { type: "text/plain" }));
    const lido = { ate: 0 };
    const naoMidia = await pedirEnvio(emPedacos(texto.bytes, 1024, lido), { "content-type": texto.tipo });
    expect(naoMidia.status).toBe(400);
    expect((await naoMidia.json()).error).toBe("Envie um vídeo, áudio ou imagem.");
    expect(lido.ate).toBeGreaterThanOrEqual(texto.bytes.length);

    const vazio = await formulario(new File([], "v.mp4", { type: "video/mp4" }));
    const resVazio = await pedirEnvio(vazio.bytes, { "content-type": vazio.tipo });
    expect(resVazio.status).toBe(400);
    expect((await resVazio.json()).error).toBe("Escolha um arquivo.");

    // Campo de arquivo sem arquivo escolhido (filename vazio).
    const naoEscolhido = await formulario(new File([], "", { type: "application/octet-stream" }));
    const resNaoEscolhido = await pedirEnvio(naoEscolhido.bytes, { "content-type": naoEscolhido.tipo });
    expect((await resNaoEscolhido.json()).error).toBe("Escolha um arquivo.");

    const semArquivo = await pedirEnvio("x=1", { "content-type": "application/x-www-form-urlencoded" });
    expect(semArquivo.status).toBe(400);

    // A conexão cai no meio: o fim do formulário (e parte do vídeo) não chega.
    const video = await formulario(new File([new Uint8Array(20_000).fill(9)], "v.mp4", { type: "video/mp4" }));
    const cortado = await pedirEnvio(emPedacos(video.bytes.slice(0, 15_000), 1024), { "content-type": video.tipo });
    expect(cortado.status).toBe(400);
    expect((await cortado.json()).error).toContain("incompleto");

    // O navegador avisa um tamanho acima de 1 GB: recusa antes de receber.
    const grande = await pedirEnvio(emPedacos(video.bytes, 1024), { "content-type": video.tipo, "content-length": String(1024 ** 3 + 1) });
    expect(grande.status).toBe(400);
    expect((await grande.json()).error).toBe("O arquivo pode ter até 1 GB.");

    expect(geracoes).toHaveLength(0);
    expect(await arquivosNaPasta()).toEqual([]);
  });

  it("envio sem tamanho declarado para no teto enquanto recebe e apaga o pedaço gravado", async () => {
    const teto = 2 * 1024 * 1024;
    const video = await formulario(new File([new Uint8Array(teto + 100_000)], "grande.mp4", { type: "video/mp4" }));
    const pedido = new Request(`${BASE}/api/uploads`, { method: "POST", body: emPedacos(video.bytes, 64 * 1024), headers: { "content-type": video.tipo }, duplex: "half" } as RequestInit);
    const erro = await saveUploadedMedia(pedido, { tetoBytes: teto }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(InputError);
    expect((erro as Error).message).toBe("O arquivo pode ter até 2 MB.");
    expect(await arquivosNaPasta()).toEqual([]);
  });

  it("/ver: abre com uma tela de produção; sem nenhuma, vai para 'sem acesso'", async () => {
    const g = await novaGeracao();
    const abrir = () => VerPage({ params: Promise.resolve({ id: g.id }) } as Parameters<typeof VerPage>[0]);
    await entrarCom(["memoria"]);
    await expect(abrir()).rejects.toThrow("redirect:/sem-acesso");
    await entrarCom(["fluxo"]);
    await expect(abrir()).resolves.toBeTruthy();
  });
});
