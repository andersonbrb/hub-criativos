import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as ReadableStreamDoNode } from "node:stream/web";

import { and, eq, gt, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { conectorLinks } from "@/db/schema";
import { podeUsar } from "@/features/acesso/contrato";
import { buscarUsuario } from "@/features/acesso/servicos/sessao";
import { json, SEM_CACHE } from "@/features/conector/servicos/http";
import { PREFIXO_LINK, hashDe, novo } from "@/features/conector/servicos/segredos";
import { downloadName, type MediaKind } from "@/lib/generations";
import { CONTENT_TYPES, MEDIA_DIR } from "@/lib/server/media";
import { createGeneration, getGeneration } from "@/lib/server/store";

// Links curtos de envio e de download de arquivo, para o terminal (curl).
//
// O Claude Code tem o arquivo no disco e um terminal; o MCP tem teto de 1 MB por mensagem. O link fecha essa
// distância: a ferramenta devolve um curl pronto, e o arquivo vai (ou vem) direto, sem passar pela conversa.
//
// O TOKEN É O SEGREDO: 256 bits, só o SHA-256 no banco, como os tokens do OAuth. As travas:
//   • envio: USO ÚNICO e 15 minutos. O link é marcado como usado ANTES de o arquivo começar a chegar, então dois curl
//     ao mesmo tempo não viram dois arquivos; se a gravação falhar, ele volta a valer (o erro foi do arquivo);
//   • download: 10 minutos, pode repetir;
//   • na hora de usar, o DONO do link é reconferido: conta ativa, com o conector e a Biblioteca. Tirar a chave mata
//     o link na hora.

export const VALIDADE_ENVIO_MS = 15 * 60_000;
export const VALIDADE_DOWNLOAD_MS = 10 * 60_000;
// Vídeo final de anúncio fica na casa das dezenas ou centenas de MB; o teto só segura o absurdo no disco.
export const TETO_ENVIO_BYTES = 2 * 1024 ** 3;
const ROTA = "/api/conector/arquivos/";

// Só o que a Biblioteca sabe mostrar: vídeo, imagem e áudio.
export function tipoDoArquivo(nome: string): { ext: string; contentType: string; kind: MediaKind } | null {
  const ext = path.extname(nome).slice(1).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  const kind = contentType?.split("/")[0];
  if (kind !== "video" && kind !== "image" && kind !== "audio") return null;
  return { ext, contentType, kind };
}

export const extensoesAceitas = () => Object.keys(CONTENT_TYPES).filter((ext) => tipoDoArquivo(`x.${ext}`));

function urlDoLink(base: string, token: string) {
  return `${base}${ROTA}${token}`;
}

export async function criarLinkDeEnvio(usuarioId: string, nomeArquivo: string, base: string) {
  const token = novo(PREFIXO_LINK);
  const expiraEm = new Date(Date.now() + VALIDADE_ENVIO_MS);
  await banco().insert(conectorLinks).values({ tipo: "envio", tokenHash: hashDe(token), usuarioId, nomeArquivo, expiraEm });
  const url = urlDoLink(base, token);
  return { url, expiraEm, comando: `curl -T "${nomeArquivo}" "${url}"` };
}

export async function criarLinkDeDownload(usuarioId: string, generationId: string, nome: string, base: string) {
  const token = novo(PREFIXO_LINK);
  const expiraEm = new Date(Date.now() + VALIDADE_DOWNLOAD_MS);
  await banco().insert(conectorLinks).values({ tipo: "download", tokenHash: hashDe(token), usuarioId, generationId, expiraEm });
  const url = urlDoLink(base, token);
  return { url, expiraEm, comando: `curl -fL -o "${nome}" "${url}"` };
}

const MSG_LINK_INVALIDO = "Link inválido, vencido ou já usado. Peça outro ao Claude.";
const MSG_DONO_SEM_ACESSO = "Quem pediu este link não tem mais acesso à Biblioteca pelo conector. Peça a um admin.";
const recusa = (mensagem: string, status: number) => json({ error: mensagem }, status, SEM_CACHE);

async function linkValido(token: string, tipo: "envio" | "download") {
  if (!token || token.length > 200) return null;
  const [link] = await banco()
    .select()
    .from(conectorLinks)
    .where(and(eq(conectorLinks.tokenHash, hashDe(token)), eq(conectorLinks.tipo, tipo)))
    .limit(1);
  if (!link || link.expiraEm.getTime() <= Date.now()) return null;
  if (tipo === "envio" && link.usadoEm) return null;
  return link;
}

async function donoPodeUsar(usuarioId: string) {
  const dono = await buscarUsuario(usuarioId);
  return dono && podeUsar(dono, "conector_claude") && podeUsar(dono, "biblioteca") ? dono : null;
}

class GrandeDemais extends Error {}

// PUT do curl -T: o corpo vai em stream direto para a pasta de mídia, sem passar inteiro pela memória.
export async function receberEnvio(request: Request, token: string): Promise<Response> {
  const link = await linkValido(token, "envio");
  if (!link) return recusa(MSG_LINK_INVALIDO, 404);
  const declarado = Number(request.headers.get("content-length") ?? "") || null;
  if (declarado && declarado > TETO_ENVIO_BYTES) return recusa("O arquivo passa de 2 GB.", 413);
  const dono = await donoPodeUsar(link.usuarioId);
  if (!dono) return recusa(MSG_DONO_SEM_ACESSO, 403);
  const nome = link.nomeArquivo ?? "";
  const tipo = tipoDoArquivo(nome);
  if (!tipo) return recusa("Tipo de arquivo não aceito pela Biblioteca.", 400);
  if (!request.body) return recusa("O arquivo chegou vazio. Confira o caminho no comando curl.", 400);

  const db = banco();
  const pegou = await db
    .update(conectorLinks)
    .set({ usadoEm: new Date() })
    .where(and(eq(conectorLinks.id, link.id), isNull(conectorLinks.usadoEm), gt(conectorLinks.expiraEm, new Date())))
    .returning({ id: conectorLinks.id });
  if (!pegou.length) return recusa(MSG_LINK_INVALIDO, 404);
  const devolverLink = () => db.update(conectorLinks).set({ usadoEm: null }).where(eq(conectorLinks.id, link.id));

  await mkdir(MEDIA_DIR, { recursive: true });
  const arquivo = `${randomUUID()}.${tipo.ext}`;
  const caminho = path.join(MEDIA_DIR, arquivo);
  let total = 0;
  const contador = new Transform({
    transform(pedaco: Buffer, _codificacao, pronto) {
      total += pedaco.length;
      pronto(total > TETO_ENVIO_BYTES ? new GrandeDemais() : null, pedaco);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as unknown as ReadableStreamDoNode), contador, createWriteStream(caminho));
    if (total === 0) throw new Error("vazio");
    // O curl -T manda o tamanho do arquivo. Chegar menos é conexão caída ou corpo cortado no caminho (o proxy do Next
    // corta em silêncio o que passa do teto dele): melhor recusar do que guardar um vídeo pela metade.
    if (declarado && total !== declarado) throw new Error("incompleto");
    const geracao = await createGeneration({
      tool: "upload",
      kind: tipo.kind,
      status: "done",
      prompt: nome,
      // Sem a extensão: o nome do download soma a extensão do arquivo (downloadName) e ela sairia dobrada.
      name: path.parse(nome).name.slice(0, 100) || undefined,
      params: { origem: "conector", por: dono.email },
      file: arquivo,
      // É entrega: vai direto para a Biblioteca.
      saved: true,
    });
    await db.update(conectorLinks).set({ generationId: geracao.id }).where(eq(conectorLinks.id, link.id));
    console.info(`[conector] envio por link: ${nome} (${total} bytes) virou a geração ${geracao.id}`);
    return json({ ok: true, generation_id: geracao.id, nome, tamanho_bytes: total, mensagem: "Arquivo recebido e salvo na Biblioteca do Hub." }, 201, SEM_CACHE);
  } catch (err) {
    await unlink(caminho).catch(() => undefined);
    await devolverLink();
    if (err instanceof GrandeDemais) return recusa("O arquivo passa de 2 GB.", 413);
    if (err instanceof Error && err.message === "vazio") return recusa("O arquivo chegou vazio. Confira o caminho no comando curl.", 400);
    if (err instanceof Error && err.message === "incompleto") {
      return recusa("O arquivo chegou incompleto. O link continua valendo: rode o mesmo comando de novo.", 400);
    }
    console.error("[conector] envio por link falhou:", err instanceof Error ? err.message : err);
    return recusa("Não deu para gravar o arquivo. O link continua valendo: tente de novo.", 500);
  }
}

// GET do curl -o: o arquivo atual da geração, como anexo, em stream.
export async function entregarDownload(token: string): Promise<Response> {
  const link = await linkValido(token, "download");
  if (!link) return recusa(MSG_LINK_INVALIDO, 404);
  if (!(await donoPodeUsar(link.usuarioId))) return recusa(MSG_DONO_SEM_ACESSO, 403);
  const geracao = link.generationId ? await getGeneration(link.generationId) : undefined;
  if (!geracao?.file || !/^[\w-]+\.\w+$/.test(geracao.file)) return recusa("Este arquivo não existe mais no Hub.", 404);
  const caminho = path.join(MEDIA_DIR, geracao.file);
  const info = await stat(caminho).catch(() => null);
  if (!info?.isFile()) return recusa("Este arquivo não existe mais no Hub.", 404);
  // Primeiro uso fica registrado (auditoria); não impede o próximo dentro do prazo.
  await banco()
    .update(conectorLinks)
    .set({ usadoEm: new Date() })
    .where(and(eq(conectorLinks.id, link.id), isNull(conectorLinks.usadoEm)));

  const nome = downloadName(geracao);
  const ascii = nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const tipo = CONTENT_TYPES[geracao.file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
  const corpo = Readable.toWeb(createReadStream(caminho)) as unknown as ReadableStream;
  return new Response(corpo, {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "X-Content-Type-Options": "nosniff",
      ...SEM_CACHE,
    },
  });
}
