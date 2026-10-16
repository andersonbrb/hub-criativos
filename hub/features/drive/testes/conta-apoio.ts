import { randomBytes } from "node:crypto";

import { vi } from "vitest";

import { banco } from "@/db/cliente";
import { driveConta, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import type { Chave } from "@/features/acesso/contrato";
import { garantirOrganizacaoPadrao, vincular } from "@/features/acesso/testes/ajuda";
import { cifrar, ESCOPO_DRIVE, zerarMemoriaDoDrive } from "@/features/drive/servicos/conta";

// Apoio dos testes da conta do Drive: um Google de mentira (fetch trocado por vi.stubGlobal) e contas prontas.

export const ORIGEM = "https://hub.teste";
export const CHAVE_DE_TESTE = Buffer.alloc(32, 7).toString("base64");

export async function prepararConta() {
  process.env.GOOGLE_CLIENT_ID = "cliente-teste.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "segredo-do-cliente";
  process.env.HUB_CHAVE_SEGREDOS = CHAVE_DE_TESTE;
  delete process.env.HUB_PUBLIC_URL;
  // Os avisos de falha (console.error) são esperados em vários testes e só sujariam a saída.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  zerarMemoriaDoDrive();
  await bancoDeTeste();
  await garantirOrganizacaoPadrao();
}

export type ChamadaAoGoogle = { tipo: TipoDeChamada; url: string; metodo: string; corpo: Record<string, string>; autorizacao: string | null };
type TipoDeChamada = "token" | "perfil" | "revogar" | "sobre";
type Responder = (chamada: ChamadaAoGoogle) => Response | Promise<Response>;

const TIPOS: [TipoDeChamada, string][] = [
  ["token", "https://oauth2.googleapis.com/token"],
  ["perfil", "https://openidconnect.googleapis.com/v1/userinfo"],
  ["revogar", "https://oauth2.googleapis.com/revoke"],
  ["sobre", "https://www.googleapis.com/drive/v3/about"],
];

// Troca o fetch global: cada endereço do Google responde com a função dada. Devolve a lista de chamadas feitas.
// Endereço sem resposta definida devolve 500 e fica registrado como "inesperado" no teste que olhar a lista.
export function googleFalso(respostas: Partial<Record<TipoDeChamada, Responder>> = {}) {
  const chamadas: ChamadaAoGoogle[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = String(entrada instanceof Request ? entrada.url : entrada);
      const tipo = TIPOS.find(([, prefixo]) => url.startsWith(prefixo))?.[0];
      const corpo = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
      const chamada: ChamadaAoGoogle = {
        tipo: tipo ?? ("inesperado" as TipoDeChamada),
        url,
        metodo: init?.method ?? "GET",
        corpo,
        autorizacao: new Headers(init?.headers).get("authorization"),
      };
      chamadas.push(chamada);
      const responder = tipo && respostas[tipo];
      return responder ? responder(chamada) : Response.json({ error: "inesperado" }, { status: 500 });
    }),
  );
  return chamadas;
}

export const json = (dados: unknown, status = 200) => Response.json(dados, { status });

export const tokensDoGoogle = (extra: Record<string, unknown> = {}) =>
  json({
    access_token: "acesso-1",
    refresh_token: "refresh-1",
    expires_in: 3599,
    token_type: "Bearer",
    scope: `openid ${ESCOPO_DRIVE} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
    ...extra,
  });

export async function criarPessoa(chaves: Chave[] = ["integracoes"]) {
  const [pessoa] = await banco()
    .insert(usuarios)
    .values({ email: `pessoa-${randomBytes(4).toString("hex")}@exemplo.com`, nome: "Pessoa" })
    .returning();
  await vincular(pessoa.id, await garantirOrganizacaoPadrao(), { chaves });
  return pessoa;
}

// Conta já conectada, gravada direto no banco, com o token de acesso vencendo daqui a `venceEmMs`.
export async function contaConectada(venceEmMs: number, dados: { email?: string; refresh?: string } = {}) {
  await banco()
    .insert(driveConta)
    .values({
      organizacaoId: await garantirOrganizacaoPadrao(),
      email: dados.email ?? "videos@gmail.com",
      nome: "Vídeos do Hub",
      refreshTokenCifrado: cifrar(dados.refresh ?? "refresh-guardado"),
      accessTokenCifrado: cifrar("acesso-guardado"),
      expiraEm: new Date(Date.now() + venceEmMs),
      escopos: [ESCOPO_DRIVE],
    });
}
