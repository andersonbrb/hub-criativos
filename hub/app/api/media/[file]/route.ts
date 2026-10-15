import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO, CONTENT_TYPES, MEDIA_DIR } from "@/lib/server/media";

// Intervalo pedido no cabeçalho Range. null: manda o arquivo inteiro. "invalido": 416.
function intervaloPedido(cabecalho: string | null, tamanho: number): { inicio: number; fim: number } | null | "invalido" {
  if (!cabecalho) return null;
  const pedido = cabecalho.trim();
  // Unidade que não é bytes: o padrão do HTTP manda ignorar o Range e responder com o arquivo inteiro.
  if (!/^bytes=/i.test(pedido)) return null;
  const faixas = pedido.slice("bytes=".length).split(",");
  // Vários intervalos de uma vez (os players não pedem): o arquivo inteiro também é uma resposta válida.
  if (faixas.length > 1) return null;
  const m = /^\s*(\d*)\s*-\s*(\d*)\s*$/.exec(faixas[0]);
  if (!m || (!m[1] && !m[2])) return "invalido";
  if (!m[1]) {
    // "bytes=-500": os últimos 500 bytes.
    const ultimos = Number(m[2]);
    if (ultimos === 0 || tamanho === 0) return "invalido";
    return { inicio: Math.max(0, tamanho - ultimos), fim: tamanho - 1 };
  }
  const inicio = Number(m[1]);
  const fim = m[2] ? Number(m[2]) : tamanho - 1;
  if (inicio >= tamanho || fim < inicio) return "invalido";
  return { inicio, fim: Math.min(fim, tamanho - 1) };
}

// Serve os arquivos gerados (hub/.data/media) com suporte a Range, para o player de vídeo conseguir avançar.
// Vai em stream: nem o vídeo inteiro nem o pedaço pedido passam inteiros pela memória.
// Exige uma das telas de produção (chat, estúdios, Fluxo, editor, Biblioteca, Criativo automático): todas mostram mídia.
export const GET = route(async (request: Request, { params }: { params: Promise<{ file: string }> }) => {
  const { file } = await params;
  if (!/^[\w-]+\.\w+$/.test(file)) return new Response("Arquivo inválido", { status: 400 });

  const filePath = path.join(MEDIA_DIR, file);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return new Response("Não encontrado", { status: 404 });

  const tipo = CONTENT_TYPES[file.split(".").pop()!.toLowerCase()];
  const cabecalhos: Record<string, string> = {
    "Content-Type": tipo ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    // O navegador não tenta adivinhar o tipo: um arquivo enviado nunca vira página com script.
    "X-Content-Type-Options": "nosniff",
    // Tipo que não é mídia conhecida (texto, html, svg…): só baixa, nunca abre no hub.
    ...(tipo ? {} : { "Content-Disposition": "attachment" }),
  };

  const intervalo = intervaloPedido(request.headers.get("range"), info.size);
  if (intervalo === "invalido") {
    return new Response(null, {
      status: 416,
      headers: { ...cabecalhos, "Cache-Control": "no-store", "Content-Range": `bytes */${info.size}` },
    });
  }

  const { inicio, fim } = intervalo ?? { inicio: 0, fim: info.size - 1 };
  const tamanho = fim - inicio + 1;
  // Arquivo vazio: createReadStream não aceita fim antes do início.
  const corpo = tamanho > 0 ? (Readable.toWeb(createReadStream(filePath, { start: inicio, end: fim })) as unknown as ReadableStream<Uint8Array>) : null;
  return new Response(corpo, {
    status: intervalo ? 206 : 200,
    headers: {
      ...cabecalhos,
      "Content-Length": String(tamanho),
      ...(intervalo ? { "Content-Range": `bytes ${inicio}-${fim}/${info.size}` } : {}),
    },
  });
}, { chave: CHAVES_DE_PRODUCAO });
