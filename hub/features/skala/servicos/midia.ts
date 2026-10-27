import "server-only";

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as ReadableStreamDoNode } from "node:stream/web";

import { TETO_DA_IMAGEM, TETO_DO_VIDEO, dominioDaMidiaAceito } from "@/features/skala/contrato";
import { pastaDeMidia } from "@/lib/server/pastas";

// Baixa o vídeo ou a imagem de um criativo do Skala para a pasta de mídia da organização.
// As travas: só https; só do Skala e dos CDNs dele (inclusive em cada redirecionamento, no máximo 3); teto de
// tamanho conferido no cabeçalho e de novo durante a leitura; e o tipo conferido pelos primeiros bytes do arquivo,
// não pelo que o servidor diz (CDN às vezes responde "application/octet-stream").

export class MidiaIndisponivel extends Error {}

export type MidiaBaixada = { arquivo: string; caminho: string; tipo: "video" | "image"; ext: string; contentType: string; bytes: number };

const MAXIMO_DE_REDIRECIONAMENTOS = 3;
const ESPERA_MAXIMA_MS = 3 * 60_000;

// Tipo pelos primeiros bytes. null = nem vídeo nem imagem que o hub saiba mostrar.
export function tipoPelosBytes(b: Buffer): { tipo: "video" | "image"; ext: string; contentType: string } | null {
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") {
    const marca = b.toString("latin1", 8, 12);
    return marca === "qt  " ? { tipo: "video", ext: "mov", contentType: "video/quicktime" } : { tipo: "video", ext: "mp4", contentType: "video/mp4" };
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { tipo: "video", ext: "webm", contentType: "video/webm" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { tipo: "image", ext: "jpg", contentType: "image/jpeg" };
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return { tipo: "image", ext: "png", contentType: "image/png" };
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { tipo: "image", ext: "webp", contentType: "image/webp" };
  if (b.length >= 6 && b.toString("latin1", 0, 4) === "GIF8") return { tipo: "image", ext: "gif", contentType: "image/gif" };
  return null;
}

function conferirEndereco(bruto: string): URL {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new MidiaIndisponivel("o endereço do arquivo não é válido");
  }
  // CDN costuma mandar http://; o mesmo endereço responde em https.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new MidiaIndisponivel("o endereço do arquivo não é https");
  if (url.username || url.password || (url.port && url.port !== "443")) throw new MidiaIndisponivel("o endereço do arquivo não é aceito");
  if (!dominioDaMidiaAceito(url.hostname)) throw new MidiaIndisponivel(`o arquivo veio de um endereço que o hub não aceita (${url.hostname})`);
  return url;
}

async function abrir(bruto: string, sinal: AbortSignal): Promise<Response> {
  let url = conferirEndereco(bruto);
  for (let i = 0; ; i++) {
    const res = await fetch(url, { redirect: "manual", signal: sinal, headers: { "User-Agent": "HubDeCriativos/1.0" } }).catch((err) => {
      console.error("[skala] download:", err instanceof Error ? err.message : err);
      throw new MidiaIndisponivel(sinal.aborted ? "o download demorou demais" : "o CDN não respondeu");
    });
    const destino = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destino) {
      await res.body?.cancel().catch(() => undefined);
      if (i >= MAXIMO_DE_REDIRECIONAMENTOS) throw new MidiaIndisponivel("o CDN redirecionou vezes demais");
      url = conferirEndereco(new URL(destino, url).toString());
      continue;
    }
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => undefined);
      throw new MidiaIndisponivel("o link do arquivo no CDN venceu ou não existe mais");
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new MidiaIndisponivel(`o CDN respondeu ${res.status}`);
    }
    return res;
  }
}

class GrandeDemais extends Error {}

// esperado: o que o Skala disse que é (video_url → vídeo; imagem_url e capa_url → imagem).
export async function baixarMidia(url: string, esperado: "video" | "image"): Promise<MidiaBaixada> {
  const teto = esperado === "video" ? TETO_DO_VIDEO : TETO_DA_IMAGEM;
  const limite = `${Math.round(teto / 1024 / 1024)} MB`;
  const sinal = AbortSignal.timeout(ESPERA_MAXIMA_MS);
  const res = await abrir(url, sinal);
  const declarado = Number(res.headers.get("content-length") ?? "") || 0;
  if (declarado > teto) {
    await res.body?.cancel().catch(() => undefined);
    throw new MidiaIndisponivel(`o arquivo passa de ${limite}`);
  }

  const pasta = await pastaDeMidia();
  await mkdir(pasta, { recursive: true });
  const temporario = path.join(pasta, `${randomUUID()}.skala-parcial`);
  let total = 0;
  let inicio = Buffer.alloc(0);
  const contar = new Transform({
    transform(pedaco: Buffer, _enc, feito) {
      total += pedaco.length;
      if (inicio.length < 16) inicio = Buffer.concat([inicio, pedaco.subarray(0, 16 - inicio.length)]);
      if (total > teto) return feito(new GrandeDemais());
      feito(null, pedaco);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as ReadableStreamDoNode<Uint8Array>), contar, createWriteStream(temporario));
  } catch (err) {
    await unlink(temporario).catch(() => undefined);
    if (err instanceof GrandeDemais) throw new MidiaIndisponivel(`o arquivo passa de ${limite}`);
    throw new MidiaIndisponivel(sinal.aborted ? "o download demorou demais" : "o download caiu no meio");
  }

  const tipo = tipoPelosBytes(inicio);
  if (!tipo || tipo.tipo !== esperado) {
    await unlink(temporario).catch(() => undefined);
    throw new MidiaIndisponivel(esperado === "video" ? "o arquivo baixado não é um vídeo" : "o arquivo baixado não é uma imagem");
  }
  const arquivo = `${randomUUID()}.${tipo.ext}`;
  const caminho = path.join(pasta, arquivo);
  await rename(temporario, caminho);
  return { arquivo, caminho, ...tipo, bytes: total };
}
