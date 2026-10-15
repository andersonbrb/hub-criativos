import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PASTA_RAIZ, PASTAS } from "@/features/drive/contrato";
import {
  abrirTrecho,
  ajustes,
  baixarParaTemp,
  enviarArquivo,
  limparTemp,
  moverParaLixeira,
  PASTA_TEMP,
  renomear,
  situacao,
} from "@/features/drive/servicos/arquivos";
import { tokenDeAcesso } from "@/features/drive/servicos/conta";
import { esquecerPastas, pastaDoDrive } from "@/features/drive/servicos/pastas";
import { DATA_DIR } from "@/lib/server/store";

// A conta Google é de outro agente: aqui o token é sempre o que o teste mandar.
vi.mock("@/features/drive/servicos/conta", () => ({
  tokenDeAcesso: vi.fn(async () => "token-bom"),
  esquecerTokenDeAcesso: vi.fn(async () => undefined),
  DriveNaoConectado: class DriveNaoConectado extends Error {},
}));
// A pasta .data do teste é temporária (o store de verdade aponta para hub/.data).
vi.mock("@/lib/server/store", async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const caminho = await import("node:path");
  return { DATA_DIR: mkdtempSync(caminho.join(os.tmpdir(), "hub-drive-arquivos-")) };
});

const KiB = 1024;
const HORA = 60 * 60 * 1000;
const RAIZ_DO_DRIVE = "id-raiz-do-drive";
const MIME_PASTA = "application/vnd.google-apps.folder";

// ---------- Um Google Drive de mentira, só com o que o hub usa ----------

type ArquivoFalso = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  appProperties?: Record<string, string>;
  conteudo: Buffer;
};
type Sessao = { meta: Omit<ArquivoFalso, "id" | "trashed" | "conteudo">; total: number; partes: Buffer[]; tamanho: number; arquivo?: ArquivoFalso };
type PedidoFeito = { metodo: string; url: URL; headers: Headers; tamanhoDoCorpo: number };
// O que fazer com um pedaço que chegou: guardar tudo, guardar só o começo, responder 503, cair a rede antes de
// guardar ou guardar e cair a rede antes da resposta.
type Destino = "guardar" | "503" | "rede" | "guardar-e-cair" | { guardarSo: number };

const bytes = (b: Buffer) => new Uint8Array(b);
const erro = (status: number, message: string, reason = "erro") =>
  Response.json({ error: { code: status, message, errors: [{ reason }] } }, { status });
const desescapar = (texto: string | undefined) => texto?.replace(/\\(.)/g, "$1");

class DriveFalso {
  arquivos = new Map<string, ArquivoFalso>();
  sessoes = new Map<string, Sessao>();
  pedidos: PedidoFeito[] = [];
  tokenValido = "token-bom";
  recusados = 0;
  pedacos = 0;
  downloads = 0;
  cortarDownload = false;
  aoReceberPedaco: (n: number) => Destino = () => "guardar";
  atrasoMs = 0;
  simultaneos = 0;
  maxSimultaneos = 0;
  private sequencia = 0;

  criar(dados: Partial<ArquivoFalso> & { name: string }): ArquivoFalso {
    const arquivo: ArquivoFalso = {
      id: `arq${++this.sequencia}`,
      mimeType: "video/mp4",
      parents: [RAIZ_DO_DRIVE],
      trashed: false,
      conteudo: Buffer.alloc(0),
      ...dados,
    };
    this.arquivos.set(arquivo.id, arquivo);
    return arquivo;
  }

  pastas = () => [...this.arquivos.values()].filter((a) => a.mimeType === MIME_PASTA);
  pedidosDe = (metodo: string, caminho: string) => this.pedidos.filter((p) => p.metodo === metodo && p.url.pathname === caminho);

  atender = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const pedido = new Request(entrada, init);
    const url = new URL(pedido.url);
    const corpo = pedido.body ? Buffer.from(await pedido.arrayBuffer()) : Buffer.alloc(0);
    this.pedidos.push({ metodo: pedido.method, url, headers: pedido.headers, tamanhoDoCorpo: corpo.length });
    this.simultaneos++;
    this.maxSimultaneos = Math.max(this.maxSimultaneos, this.simultaneos);
    try {
      if (this.atrasoMs) await new Promise((ok) => setTimeout(ok, this.atrasoMs));
      if (pedido.headers.get("authorization") !== `Bearer ${this.tokenValido}`) {
        this.recusados++;
        return erro(401, "Invalid Credentials", "authError");
      }
      return await this.rotear(pedido.method, url, pedido.headers, corpo);
    } finally {
      this.simultaneos--;
    }
  };

  private async rotear(metodo: string, url: URL, headers: Headers, corpo: Buffer): Promise<Response> {
    const caminho = url.pathname;
    if (caminho === "/upload/drive/v3/files" && metodo === "POST") return this.abrirSessao(headers, corpo);
    if (caminho === "/upload/drive/v3/files" && metodo === "PUT") return this.receberPedaco(url, headers, corpo);
    if (caminho === "/drive/v3/files" && metodo === "GET") return this.listar(url);
    if (caminho === "/drive/v3/files" && metodo === "POST") {
      const dados = JSON.parse(corpo.toString()) as ArquivoFalso;
      const novo = this.criar({ ...dados, parents: dados.parents.map((p) => (p === "root" ? RAIZ_DO_DRIVE : p)) });
      return Response.json({ id: novo.id });
    }
    const id = caminho.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    const arquivo = id ? this.arquivos.get(decodeURIComponent(id)) : undefined;
    if (!arquivo) return erro(404, `File not found: ${id}.`, "notFound");
    if (metodo === "GET" && url.searchParams.get("alt") === "media") return this.conteudo(arquivo, headers);
    if (metodo === "GET") return Response.json(this.meta(arquivo));
    if (metodo === "PATCH") {
      const dados = JSON.parse(corpo.toString()) as { trashed?: boolean; name?: string };
      if (dados.trashed !== undefined) arquivo.trashed = dados.trashed;
      if (dados.name !== undefined) arquivo.name = dados.name;
      return Response.json({ id: arquivo.id });
    }
    return erro(400, "Rota desconhecida no Drive falso");
  }

  private meta(a: ArquivoFalso) {
    return {
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      size: String(a.conteudo.length),
      modifiedTime: "2026-10-15T12:00:00.000Z",
      trashed: a.trashed,
      parents: a.parents,
    };
  }

  private listar(url: URL) {
    const q = url.searchParams.get("q") ?? "";
    const nome = desescapar(q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]);
    const pai = desescapar(q.match(/'((?:[^'\\]|\\.)*)' in parents/)?.[1]);
    const paiReal = pai === "root" ? RAIZ_DO_DRIVE : pai;
    const achados = this.pastas().filter((a) => a.name === nome && !a.trashed && paiReal && a.parents.includes(paiReal));
    return Response.json({ files: achados.map((a) => ({ id: a.id })) });
  }

  private abrirSessao(headers: Headers, corpo: Buffer) {
    const id = `sessao${this.sessoes.size + 1}`;
    const meta = JSON.parse(corpo.toString()) as Sessao["meta"];
    this.sessoes.set(id, { meta, total: Number(headers.get("x-upload-content-length")), partes: [], tamanho: 0 });
    return new Response(null, { headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
  }

  private estadoDaSessao(s: Sessao): Response {
    if (s.tamanho === s.total) {
      s.arquivo ??= this.criar({ ...s.meta, conteudo: Buffer.concat(s.partes) });
      return Response.json(this.meta(s.arquivo));
    }
    return new Response(null, { status: 308, headers: s.tamanho > 0 ? { Range: `bytes=0-${s.tamanho - 1}` } : {} });
  }

  private receberPedaco(url: URL, headers: Headers, corpo: Buffer): Response {
    const s = this.sessoes.get(url.searchParams.get("upload_id") ?? "");
    if (!s) return erro(404, "Sessão não existe");
    const faixa = headers.get("content-range") ?? "";
    if (/^bytes \*\/\d+$/.test(faixa)) return this.estadoDaSessao(s);
    const m = faixa.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!m) return erro(400, `Content-Range inválido: ${faixa}`);
    const inicio = Number(m[1]);
    const fim = Number(m[2]) + 1;
    // As regras do Google: o pedaço bate com o Content-Range, não deixa buraco e é múltiplo de 256 KiB (menos o último).
    if (fim - inicio !== corpo.length) return erro(400, "Content-Range não bate com o corpo");
    if (inicio > s.tamanho) return erro(400, "Pedaço deixaria um buraco");
    if ((fim - inicio) % (256 * KiB) !== 0 && fim !== s.total) return erro(400, "Pedaço fora do múltiplo de 256 KiB");
    const destino = this.aoReceberPedaco(++this.pedacos);
    if (destino === "rede") throw new TypeError("fetch failed");
    if (destino === "503") return erro(503, "Backend Error", "backendError");
    const guardar = typeof destino === "object" ? destino.guardarSo : corpo.length;
    const novos = corpo.subarray(s.tamanho - inicio, guardar);
    s.partes.push(Buffer.from(novos));
    s.tamanho += novos.length;
    if (destino === "guardar-e-cair") throw new TypeError("fetch failed");
    return this.estadoDaSessao(s);
  }

  private conteudo(a: ArquivoFalso, headers: Headers): Response {
    this.downloads++;
    const total = a.conteudo.length;
    const range = headers.get("range");
    if (!range) {
      const corpo = this.cortarDownload ? a.conteudo.subarray(0, total / 2) : a.conteudo;
      return new Response(bytes(corpo), { headers: { "Content-Type": a.mimeType, "Content-Length": String(total) } });
    }
    const m = range.match(/^bytes=(\d+)-(\d*)$/);
    if (!m) return erro(400, "Range não suportado no Drive falso");
    const inicio = Number(m[1]);
    if (inicio >= total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    const fim = Math.min(m[2] ? Number(m[2]) : total - 1, total - 1);
    return new Response(bytes(a.conteudo.subarray(inicio, fim + 1)), {
      status: 206,
      headers: { "Content-Type": a.mimeType, "Content-Length": String(fim - inicio + 1), "Content-Range": `bytes ${inicio}-${fim}/${total}` },
    });
  }
}

// ---------- Preparação ----------

let drive: DriveFalso;
const PASTA_LOCAL = path.join(DATA_DIR, "locais");

async function arquivoLocal(tamanho: number) {
  await mkdir(PASTA_LOCAL, { recursive: true });
  const conteudo = randomBytes(tamanho);
  const caminho = path.join(PASTA_LOCAL, `${randomBytes(4).toString("hex")}.mp4`);
  await writeFile(caminho, conteudo);
  return { caminho, conteudo };
}

const corpoDe = async (corpo: ReadableStream<Uint8Array> | null) => Buffer.from(await new Response(corpo).arrayBuffer());

beforeEach(async () => {
  drive = new DriveFalso();
  vi.stubGlobal("fetch", vi.fn(drive.atender));
  vi.mocked(tokenDeAcesso).mockReset().mockResolvedValue("token-bom");
  esquecerPastas();
  ajustes.esperaInicialMs = 1;
  await rm(PASTA_TEMP, { recursive: true, force: true });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(DATA_DIR, { recursive: true, force: true });
});

// ---------- Testes ----------

describe("drive: pastas do hub", () => {
  it("cria a pasta raiz e a subpasta quando não existem, marcadas como do hub", async () => {
    const id = await pastaDoDrive("batida");

    const [raiz, sub] = drive.pastas();
    expect(raiz).toMatchObject({ name: PASTA_RAIZ, parents: [RAIZ_DO_DRIVE], appProperties: { hub: "pasta", chave: "raiz" } });
    expect(sub).toMatchObject({ id, name: PASTAS.batida, parents: [raiz.id], appProperties: { hub: "pasta", chave: "batida" } });
  });

  it("usa as pastas que já existem no Drive em vez de criar outras", async () => {
    const raiz = drive.criar({ name: PASTA_RAIZ, mimeType: MIME_PASTA });
    const sub = drive.criar({ name: PASTAS.editor, mimeType: MIME_PASTA, parents: [raiz.id] });

    expect(await pastaDoDrive("editor")).toBe(sub.id);
    expect(drive.pedidosDe("POST", "/drive/v3/files")).toHaveLength(0);
  });

  it("chamadas ao mesmo tempo não criam pastas duplicadas", async () => {
    drive.atrasoMs = 5;
    const ids = await Promise.all([
      pastaDoDrive("batida"),
      pastaDoDrive("batida"),
      pastaDoDrive("editor"),
      pastaDoDrive("batida"),
      pastaDoDrive("editor"),
    ]);

    expect(drive.pastas()).toHaveLength(3); // raiz, batida e editor
    expect(new Set([ids[0], ids[1], ids[3]]).size).toBe(1);
    expect(ids[2]).toBe(ids[4]);
  });

  it("recria a pasta que foi para a lixeira ou foi apagada", async () => {
    const primeira = await pastaDoDrive("broll");
    drive.arquivos.get(primeira)!.trashed = true;
    const segunda = await pastaDoDrive("broll");
    expect(segunda).not.toBe(primeira);

    // Raiz apagada de vez: as duas voltam, e a subpasta nova fica dentro da raiz nova.
    const raizAntiga = drive.arquivos.get(segunda)!.parents[0];
    drive.arquivos.delete(raizAntiga);
    const terceira = await pastaDoDrive("broll");
    const raizNova = drive.arquivos.get(terceira)!.parents[0];
    expect(raizNova).not.toBe(raizAntiga);
    expect(drive.arquivos.get(raizNova)).toMatchObject({ name: PASTA_RAIZ, trashed: false });
  });
});

describe("drive: enviarArquivo", () => {
  const PEDACO = 256 * KiB;

  it("manda em vários pedaços pequenos, sem ler o arquivo inteiro de uma vez", async () => {
    const { caminho, conteudo } = await arquivoLocal(3 * 1024 * KiB + 1000);

    const arquivo = await enviarArquivo(caminho, { nome: "corte final.mp4", pasta: "edicao-final", mimeType: "video/mp4", tamanhoDoPedaco: PEDACO });

    const puts = drive.pedidosDe("PUT", "/upload/drive/v3/files");
    expect(puts).toHaveLength(13); // 12 pedaços cheios + o resto
    expect(Math.max(...puts.map((p) => p.tamanhoDoCorpo))).toBeLessThanOrEqual(PEDACO);
    const noDrive = drive.arquivos.get(arquivo.id)!;
    expect(noDrive.conteudo.equals(conteudo)).toBe(true);
    expect(noDrive).toMatchObject({ name: "corte final.mp4", mimeType: "video/mp4", appProperties: { hub: "1" } });
    expect(noDrive.parents).toEqual([await pastaDoDrive("edicao-final")]);
    expect(arquivo).toMatchObject({ nome: "corte final.mp4", tamanho: conteudo.length, noLixo: false });
    const abertura = drive.pedidosDe("POST", "/upload/drive/v3/files")[0];
    expect(abertura.headers.get("x-upload-content-length")).toBe(String(conteudo.length));
    expect(abertura.url.searchParams.get("fields")).toBe("id,name,mimeType,size,modifiedTime,trashed");
  });

  it("continua de onde o Google parou depois de um 308 parcial", async () => {
    const { caminho, conteudo } = await arquivoLocal(4 * PEDACO);
    drive.aoReceberPedaco = (n) => (n === 2 ? { guardarSo: 100 * KiB } : "guardar");

    const arquivo = await enviarArquivo(caminho, { nome: "a.mp4", pasta: "batida", mimeType: "video/mp4", tamanhoDoPedaco: PEDACO });

    expect(drive.arquivos.get(arquivo.id)!.conteudo.equals(conteudo)).toBe(true);
    const faixas = drive.pedidosDe("PUT", "/upload/drive/v3/files").map((p) => p.headers.get("content-range"));
    expect(faixas[2]).toBe(`bytes ${PEDACO + 100 * KiB}-${2 * PEDACO + 100 * KiB - 1}/${4 * PEDACO}`);
  });

  it("tenta de novo depois de um 503 e de quedas de rede, sem mandar tudo de novo", async () => {
    const { caminho, conteudo } = await arquivoLocal(5 * PEDACO + 10);
    // 2: Google instável; 4: chegou mas a resposta se perdeu; 5: a rede caiu antes de chegar.
    drive.aoReceberPedaco = (n) => (n === 2 ? "503" : n === 4 ? "guardar-e-cair" : n === 5 ? "rede" : "guardar");

    const arquivo = await enviarArquivo(caminho, { nome: "b.mp4", pasta: "broll", mimeType: "video/mp4", tamanhoDoPedaco: PEDACO });

    expect(drive.arquivos.get(arquivo.id)!.conteudo.equals(conteudo)).toBe(true);
    const faixas = drive.pedidosDe("PUT", "/upload/drive/v3/files").map((p) => p.headers.get("content-range"));
    // Depois de cada falha, pergunta até onde chegou.
    expect(faixas.filter((f) => f?.startsWith("bytes */"))).toHaveLength(3);
    // O pedaço que chegou antes da queda (o 3º, a partir de 2 × PEDACO) não foi mandado de novo.
    expect(faixas.filter((f) => f?.startsWith(`bytes ${2 * PEDACO}-`))).toHaveLength(1);
  });

  it("desiste depois de 5 tentativas no mesmo pedaço, com mensagem legível", async () => {
    const { caminho } = await arquivoLocal(PEDACO);
    drive.aoReceberPedaco = () => "503";

    await expect(enviarArquivo(caminho, { nome: "c.mp4", pasta: "outros", mimeType: "video/mp4", tamanhoDoPedaco: PEDACO })).rejects.toThrow(
      "O envio para o Google Drive falhou várias vezes seguidas",
    );
    expect(drive.pedacos).toBe(6); // a primeira + 5 tentativas
  });

  it("pede o token de novo quando ele vence no meio do envio", async () => {
    const { caminho, conteudo } = await arquivoLocal(3 * PEDACO);
    drive.aoReceberPedaco = (n) => {
      if (n === 1) {
        // O Google invalida o token; o próximo pedido ainda sai com o antigo, o seguinte já com o novo.
        drive.tokenValido = "token-novo";
        vi.mocked(tokenDeAcesso).mockResolvedValueOnce("token-bom").mockResolvedValue("token-novo");
      }
      return "guardar";
    };

    const arquivo = await enviarArquivo(caminho, { nome: "d.mp4", pasta: "avatar", mimeType: "video/mp4", tamanhoDoPedaco: PEDACO });

    expect(drive.recusados).toBe(1);
    expect(drive.arquivos.get(arquivo.id)!.conteudo.equals(conteudo)).toBe(true);
  });
});

describe("drive: abrirTrecho", () => {
  const preparar = () => drive.criar({ name: "v.mp4", conteudo: randomBytes(1000) });

  it("repassa o Range ao Google e devolve 206 com os cabeçalhos do player", async () => {
    const video = preparar();

    const trecho = await abrirTrecho(video.id, "bytes=100-199");

    expect(drive.pedidos.at(-1)!.headers.get("range")).toBe("bytes=100-199");
    expect(trecho.status).toBe(206);
    expect(trecho.cabecalhos).toEqual({
      "Content-Type": "video/mp4",
      "Content-Length": "100",
      "Content-Range": "bytes 100-199/1000",
      "Accept-Ranges": "bytes",
    });
    expect((await corpoDe(trecho.corpo)).equals(video.conteudo.subarray(100, 200))).toBe(true);
  });

  it("sem Range devolve o arquivo inteiro", async () => {
    const video = preparar();

    const trecho = await abrirTrecho(video.id, null);

    expect(trecho.status).toBe(200);
    expect(trecho.cabecalhos["Content-Length"]).toBe("1000");
    expect((await corpoDe(trecho.corpo)).equals(video.conteudo)).toBe(true);
  });

  it("416 quando a faixa passa do fim do arquivo", async () => {
    const video = preparar();

    const trecho = await abrirTrecho(video.id, "bytes=5000-");

    expect(trecho).toMatchObject({ status: 416, corpo: null, cabecalhos: { "Content-Range": "bytes */1000", "Accept-Ranges": "bytes" } });
  });

  it("vídeo apagado do Drive vira mensagem legível", async () => {
    await expect(abrirTrecho("sumiu", "bytes=0-")).rejects.toThrow("Esse vídeo não está mais no Drive.");
  });
});

describe("drive: baixarParaTemp", () => {
  it("baixa uma vez só, mesmo com dois pedidos ao mesmo tempo, e reaproveita a cópia", async () => {
    const video = drive.criar({ name: "v.mp4", conteudo: randomBytes(300 * KiB) });
    drive.atrasoMs = 10;

    const [a, b] = await Promise.all([baixarParaTemp(video.id, "mp4"), baixarParaTemp(video.id, ".mp4")]);
    const c = await baixarParaTemp(video.id, "mp4");

    expect(a).toBe(path.join(PASTA_TEMP, `${video.id}.mp4`));
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(drive.downloads).toBe(1);
    expect((await readFile(a)).equals(video.conteudo)).toBe(true);
    expect(await readdir(PASTA_TEMP)).toEqual([`${video.id}.mp4`]);
  });

  it("download incompleto não vira cópia (nem sobra o .parcial)", async () => {
    const video = drive.criar({ name: "v.mp4", conteudo: randomBytes(100 * KiB) });
    drive.cortarDownload = true;

    await expect(baixarParaTemp(video.id, "mp4")).rejects.toThrow("veio incompleto");
    expect(await readdir(PASTA_TEMP)).toEqual([]);
  });

  it("cópia com tamanho diferente do esperado é baixada de novo", async () => {
    const video = drive.criar({ name: "v.mp4", conteudo: randomBytes(100 * KiB) });
    const caminho = await baixarParaTemp(video.id, "mp4");
    await writeFile(caminho, "estragado");

    await baixarParaTemp(video.id, "mp4");

    expect(drive.downloads).toBe(2);
    expect((await readFile(caminho)).equals(video.conteudo)).toBe(true);
  });

  it("recusa id que viraria outro caminho no disco", async () => {
    await expect(baixarParaTemp("../../db", "json")).rejects.toThrow("inválido");
    expect(drive.pedidos).toHaveLength(0);
  });
});

describe("drive: limpeza da pasta temporária", () => {
  async function copia(nome: string, horasSemUso: number, tamanho = 1000) {
    await mkdir(PASTA_TEMP, { recursive: true });
    const caminho = path.join(PASTA_TEMP, nome);
    await writeFile(caminho, Buffer.alloc(tamanho));
    const quando = new Date(Date.now() - horasSemUso * HORA);
    await utimes(caminho, quando, quando);
  }

  it("apaga o que está sem uso há mais de 6 horas", async () => {
    await copia("velho.mp4", 7);
    await copia("velho.mp4.parcial", 8);
    await copia("recente.mp4", 1);

    await limparTemp();

    expect(await readdir(PASTA_TEMP)).toEqual(["recente.mp4"]);
  });

  it("mantém o total abaixo do limite apagando os mais antigos primeiro, sem tocar no que acabou de ser usado", async () => {
    await copia("a.mp4", 5);
    await copia("b.mp4", 4);
    await copia("c.mp4", 3);
    await copia("d.mp4", 0);

    await limparTemp({ tamanhoMaximo: 2500 });
    expect((await readdir(PASTA_TEMP)).sort()).toEqual(["c.mp4", "d.mp4"]);

    // Limite zero: mesmo assim o usado há menos de 1 hora fica (pode estar aberto no ffmpeg).
    await limparTemp({ tamanhoMaximo: 0 });
    expect(await readdir(PASTA_TEMP)).toEqual(["d.mp4"]);
  });

  it("usar a cópia renova o prazo dela", async () => {
    const video = drive.criar({ name: "v.mp4", conteudo: randomBytes(10 * KiB) });
    const caminho = await baixarParaTemp(video.id, "mp4");
    const quando = new Date(Date.now() - 7 * HORA);
    await utimes(caminho, quando, quando);

    await baixarParaTemp(video.id, "mp4"); // usou de novo
    await limparTemp();

    expect(await readdir(PASTA_TEMP)).toEqual([`${video.id}.mp4`]);
    expect(drive.downloads).toBe(1);
  });
});

describe("drive: lixeira e nome", () => {
  it("manda para a lixeira; arquivo já apagado de vez não é erro", async () => {
    const video = drive.criar({ name: "v.mp4" });

    await moverParaLixeira(video.id);
    await moverParaLixeira("ja-sumiu");

    expect(video.trashed).toBe(true);
  });

  it("renomeia", async () => {
    const video = drive.criar({ name: "v.mp4" });

    await renomear(video.id, "  Criativo 12 - batida.mp4 ");

    expect(video.name).toBe("Criativo 12 - batida.mp4");
    await expect(renomear("ja-sumiu", "x")).rejects.toThrow("não está mais no Drive");
  });
});

describe("drive: situacao (espelho)", () => {
  it("omite os apagados de vez, mostra os da lixeira e confere no máximo 8 ao mesmo tempo", async () => {
    const videos = Array.from({ length: 20 }, (_, i) => drive.criar({ name: `v${i}.mp4`, conteudo: Buffer.alloc(i) }));
    videos[3].trashed = true;
    drive.atrasoMs = 5;

    const lista = await situacao(["sumiu-1", ...videos.map((v) => v.id), "sumiu-2", videos[0].id]);

    expect(lista.map((a) => a.id)).toEqual(videos.map((v) => v.id));
    expect(lista[3]).toMatchObject({ nome: "v3.mp4", noLixo: true, tamanho: 3, mimeType: "video/mp4" });
    expect(drive.maxSimultaneos).toBeLessThanOrEqual(8);
    expect(drive.maxSimultaneos).toBeGreaterThan(1);
  });

  it("login recusado lança erro (e não devolve lista vazia, que marcaria tudo como apagado)", async () => {
    const video = drive.criar({ name: "v.mp4" });
    drive.tokenValido = "outro";

    const falha = situacao([video.id]);

    await expect(falha).rejects.toThrow("conectar de novo");
    await expect(falha).rejects.not.toThrow("token-bom");
    expect(tokenDeAcesso).toHaveBeenCalledTimes(2); // pediu o token de novo uma vez
  });

  it("lista vazia não chama o Google", async () => {
    expect(await situacao([])).toEqual([]);
    expect(drive.pedidos).toHaveLength(0);
  });
});
