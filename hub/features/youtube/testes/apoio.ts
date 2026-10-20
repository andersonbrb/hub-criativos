import { vi } from "vitest";

import { banco } from "@/db/cliente";
import { youtubeConta } from "@/db/schema";
import { cifrar } from "@/features/integracoes/servicos/cifra";
import { ESCOPO_ENVIO, ESCOPO_LEITURA, zerarMemoriaDoYoutube } from "@/features/youtube/servicos/conta";

// Apoio dos testes do YouTube: um Google de mentira (fetch trocado por vi.stubGlobal), com um servidor de envio que
// recebe o vídeo em pedaços como o de verdade, e canais prontos gravados direto no banco.

export const ORIGEM = "https://hub.teste";
export const CHAVE_DE_TESTE = Buffer.alloc(32, 7).toString("base64");

export function prepararAmbiente() {
  process.env.GOOGLE_CLIENT_ID = "cliente-teste.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "segredo-do-cliente";
  process.env.HUB_CHAVE_SEGREDOS = CHAVE_DE_TESTE;
  delete process.env.HUB_PUBLIC_URL;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  zerarMemoriaDoYoutube();
}

export type Tipo = "token" | "revogar" | "canal" | "videos" | "abrir-envio" | "pedaco" | "miniatura";
export type Chamada = { tipo: Tipo | "inesperado"; url: string; metodo: string; autorizacao: string | null; cabecalhos: Headers; corpo: unknown };
type Responder = (chamada: Chamada) => Response | Promise<Response>;

const TIPOS: [Tipo, string][] = [
  ["token", "https://oauth2.googleapis.com/token"],
  ["revogar", "https://oauth2.googleapis.com/revoke"],
  ["canal", "https://www.googleapis.com/youtube/v3/channels"],
  ["videos", "https://www.googleapis.com/youtube/v3/videos"],
  ["abrir-envio", "https://www.googleapis.com/upload/youtube/v3/videos"],
  ["miniatura", "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"],
  ["pedaco", "https://upload.falso/"],
];

export const json = (dados: unknown, status = 200, cabecalhos?: Record<string, string>) => Response.json(dados, { status, headers: cabecalhos });

// Troca o fetch global. Endereço sem resposta definida devolve 500 e fica registrado.
export function googleFalso(respostas: Partial<Record<Tipo, Responder>> = {}) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = String(entrada instanceof Request ? entrada.url : entrada);
      const tipo = TIPOS.find(([, prefixo]) => url.startsWith(prefixo))?.[0];
      const cabecalhos = new Headers(init?.headers);
      let corpo: unknown = null;
      if (init?.body instanceof URLSearchParams) corpo = Object.fromEntries(init.body);
      else if (typeof init?.body === "string") corpo = JSON.parse(init.body);
      else if (init?.body instanceof Uint8Array) corpo = init.body;
      const chamada: Chamada = { tipo: tipo ?? "inesperado", url, metodo: init?.method ?? "GET", autorizacao: cabecalhos.get("authorization"), cabecalhos, corpo };
      chamadas.push(chamada);
      const responder = tipo && respostas[tipo];
      return responder ? responder(chamada) : json({ error: "inesperado" }, 500);
    }),
  );
  return chamadas;
}

// Servidor de envio do YouTube de mentira: abre sessões e recebe os pedaços (Content-Range), como o de verdade.
// `privacidade`: como o YouTube devolve o vídeo (null = a pedida).
export function servidorDeEnvio(opcoes: { privacidade?: string | null; videoId?: string } = {}) {
  const sessoes = new Map<string, { total: number; recebidos: number; metadados: { status?: { privacyStatus?: string } } }>();
  let proxima = 1;
  const pronto = (s: { metadados: { status?: { privacyStatus?: string } } }) =>
    json({ id: opcoes.videoId ?? "video-1", status: { privacyStatus: opcoes.privacidade ?? s.metadados.status?.privacyStatus, uploadStatus: "uploaded" } });
  return {
    sessoes,
    "abrir-envio": (c: Chamada) => {
      const endereco = `https://upload.falso/sessao/${proxima++}`;
      sessoes.set(endereco, { total: Number(c.cabecalhos.get("x-upload-content-length")), recebidos: 0, metadados: c.corpo as never });
      return new Response(null, { status: 200, headers: { location: endereco } });
    },
    pedaco: (c: Chamada) => {
      const s = sessoes.get(c.url);
      if (!s) return json({ error: "sessão não existe" }, 404);
      const faixa = c.cabecalhos.get("content-range") ?? "";
      const [, inicio, fim] = faixa.match(/bytes (\d+)-(\d+)\/\d+/) ?? [];
      if (inicio !== undefined) {
        if (Number(inicio) !== s.recebidos) return json({ error: "fora de ordem" }, 400);
        s.recebidos = Number(fim) + 1;
      }
      if (s.recebidos >= s.total) return pronto(s);
      return new Response(null, { status: 308, headers: s.recebidos ? { range: `bytes=0-${s.recebidos - 1}` } : {} });
    },
  };
}

export const canalDoGoogle = (id = "UC-canal-1", titulo = "Canal da Empresa") =>
  json({ items: [{ id, snippet: { title: titulo, customUrl: "@canaldaempresa", thumbnails: { default: { url: "https://yt.falso/foto.jpg" } } } }] });

export const tokensDoGoogle = (extra: Record<string, unknown> = {}) =>
  json({ access_token: "acesso-1", refresh_token: "refresh-1", expires_in: 3599, token_type: "Bearer", scope: `${ESCOPO_ENVIO} ${ESCOPO_LEITURA}`, ...extra });

// Canal já conectado, gravado direto no banco, com o token de acesso valendo por mais uma hora.
export async function canalConectadoNoBanco(organizacaoId: string, dados: { canalId?: string; titulo?: string } = {}) {
  await banco()
    .insert(youtubeConta)
    .values({
      organizacaoId,
      canalId: dados.canalId ?? "UC-canal-1",
      canalTitulo: dados.titulo ?? "Canal da Empresa",
      refreshTokenCifrado: cifrar("refresh-guardado"),
      accessTokenCifrado: cifrar("acesso-guardado"),
      expiraEm: new Date(Date.now() + 60 * 60_000),
      escopos: [ESCOPO_ENVIO, ESCOPO_LEITURA],
    });
}
