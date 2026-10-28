import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import {
  ID_VALIDO,
  NOME_VALIDO,
  TETO_DO_TRABALHO,
  TIPOS_DE_TRABALHO,
  type Situacao,
  type SituacaoDoTrabalho,
  type Trabalho,
} from "@/features/edicoes/contrato";
import { executarTrabalho, linhaComHora, type Caminhos } from "@/features/edicoes/servicos/executar";

// O servidor de edições (contrato.ts): recebe os arquivos de cada trabalho, roda a edição e guarda o resultado até o
// site buscar. Não guarda nada do hub: se reiniciar, os trabalhos em andamento se perdem e o site manda de novo.
// Sobe por scripts/servidor-de-edicoes.ts (no Railway, o serviço "Hub Edições" com HUB_SERVIDOR=edicoes).

type Estado = {
  trabalho: Trabalho;
  situacao: Exclude<Situacao, "desconhecido">;
  log: string;
  erro?: string;
  resultado?: string;
  bytesDaSaida?: number;
  terminouEm?: number;
  apagarAoTerminar?: boolean;
};

export type OpcoesDoServidor = {
  chave: string;
  // Onde ficam as pastas dos trabalhos (uma por id).
  pasta: string;
  // Edições ao mesmo tempo (as outras esperam na fila). A transcrição tem fila própria, uma por vez.
  simultaneas?: number;
  // Só para testes: troca quem roda o trabalho.
  executar?: typeof executarTrabalho;
};

// Registro de um trabalho: o bastante para qualquer edição (o do Python tem alguns KB); passou disso, para de crescer.
const TETO_DO_REGISTRO = 4 * 1024 * 1024;
// Trabalho terminado que o site não veio buscar (ele apaga ao terminar): sai depois disto.
const ESQUECER_DEPOIS_MS = 6 * 60 * 60_000;

export function criarServidorDeEdicoes(opts: OpcoesDoServidor) {
  const executar = opts.executar ?? executarTrabalho;
  const simultaneas = Math.max(1, opts.simultaneas ?? 2);
  const estados = new Map<string, Estado>();
  const filas = { edicao: [] as string[], transcricao: [] as string[] };
  const rodando = { edicao: 0, transcricao: 0 };
  const chave = Buffer.from(opts.chave);

  const pastaDo = (id: string) => path.join(opts.pasta, id);
  const caminhosDo = (id: string): Caminhos => ({
    entrada: (nome) => path.join(pastaDo(id), "entradas", nome),
    saida: path.join(pastaDo(id), "saida.mp4"),
    pasta: (nome) => path.join(pastaDo(id), nome),
  });
  const filaDo = (t: Trabalho) => (t.tipo === "transcricao" ? "transcricao" : "edicao");
  const limiteDa = (fila: keyof typeof filas) => (fila === "transcricao" ? 1 : simultaneas);

  const apagarPasta = (id: string) => rm(pastaDo(id), { recursive: true, force: true }).catch(() => undefined);

  function anotar(estado: Estado, texto: string) {
    if (estado.log.length >= TETO_DO_REGISTRO) return;
    estado.log += texto;
    if (estado.log.length >= TETO_DO_REGISTRO) estado.log += "\n[registro cortado: ficou grande demais]\n";
  }

  function proximo(fila: keyof typeof filas) {
    while (rodando[fila] < limiteDa(fila) && filas[fila].length) {
      const id = filas[fila].shift()!;
      const estado = estados.get(id);
      if (!estado || estado.situacao !== "na-fila") continue;
      rodando[fila]++;
      void rodar(id, estado).finally(() => {
        rodando[fila]--;
        proximo(fila);
      });
    }
  }

  async function rodar(id: string, estado: Estado) {
    estado.situacao = "rodando";
    const caminhos = caminhosDo(id);
    try {
      const { resultado } = await executar(estado.trabalho, caminhos, {
        bruto: (texto) => anotar(estado, texto),
        linha: (m) => anotar(estado, linhaComHora(m)),
      });
      estado.resultado = resultado;
      if (estado.trabalho.tipo !== "transcricao") estado.bytesDaSaida = (await stat(caminhos.saida)).size;
      estado.situacao = "pronto";
    } catch (err) {
      estado.erro = (err instanceof Error ? err.message : String(err)).slice(0, 1000) || "erro";
      estado.situacao = "falhou";
      console.warn(`[edicoes] ${id} (${estado.trabalho.tipo}) falhou: ${estado.erro}`);
    } finally {
      estado.terminouEm = Date.now();
      // As entradas já não servem (o resultado fica até o site buscar).
      await rm(path.join(pastaDo(id), "entradas"), { recursive: true, force: true }).catch(() => undefined);
      if (estado.apagarAoTerminar) {
        estados.delete(id);
        await apagarPasta(id);
      }
    }
  }

  const resposta = (estado: Estado | undefined, desde: number): SituacaoDoTrabalho => {
    if (!estado) return { situacao: "desconhecido", log: "", fimDoLog: 0 };
    return {
      situacao: estado.situacao,
      log: estado.log.slice(Math.min(desde, estado.log.length)),
      fimDoLog: estado.log.length,
      ...(estado.erro ? { erro: estado.erro } : {}),
      ...(estado.resultado !== undefined ? { resultado: estado.resultado } : {}),
      ...(estado.bytesDaSaida !== undefined ? { bytesDaSaida: estado.bytesDaSaida } : {}),
    };
  };

  const autorizado = (req: http.IncomingMessage) => {
    const recebida = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    return recebida.length === chave.length && timingSafeEqual(recebida, chave);
  };

  async function lerCorpo(req: http.IncomingMessage): Promise<string> {
    let tamanho = 0;
    const partes: Buffer[] = [];
    for await (const parte of req) {
      tamanho += (parte as Buffer).length;
      if (tamanho > TETO_DO_TRABALHO) throw new ErroDoPedido(413, "trabalho grande demais");
      partes.push(parte as Buffer);
    }
    return Buffer.concat(partes).toString("utf8");
  }

  async function receberEntrada(req: http.IncomingMessage, id: string, nome: string) {
    const estado = estados.get(id);
    if (estado && (estado.situacao === "na-fila" || estado.situacao === "rodando")) throw new ErroDoPedido(409, "o trabalho já começou");
    const destino = caminhosDo(id).entrada(nome);
    await mkdir(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.parcial`;
    try {
      await pipeline(req, createWriteStream(parcial));
      await rename(parcial, destino);
    } catch (err) {
      await rm(parcial, { force: true }).catch(() => undefined);
      throw err;
    }
    return { bytes: (await stat(destino)).size };
  }

  async function comecar(req: http.IncomingMessage, id: string): Promise<SituacaoDoTrabalho> {
    const existente = estados.get(id);
    // Mandado de novo (o site reiniciou ou não viu a resposta): não roda duas vezes.
    if (existente) return resposta(existente, 0);
    let trabalho: Trabalho;
    try {
      trabalho = JSON.parse(await lerCorpo(req)) as Trabalho;
    } catch (err) {
      if (err instanceof ErroDoPedido) throw err;
      throw new ErroDoPedido(400, "o trabalho não é um JSON válido");
    }
    if (!trabalho || !TIPOS_DE_TRABALHO.includes(trabalho.tipo) || typeof trabalho.dados !== "object" || !trabalho.dados) {
      throw new ErroDoPedido(400, "trabalho inválido");
    }
    const entradas = Array.isArray(trabalho.entradas) ? trabalho.entradas.map(String) : [];
    for (const nome of entradas) {
      if (!NOME_VALIDO.test(nome)) throw new ErroDoPedido(400, `nome de entrada inválido: ${nome.slice(0, 40)}`);
      const ok = await access(caminhosDo(id).entrada(nome)).then(() => true, () => false);
      if (!ok) throw new ErroDoPedido(400, `falta a entrada ${nome}`);
    }
    const estado: Estado = { trabalho: { tipo: trabalho.tipo, dados: trabalho.dados, entradas }, situacao: "na-fila", log: "" };
    estados.set(id, estado);
    const fila = filaDo(estado.trabalho);
    filas[fila].push(id);
    proximo(fila);
    return resposta(estado, 0);
  }

  async function entregarSaida(res: http.ServerResponse, id: string) {
    const estado = estados.get(id);
    const saida = caminhosDo(id).saida;
    const info = estado?.situacao === "pronto" ? await stat(saida).catch(() => null) : null;
    if (!info) throw new ErroDoPedido(404, "sem vídeo pronto para este trabalho");
    res.writeHead(200, { "content-type": "video/mp4", "content-length": String(info.size) });
    await pipeline(createReadStream(saida), res);
  }

  async function apagar(id: string) {
    const estado = estados.get(id);
    if (estado?.situacao === "rodando") {
      estado.apagarAoTerminar = true;
      return;
    }
    estados.delete(id);
    await apagarPasta(id);
  }

  async function atender(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://servidor");
    const json = (status: number, corpo: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(corpo));
    };
    // Checagem de saúde do Railway: aberta, sem nenhum dado.
    if (url.pathname === "/api/saude") {
      return json(200, { ok: true, rodando: rodando.edicao + rodando.transcricao, naFila: filas.edicao.length + filas.transcricao.length });
    }
    if (!autorizado(req)) return json(401, { error: "chave do servidor de edições inválida" });
    const m = /^\/trabalhos\/([^/]+)(?:\/(entradas)\/([^/]+)|\/(saida))?$/.exec(url.pathname);
    const id = m ? decodeURIComponent(m[1]) : "";
    if (!m || !ID_VALIDO.test(id)) return json(404, { error: "caminho desconhecido" });
    try {
      if (m[2] === "entradas") {
        const nome = decodeURIComponent(m[3]);
        if (!NOME_VALIDO.test(nome)) throw new ErroDoPedido(400, "nome de entrada inválido");
        if (req.method !== "PUT") throw new ErroDoPedido(405, "use PUT");
        return json(200, await receberEntrada(req, id, nome));
      }
      if (m[4] === "saida") {
        if (req.method !== "GET") throw new ErroDoPedido(405, "use GET");
        return await entregarSaida(res, id);
      }
      if (req.method === "POST") return json(200, await comecar(req, id));
      if (req.method === "DELETE") {
        await apagar(id);
        return json(200, { ok: true });
      }
      if (req.method !== "GET") throw new ErroDoPedido(405, "método não aceito");
      const estado = estados.get(id);
      const desde = Math.max(0, Number(url.searchParams.get("desde")) || 0);
      return json(estado ? 200 : 404, resposta(estado, desde));
    } catch (err) {
      const status = err instanceof ErroDoPedido ? err.status : 500;
      if (!(err instanceof ErroDoPedido)) console.error(`[edicoes] ${req.method} ${url.pathname}:`, err instanceof Error ? err.message : err);
      if (res.headersSent) return res.destroy();
      return json(status, { error: err instanceof Error ? err.message.slice(0, 300) : "erro" });
    }
  }

  // Trabalhos terminados que ninguém buscou, e pastas que não são de trabalho nenhum, saem depois de umas horas.
  async function faxina(agora = Date.now()) {
    for (const [id, estado] of estados) {
      if (estado.terminouEm && agora - estado.terminouEm > ESQUECER_DEPOIS_MS) {
        estados.delete(id);
        await apagarPasta(id);
      }
    }
    for (const nome of await readdir(opts.pasta).catch(() => [] as string[])) {
      if (estados.has(nome)) continue;
      const info = await stat(path.join(opts.pasta, nome)).catch(() => null);
      if (info && agora - info.mtimeMs > ESQUECER_DEPOIS_MS) await apagarPasta(nome);
    }
  }

  const servidor = http.createServer((req, res) => {
    void atender(req, res).catch((err) => {
      console.error("[edicoes] pedido falhou:", err instanceof Error ? err.message : err);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });
  // Um vídeo grande demora para subir ou descer: sem o limite padrão de 5 min por pedido.
  servidor.requestTimeout = 0;
  return { servidor, faxina, estados };
}

class ErroDoPedido extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
