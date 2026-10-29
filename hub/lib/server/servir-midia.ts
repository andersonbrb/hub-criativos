import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import { abrirTrecho, ArquivoForaDoDrive } from "@/features/drive/servicos/arquivos";
import { midiaDoArquivo, sincronizarComDrive } from "@/features/drive/servicos/videos";
import { CONTENT_TYPES, faixaComTeto, trechoDoArquivo } from "@/lib/server/media";
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
// Quem chama confere a permissão (a rota /api/media exige uma das telas de produção; os links do Instagram, a
// assinatura do link) e roda na organização dona do arquivo.
// Vídeo guardado no Google Drive (features/drive): o endereço é o mesmo, e o vídeo vem do Drive, repassando o Range.
// Enquanto a cópia local existir (o envio acabou de terminar, ou ela está em uso), ela serve, sem depender do Drive.
// `teto`: pedido "até o fim" de vídeo do Drive sai em pedaços de no máximo 2 MB (o player); sem ele, o Range vai como
// veio (serviço que baixa o arquivo inteiro, como o Instagram e o HeyGen pelos links do Instagram).
export async function servirArquivoDeMidia(request: Request, file: string, opcoes: { teto?: boolean } = {}): Promise<Response> {
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
      // O navegador que desiste antes de o Drive responder cancela o pedido ao Drive. Depois que o Drive responde,
      // quem para o download é o próprio cancelamento da leitura (o player pulou ou fechou). Os dois juntos disputavam
      // o fechamento do stream, e o servidor registrava "Controller is already closed".
      const ateResponder = new AbortController();
      const desistiu = () => ateResponder.abort(request.signal.reason);
      if (request.signal.aborted) desistiu();
      else request.signal.addEventListener("abort", desistiu, { once: true });
      try {
        trecho = await abrirTrecho(midia.drive.id, opcoes.teto === false ? request.headers.get("range") : faixaComTeto(request.headers.get("range")), ateResponder.signal);
      } catch (err) {
        if (err instanceof ArquivoForaDoDrive) {
          // Não marca na hora (pode ser outra conta conectada): o espelho confere a lista do Drive e marca se confirmar.
          void sincronizarComDrive();
          return apagadoNoDrive();
        }
        throw err;
      } finally {
        request.signal.removeEventListener("abort", desistiu);
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
  const corpo = tamanho > 0 ? trechoDoArquivo(filePath, inicio, fim) : null;
  return new Response(corpo, {
    status: intervalo ? 206 : 200,
    headers: {
      ...cabecalhos,
      "Content-Length": String(tamanho),
      ...(intervalo ? { "Content-Range": `bytes ${inicio}-${fim}/${info.size}` } : {}),
    },
  });
}
