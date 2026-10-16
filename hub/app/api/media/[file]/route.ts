import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { abrirTrecho, ArquivoForaDoDrive } from "@/features/drive/servicos/arquivos";
import { midiaDoArquivo, sincronizarComDrive } from "@/features/drive/servicos/videos";
import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO, CONTENT_TYPES } from "@/lib/server/media";
import { pastaDeMidia } from "@/lib/server/pastas";

// O vídeo foi apagado (ou mandado para a lixeira) direto no Drive: o hub não tem outra cópia.
const apagadoNoDrive = () =>
  new Response("Esse vídeo foi apagado no Drive.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

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
// Vídeo guardado no Google Drive (features/drive): o endereço é o mesmo, e o vídeo vem do Drive, repassando o Range.
// Enquanto a cópia local existir (o envio acabou de terminar, ou ela está em uso), ela serve, sem depender do Drive.
export const GET = route(async (request: Request, { params }: { params: Promise<{ file: string }> }) => {
  const { file } = await params;
  if (!/^[\w-]+\.\w+$/.test(file)) return new Response("Arquivo inválido", { status: 400 });

  // Só a pasta da organização aberta: um arquivo de outra organização não existe aqui.
  const filePath = path.join(await pastaDeMidia(), file);
  const info = await stat(filePath).catch(() => null);

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

  // Vídeo (ou arquivo que não está no disco): confere no índice das gerações se foi para o Drive. Imagens e áudios
  // que estão no disco nem consultam.
  if (!info?.isFile() || !tipo || tipo.startsWith("video/")) {
    const midia = await midiaDoArquivo(file);
    if (midia?.foraDoDrive) return apagadoNoDrive();
    if (midia?.drive && !info?.isFile()) {
      let trecho;
      try {
        // Com o signal: o navegador que desiste do pedaço (o player pulou para outro ponto) fecha a conexão com o Drive.
        trecho = await abrirTrecho(midia.drive.id, request.headers.get("range"), request.signal);
      } catch (err) {
        if (err instanceof ArquivoForaDoDrive) {
          // Não marca na hora (pode ser outra conta conectada): o espelho confere a lista do Drive e marca se confirmar.
          void sincronizarComDrive();
          return apagadoNoDrive();
        }
        throw err;
      }
      // Os cabeçalhos do Drive (tamanho, Content-Range) com as travas do hub por cima.
      const headers = new Headers(trecho.cabecalhos);
      for (const [nome, valor] of Object.entries(cabecalhos)) headers.set(nome, valor);
      if (trecho.status === 416) headers.set("Cache-Control", "no-store");
      return new Response(trecho.corpo, { status: trecho.status, headers });
    }
  }
  if (!info?.isFile()) return new Response("Não encontrado", { status: 404 });

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
