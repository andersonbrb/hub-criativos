import "server-only";

import { ehAdmin, SemPermissao } from "@/features/acesso/contrato";
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

// noPrompt decide o que entra no prompt de sistema de TODOS os agentes do hub: ligar num documento é pôr instrução
// na boca de todos eles. Por isso só admin ou dono mexe nele; a chave "memoria_editar" não basta.
// Para os outros, mandar o campo é RECUSADO (403), e não ignorado: ignorar responderia 200 e a pessoa (ou o script)
// acharia que mudou. Vale com qualquer valor, até o igual ao atual, para a regra não depender de uma leitura antes.
// A tela da Memória não manda o campo, então quem edita pela tela nunca esbarra nisto.
export const AVISO_NO_PROMPT = "Só admin ou dono pode decidir o que entra no prompt dos agentes (noPrompt). Tire esse campo e salve de novo.";

export async function gravacaoDoEditor(request: Request): Promise<{ autor: Autor; corpo: Record<string, unknown> }> {
  const u = await exigirUsuario("memoria_editar");
  const corpo = await lerCorpo(request);
  if ("noPrompt" in corpo && !ehAdmin(u)) {
    const erro = new SemPermissao();
    erro.message = AVISO_NO_PROMPT;
    throw erro;
  }
  return { autor: { id: u.id, nome: u.nome }, corpo };
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
