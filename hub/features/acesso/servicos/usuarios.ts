import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { organizacaoMembros, organizacoes, usuarios } from "@/db/schema";
import { limparChaves, ORGANIZACAO_PADRAO, type Usuario } from "@/features/acesso/contrato";

// Conversão das linhas do banco para o Usuario do contrato, e a escolha da organização aberta. Fica separada de
// sessao.ts para os serviços puros (sessões, login, convites, membros) não dependerem dos wrappers que leem o cookie.

export type LinhaUsuario = typeof usuarios.$inferSelect;
export type LinhaMembro = typeof organizacaoMembros.$inferSelect;
export type LinhaOrganizacao = typeof organizacoes.$inferSelect;

// Com DONOS_DA_PLATAFORMA definida (e-mails separados por vírgula), só esses e-mails operam a plataforma, mesmo que a
// marca esteja na conta (quem tem acesso ao banco não vira operador só mudando uma coluna).
export function donosPermitidos(): string[] {
  return (process.env.DONOS_DA_PLATAFORMA ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const podeSerDono = (email: string) => {
  const lista = donosPermitidos();
  return lista.length === 0 || lista.includes(email.toLowerCase());
};

// A pessoa vista dentro de uma organização. Sem o vínculo (ou sem a organização): organização null e nenhuma chave.
export const paraUsuario = (l: LinhaUsuario, membro?: LinhaMembro | null, org?: LinhaOrganizacao | null): Usuario => {
  const vinculo = membro && org && membro.organizacaoId === org.id ? membro : null;
  return {
    id: l.id,
    email: l.email,
    nome: l.nome,
    papel: vinculo?.papel ?? "membro",
    ativo: Boolean(vinculo?.ativo),
    chaves: vinculo ? limparChaves(vinculo.chaves) : [],
    organizacao: vinculo && org ? { id: org.id, nome: org.nome, situacao: org.situacao } : null,
    operaPlataforma: l.operaPlataforma && podeSerDono(l.email),
  };
};

// Vínculo da pessoa com a organização (qualquer situação), com a organização junto.
export async function vinculoDe(usuarioId: string, organizacaoId: string | null, db: Banco = banco()) {
  if (!organizacaoId) return null;
  const [linha] = await db
    .select({ membro: organizacaoMembros, org: organizacoes })
    .from(organizacaoMembros)
    .innerJoin(organizacoes, eq(organizacoes.id, organizacaoMembros.organizacaoId))
    .where(and(eq(organizacaoMembros.usuarioId, usuarioId), eq(organizacaoMembros.organizacaoId, organizacaoId)))
    .limit(1);
  return linha ?? null;
}

// A conta, como está agora no banco, vista dentro da organização pedida.
export async function usuarioNaOrganizacao(usuarioId: string, organizacaoId: string | null, db: Banco = banco()): Promise<Usuario | null> {
  const [conta] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
  if (!conta) return null;
  const vinculo = await vinculoDe(conta.id, organizacaoId, db);
  return paraUsuario(conta, vinculo?.membro, vinculo?.org);
}

// Organização onde a pessoa cai: a preferida (se ela está ativa lá), senão a última aberta, senão a mais antiga em que
// entrou (a padrão primeiro, em caso de empate). null: nenhuma organização ativa.
export async function escolherOrganizacao(usuarioId: string, preferida?: string | null, db: Banco = banco()): Promise<string | null> {
  const ativas = await db
    .select({ id: organizacaoMembros.organizacaoId, entrouEm: organizacaoMembros.entrouEm, ultima: usuarios.ultimaOrganizacaoId })
    .from(organizacaoMembros)
    .innerJoin(organizacoes, eq(organizacoes.id, organizacaoMembros.organizacaoId))
    .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
    .where(and(eq(organizacaoMembros.usuarioId, usuarioId), eq(organizacaoMembros.ativo, true), eq(organizacoes.situacao, "ativa")))
    .orderBy(asc(organizacaoMembros.entrouEm));
  if (!ativas.length) return null;
  const ids = ativas.map((a) => a.id);
  if (preferida && ids.includes(preferida)) return preferida;
  const ultima = ativas[0].ultima;
  if (ultima && ids.includes(ultima)) return ultima;
  const maisAntiga = ativas[0].entrouEm.getTime();
  const empatadas = ativas.filter((a) => a.entrouEm.getTime() === maisAntiga).map((a) => a.id);
  return empatadas.includes(ORGANIZACAO_PADRAO.id) ? ORGANIZACAO_PADRAO.id : empatadas[0];
}

const FORMATO_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// E-mail sempre em minúsculas e sem espaços nas pontas (a coluna é única e a busca é exata).
export function normalizarEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const limpo = email.trim().toLowerCase();
  return limpo.length <= 200 && FORMATO_DE_EMAIL.test(limpo) ? limpo : null;
}

export function normalizarNome(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const limpo = nome.trim().replace(/\s+/g, " ");
  return limpo && limpo.length <= 100 ? limpo : null;
}
