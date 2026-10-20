import { mkdtempSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as baixar, PUT as enviar } from "@/app/api/conector/arquivos/[token]/route";
import { banco } from "@/db/cliente";
import { conectorLinks } from "@/db/schema";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { driveConectado } from "@/features/drive/servicos/conta";
import type { Generation } from "@/lib/generations";
import { pastaDeMidiaDa, usarRaizDosDados } from "@/lib/server/pastas";
import * as store from "@/lib/server/store";
import { chamar, conectar, criarPessoa, mudarPessoa, prepararTeste } from "@/features/conector/testes/apoio";

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
vi.mock("@/features/memoria/servicos/memoria", () => ({}));
// Drive "conectado" (regra do dono: sem ele o hub não recebe vídeo). O envio ao Google não acontece: sem conta no
// banco de teste, o token falha e o vídeo fica no disco marcado para depois.
vi.mock("@/features/drive/servicos/conta", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/drive/servicos/conta")>();
  return { ...real, driveConectado: vi.fn(async () => true) };
});
// As gerações ficam na memória do teste (o store de verdade grava em hub/.data/db.json).
vi.mock("@/lib/server/store", () => {
  const geracoes: Generation[] = [];
  return {
    DATA_DIR: "nao-usar",
    geracoes,
    listGenerations: vi.fn(async () => [...geracoes].reverse()),
    getGeneration: vi.fn(async (id: string) => geracoes.find((g) => g.id === id)),
    createGeneration: vi.fn(async (dados: Omit<Generation, "id" | "createdAt">) => {
      const g = { ...dados, id: crypto.randomUUID(), createdAt: new Date().toISOString() } as Generation;
      geracoes.push(g);
      return g;
    }),
  };
});
// A mídia vai para uma pasta temporária (a da organização padrão fica em <temp>/media).
usarRaizDosDados(mkdtempSync(path.join(os.tmpdir(), "hub-conector-midia-")));
const MEDIA_DIR = pastaDeMidiaDa(ORGANIZACAO_PADRAO.id);

const geracoes = (store as unknown as { geracoes: Generation[] }).geracoes;

const urlDoComando = (texto: string) => texto.match(/"(https:\/\/hub\.teste\/api\/conector\/arquivos\/[^"]+)"/)![1];
const tokenDaUrl = (url: string) => url.split("/").pop()!;

function put(url: string, corpo: Uint8Array<ArrayBuffer>, tamanhoDeclarado = corpo.length) {
  return enviar(new Request(url, { method: "PUT", body: corpo, headers: { "content-length": String(tamanhoDeclarado) } }), {
    params: Promise.resolve({ token: tokenDaUrl(url) }),
  });
}

const get = (url: string) => baixar(new Request(url), { params: Promise.resolve({ token: tokenDaUrl(url) }) });

describe("conector: links de envio e download", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(driveConectado).mockResolvedValue(true);
    await prepararTeste();
    geracoes.length = 0;
  });

  it("sem Google Drive conectado, vídeo não entra (nem o link sai); imagem continua", async () => {
    const { acesso } = await conectado();
    vi.mocked(driveConectado).mockResolvedValue(false);
    const video = await chamar(acesso, "link_de_envio", { nome_arquivo: "kit.mp4" });
    expect(video.isError).toBe(true);
    expect(video.texto).toContain("O Google Drive desta organização não está conectado.");
    expect((await chamar(acesso, "link_de_envio", { nome_arquivo: "foto.png" })).isError).toBe(false);

    // Link criado com o Drive conectado, e o Drive caiu antes do envio: recusa sem gravar e o link continua valendo.
    vi.mocked(driveConectado).mockResolvedValue(true);
    const url = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "kit.mp4" })).texto);
    vi.mocked(driveConectado).mockResolvedValue(false);
    const res = await put(url, new Uint8Array(1000));
    expect(res.status).toBe(400);
    expect(geracoes).toHaveLength(0);
    vi.mocked(driveConectado).mockResolvedValue(true);
    expect((await put(url, new Uint8Array(1000))).status).toBe(201);
  });
  afterAll(() => rm(MEDIA_DIR, { recursive: true, force: true }));

  async function conectado(chaves = ["conector_claude", "biblioteca"] as const) {
    const pessoa = await criarPessoa({ chaves: [...chaves] });
    return { pessoa, acesso: (await conectar(pessoa.id)).access_token };
  }

  it("envio: o curl grava o arquivo na pasta de mídia e cria a geração na Biblioteca; o link não vale de novo", async () => {
    const { pessoa, acesso } = await conectado();
    const resposta = await chamar(acesso, "link_de_envio", { nome_arquivo: "kit-chile-v3.mp4" });
    expect(resposta.isError).toBe(false);
    expect(resposta.texto).toMatch(/curl -T "kit-chile-v3\.mp4" "https:\/\/hub\.teste\/api\/conector\/arquivos\/hub_lk_/);
    const url = urlDoComando(resposta.texto);

    const conteudo = new Uint8Array(300_000).map((_, i) => i % 251);
    const res = await put(url, conteudo);
    expect(res.status).toBe(201);
    const dados = await res.json();
    expect(dados).toMatchObject({ ok: true, nome: "kit-chile-v3.mp4", tamanho_bytes: conteudo.length });

    expect(store.createGeneration).toHaveBeenCalledTimes(1);
    const [geracao] = geracoes;
    expect(geracao).toMatchObject({
      id: dados.generation_id,
      tool: "upload",
      kind: "video",
      status: "done",
      prompt: "kit-chile-v3.mp4",
      name: "kit-chile-v3",
      params: { origem: "conector", por: pessoa.email },
      saved: true,
    });
    expect(geracao.file).toMatch(/^[\w-]+\.mp4$/);
    const gravado = await readFile(path.join(MEDIA_DIR, geracao.file!));
    expect(Buffer.compare(gravado, Buffer.from(conteudo))).toBe(0);

    // Uso único.
    expect((await put(url, conteudo)).status).toBe(404);
    expect(geracoes).toHaveLength(1);
    // Só o hash do token fica no banco.
    const [link] = await banco().select().from(conectorLinks);
    expect(JSON.stringify(link)).not.toContain(tokenDaUrl(url));
    expect(link.generationId).toBe(geracao.id);
  });

  it("arquivo que chega incompleto é recusado, nada fica no disco e o link continua valendo", async () => {
    const { acesso } = await conectado();
    const url = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "foto.png" })).texto);
    const antes = await readdir(MEDIA_DIR);
    const res = await put(url, new Uint8Array(100), 5000);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("incompleto");
    expect(await readdir(MEDIA_DIR)).toEqual(antes);
    expect(geracoes).toHaveLength(0);
    expect((await put(url, new Uint8Array(100))).status).toBe(201);
    expect(geracoes[0].kind).toBe("image");
  });

  it("link vencido ou inventado é recusado", async () => {
    const { acesso } = await conectado();
    const url = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "voz.mp3" })).texto);
    await banco().update(conectorLinks).set({ expiraEm: new Date(Date.now() - 1000) });
    expect((await put(url, new Uint8Array(10))).status).toBe(404);
    expect((await put("https://hub.teste/api/conector/arquivos/hub_lk_inventado", new Uint8Array(10))).status).toBe(404);
  });

  it("tipo que a Biblioteca não mostra é recusado na hora de pedir o link", async () => {
    const { acesso } = await conectado();
    const res = await chamar(acesso, "link_de_envio", { nome_arquivo: "planilha.xlsx" });
    expect(res.isError).toBe(true);
    expect(res.texto).toContain("mp4");
    expect(await banco().select().from(conectorLinks)).toHaveLength(0);
  });

  it("tirar a chave da Biblioteca mata o link na hora", async () => {
    const { pessoa, acesso } = await conectado();
    const url = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "a.mp4" })).texto);
    await mudarPessoa(pessoa.id, { chaves: ["conector_claude"] });
    expect((await put(url, new Uint8Array(10))).status).toBe(403);
    expect(geracoes).toHaveLength(0);
  });

  it("download: devolve o arquivo como anexo e pode repetir dentro do prazo", async () => {
    const { acesso } = await conectado();
    // Regra do dono: vídeo que ainda não chegou ao Google Drive não aparece na Biblioteca.
    const doVideo = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "Corte bruto.mp4" })).texto);
    await put(doVideo, new Uint8Array([9, 9, 9]));
    expect(JSON.parse((await chamar(acesso, "biblioteca_listar", { busca: "corte" })).texto).itens).toEqual([]);

    const envio = urlDoComando((await chamar(acesso, "link_de_envio", { nome_arquivo: "Criativo Final.mp3" })).texto);
    const conteudo = new Uint8Array([1, 2, 3, 4, 5]);
    const { generation_id } = await (await put(envio, conteudo)).json();

    const lista = JSON.parse((await chamar(acesso, "biblioteca_listar", { busca: "criativo" })).texto);
    expect(lista.itens[0]).toMatchObject({ id: generation_id, nome: "Criativo Final", tipo: "audio", ferramenta: "upload", tamanho_bytes: 5 });

    const pedido = await chamar(acesso, "link_de_download", { generation_id });
    expect(pedido.isError).toBe(false);
    expect(pedido.texto).toContain('curl -fL -o "Criativo Final.mp3"');
    const url = urlDoComando(pedido.texto);
    for (let i = 0; i < 2; i++) {
      const res = await get(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain('filename="Criativo Final.mp3"');
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(conteudo);
    }
    // Link de download não serve para envio, e vice-versa.
    expect((await put(url, conteudo)).status).toBe(404);
    expect((await get(envio)).status).toBe(404);

    await banco().update(conectorLinks).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(conectorLinks.tipo, "download"));
    expect((await get(url)).status).toBe(404);
  });

  it("download de id que não existe é erro da ferramenta", async () => {
    const { acesso } = await conectado();
    const res = await chamar(acesso, "link_de_download", { generation_id: "nao-existe" });
    expect(res.isError).toBe(true);
    expect(res.texto).toContain("biblioteca_listar");
  });
});
