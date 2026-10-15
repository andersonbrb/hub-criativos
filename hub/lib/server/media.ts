import "server-only";

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Chave } from "@/features/acesso/contrato";
import type { MediaKind } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

export const MEDIA_DIR = path.join(DATA_DIR, "media");

// Telas de produção: todas mostram gerações e mídias (cards, players, "Visualizar", baixar). Quem tem qualquer uma
// delas vê as mídias e as gerações; quem só tem Memória, Conector ou a administração, não.
export const CHAVES_DE_PRODUCAO: Chave[] = ["biblioteca", "estudios", "editor", "fluxo", "chat", "criativo-automatico"];

export const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
};

export async function saveMedia(data: ArrayBuffer | Buffer, ext: string): Promise<string> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, file), Buffer.isBuffer(data) ? data : Buffer.from(data));
  return file;
}

// ---------- Envio de arquivo pelo navegador (FormData), direto para o disco ----------
// O request.formData() monta o arquivo inteiro na memória (e o arrayBuffer() fazia mais uma cópia): um vídeo de
// 1 GB ocupava 2 a 3 GB do servidor. Aqui o corpo multipart é lido em pedaços e cada pedaço do arquivo vai para o
// disco na hora. A tela continua mandando o mesmo FormData (campo "file").

class EnvioGrandeDemais extends Error {}
class EnvioIncompleto extends Error {}

const CRLF = Buffer.from("\r\n");
const FIM_DOS_CABECALHOS = Buffer.from("\r\n\r\n");
const TETO_DOS_CABECALHOS = 16 * 1024;

// Corpo do pedido lido aos poucos. "janela" é o que já chegou e ainda não foi consumido.
function leitorDoCorpo(corpo: ReadableStream<Uint8Array>, tetoBytes: number) {
  const leitor = corpo.getReader();
  let janela: Buffer = Buffer.alloc(0);
  let total = 0;
  let acabou = false;
  // Traz mais um pedaço; false quando o corpo acabou.
  async function ler(): Promise<boolean> {
    if (acabou) return false;
    const { done, value } = await leitor.read();
    if (done) {
      acabou = true;
      return false;
    }
    total += value.byteLength;
    if (total > tetoBytes) throw new EnvioGrandeDemais();
    const pedaco = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    janela = janela.length ? Buffer.concat([janela, pedaco]) : pedaco;
    return true;
  }
  return {
    janela: () => janela,
    consumir: (n: number) => {
      janela = janela.subarray(n);
    },
    ler,
    // Lê e joga fora o que sobrou do corpo. Cancelar a leitura no meio faria o Node derrubar a conexão, e a tela
    // ficaria sem a resposta (nem a mensagem de erro chegaria). O que sobra já é limitado pelo teto; passou dele, aí
    // sim corta.
    async descartarResto() {
      try {
        janela = Buffer.alloc(0);
        while (await ler()) janela = Buffer.alloc(0);
      } catch {
        await leitor.cancel().catch(() => undefined);
      }
    },
  };
}

type Leitor = ReturnType<typeof leitorDoCorpo>;

// Conteúdo de uma parte, até o separador seguinte (que é consumido). Guarda sempre o fim da janela, porque o
// separador pode chegar partido entre dois pedaços.
async function* conteudoDaParte(l: Leitor, separador: Buffer) {
  for (;;) {
    const i = l.janela().indexOf(separador);
    if (i >= 0) {
      if (i > 0) yield l.janela().subarray(0, i);
      l.consumir(i + separador.length);
      return;
    }
    const seguro = l.janela().length - (separador.length - 1);
    if (seguro > 0) {
      yield l.janela().subarray(0, seguro);
      l.consumir(seguro);
    }
    if (!(await l.ler())) throw new EnvioIncompleto();
  }
}

function cabecalhosDaParte(texto: string) {
  let campo: string | undefined;
  let nomeDoArquivo: string | undefined;
  let tipo = "";
  for (const linha of texto.split("\r\n")) {
    const doisPontos = linha.indexOf(":");
    if (doisPontos < 0) continue;
    const chave = linha.slice(0, doisPontos).trim().toLowerCase();
    const valor = linha.slice(doisPontos + 1).trim();
    if (chave === "content-disposition") {
      const parametro = (nome: string) => {
        const m = new RegExp(`(?:^|;)\\s*${nome}=(?:"([^"]*)"|([^;]*))`, "i").exec(valor);
        return m ? (m[1] ?? m[2].trim()) : undefined;
      };
      campo = parametro("name");
      nomeDoArquivo = parametro("filename");
    } else if (chave === "content-type") {
      tipo = valor.toLowerCase();
    }
  }
  return { campo, nomeDoArquivo, tipo };
}

const tipoDeMidia = (tipo: string): MediaKind | null =>
  tipo.startsWith("video/") ? "video" : tipo.startsWith("audio/") ? "audio" : tipo.startsWith("image/") ? "image" : null;

// Recebe o arquivo do campo `campo` de um FormData e grava em MEDIA_DIR. Só aceita vídeo, áudio ou imagem (pelo tipo
// que o navegador informa). Erros de quem enviou viram InputError (400) com a mensagem para a tela.
export async function saveUploadedMedia(request: Request, { campo = "file", tetoBytes }: { campo?: string; tetoBytes: number }) {
  const limite = `O arquivo pode ter até ${tetoBytes >= 1024 ** 3 ? `${tetoBytes / 1024 ** 3} GB` : `${Math.round(tetoBytes / 1024 ** 2)} MB`}.`;
  const contentType = request.headers.get("content-type") ?? "";
  const fronteira = /^multipart\/form-data\b/i.test(contentType) ? /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType) : null;
  if (!fronteira || !request.body) throw new InputError("Escolha um arquivo.");
  // O navegador manda o tamanho do corpo: recusa logo, antes de receber o arquivo.
  const declarado = Number(request.headers.get("content-length") ?? "") || 0;
  if (declarado > tetoBytes) throw new InputError(limite);

  const marca = Buffer.from(`--${fronteira[1] ?? fronteira[2]}`);
  const separador = Buffer.concat([CRLF, marca]);
  const l = leitorDoCorpo(request.body, tetoBytes);
  let parcial: string | null = null;
  try {
    // Primeira marca (o que vier antes dela é preâmbulo e é ignorado).
    for (;;) {
      const i = l.janela().indexOf(marca);
      if (i >= 0) {
        l.consumir(i + marca.length);
        break;
      }
      if (l.janela().length > marca.length) l.consumir(l.janela().length - marca.length);
      if (!(await l.ler())) throw new InputError("Escolha um arquivo.");
    }

    for (;;) {
      // Depois de cada marca: "--" fecha o formulário; quebra de linha abre mais uma parte.
      while (l.janela().length < 2) if (!(await l.ler())) throw new EnvioIncompleto();
      if (l.janela()[0] === 0x2d && l.janela()[1] === 0x2d) throw new InputError("Escolha um arquivo.");
      if (!l.janela().subarray(0, 2).equals(CRLF)) throw new InputError("O envio chegou com formato inválido. Tente de novo.");
      l.consumir(2);

      let fim: number;
      while ((fim = l.janela().indexOf(FIM_DOS_CABECALHOS)) < 0) {
        if (l.janela().length > TETO_DOS_CABECALHOS) throw new InputError("O envio chegou com formato inválido. Tente de novo.");
        if (!(await l.ler())) throw new EnvioIncompleto();
      }
      const parte = cabecalhosDaParte(l.janela().subarray(0, fim).toString("utf8"));
      l.consumir(fim + FIM_DOS_CABECALHOS.length);

      if (parte.campo !== campo || parte.nomeDoArquivo === undefined) {
        // Outro campo do formulário: descarta.
        for await (const pedaco of conteudoDaParte(l, separador)) void pedaco;
        continue;
      }

      // Campo de arquivo sem arquivo escolhido: o navegador manda filename="" e o conteúdo vazio.
      if (!parte.nomeDoArquivo) throw new InputError("Escolha um arquivo.");
      const kind = tipoDeMidia(parte.tipo);
      if (!kind) throw new InputError("Envie um vídeo, áudio ou imagem.");
      const ext = (parte.nomeDoArquivo.split(".").pop() ?? "").toLowerCase();
      const fallback = kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png";
      const file = `${randomUUID()}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback}`;
      await mkdir(MEDIA_DIR, { recursive: true });
      // Grava com outro nome e só renomeia no fim: um arquivo pela metade nunca é servido por /api/media.
      parcial = path.join(MEDIA_DIR, `${file}.parcial`);
      let tamanho = 0;
      const contar = async function* (pedacos: AsyncIterable<Buffer>) {
        for await (const pedaco of pedacos) {
          tamanho += pedaco.length;
          yield pedaco;
        }
      };
      await pipeline(Readable.from(contar(conteudoDaParte(l, separador))), createWriteStream(parcial));
      if (tamanho === 0) throw new InputError("Escolha um arquivo.");
      await rename(parcial, path.join(MEDIA_DIR, file));
      parcial = null;
      return { file, name: parte.nomeDoArquivo, kind, size: tamanho };
    }
  } catch (err) {
    if (parcial) await unlink(parcial).catch(() => undefined);
    if (err instanceof EnvioGrandeDemais) throw new InputError(limite);
    if (err instanceof EnvioIncompleto) throw new InputError("O arquivo chegou incompleto (a conexão caiu no meio do envio). Tente de novo.");
    throw err;
  } finally {
    await l.descartarResto();
  }
}

// Baixa o resultado de uma ferramenta para a pasta local (links das ferramentas costumam expirar).
export async function downloadMedia(url: string, fallbackExt: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não consegui baixar o arquivo gerado (${res.status}).`);
  const fromUrl = new URL(url).pathname.split(".").pop()?.toLowerCase();
  const ext = fromUrl && fromUrl in CONTENT_TYPES ? fromUrl : fallbackExt;
  return saveMedia(await res.arrayBuffer(), ext);
}
