import "server-only";

import type { Autor, FiltroDocs, Frente, TipoDoc } from "@/features/memoria/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { ConflitoDeVersao } from "@/features/memoria/erros";
import { InputError } from "@/lib/server/http";

// Peças comuns das rotas /api/memoria (as rotas só validam a entrada e chamam os serviços).

// Quem grava: a pessoa logada com a chave de edição.
export async function autorEditor(): Promise<Autor> {
  const u = await exigirUsuario("memoria_editar");
  return { id: u.id, nome: u.nome };
}

export async function lerCorpo(request: Request): Promise<Record<string, unknown>> {
  const corpo = await request.json().catch(() => {
    throw new InputError("O corpo da requisição precisa ser JSON.");
  });
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new InputError("O corpo da requisição precisa ser um objeto JSON.");
  return corpo as Record<string, unknown>;
}

// tipo e frente da URL; valor inválido é recusado pelo serviço com a lista dos válidos.
export function filtroDaUrl(p: URLSearchParams): FiltroDocs {
  const tipo = p.get("tipo")?.trim();
  const frente = p.get("frente")?.trim();
  return { ...(tipo ? { tipo: tipo as TipoDoc } : {}), ...(frente ? { frente: frente as Frente } : {}) };
}

// Conflito de versão vira 409 com a versão atual: a tela mostra a mensagem e oferece recarregar sem perder o texto.
export async function comConflito(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConflitoDeVersao) return Response.json({ error: err.message, versaoAtual: err.versaoAtual }, { status: 409 });
    throw err;
  }
}
