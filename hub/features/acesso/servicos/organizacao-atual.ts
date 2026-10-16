import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { ORGANIZACAO_PADRAO, SemPermissao } from "@/features/acesso/contrato";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";

// Em qual organização o código está rodando. Cada organização tem os próprios dados (arquivos em .data/ e linhas no
// banco), então tudo que lê ou grava dado pergunta aqui:
// - route() (lib/server/http.ts) roda cada rota dentro da organização aberta na sessão de quem pediu;
// - o MCP do hub (chat) e o conector do Claude Code rodam dentro da organização da conversa ou da conexão;
// - páginas (componentes de servidor) caem na organização da sessão do pedido;
// - trabalho em segundo plano iniciado por um pedido herda a organização dele (o contexto segue os awaits e os
//   callbacks criados dentro dele).
// Sem nenhuma dessas, lança. Nunca adivinha: gravar na organização errada entregaria dado de uma para a outra.

type Contexto = { organizacaoId: string };

// Em globalThis: o Next pode carregar este arquivo mais de uma vez (rotas compiladas à parte), e todas precisam
// enxergar o mesmo contexto.
const g = globalThis as typeof globalThis & { __hubOrganizacao?: AsyncLocalStorage<Contexto> };
const armazenamento = (g.__hubOrganizacao ??= new AsyncLocalStorage<Contexto>());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehIdDeOrganizacao = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export class SemOrganizacao extends SemPermissao {
  constructor() {
    super();
    this.message = "Sua conta não está em nenhuma organização ativa. Peça um convite a quem cuida da equipe.";
  }
}

// Roda fn dentro da organização. Tudo que fn chamar (e o que continuar depois, em segundo plano) usa os dados dela.
export function comOrganizacao<T>(organizacaoId: string, fn: () => T): T {
  if (!ehIdDeOrganizacao(organizacaoId)) throw new Error("Organização inválida.");
  return armazenamento.run({ organizacaoId: organizacaoId.toLowerCase() }, fn);
}

// A organização do contexto, sem cair na sessão (null fora de comOrganizacao).
export const organizacaoDoContexto = (): string | null => armazenamento.getStore()?.organizacaoId ?? null;

export async function organizacaoAtual(): Promise<string> {
  const contexto = armazenamento.getStore();
  if (contexto) return contexto.organizacaoId;
  // PC sem banco: não há contas nem organizações, só a padrão.
  if (modoLocalSemBanco()) return ORGANIZACAO_PADRAO.id;
  // Página (componente de servidor): a organização aberta na sessão deste pedido. Import tardio: a sessão lê os
  // cookies do Next, que não existem nos scripts. Fora de um pedido, ler os cookies lança, e cai no erro abaixo.
  const { usuarioDaSessao } = await import("@/features/acesso/servicos/sessao");
  const usuario = await usuarioDaSessao().catch(() => null);
  if (usuario?.organizacao && usuario.ativo && usuario.organizacao.situacao === "ativa") return usuario.organizacao.id;
  throw new SemOrganizacao();
}
