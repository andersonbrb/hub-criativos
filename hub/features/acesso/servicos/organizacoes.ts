import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { organizacaoMembros, organizacoes } from "@/db/schema";
import { normalizarNomeDaOrganizacao, NOME_DA_ORGANIZACAO_MAXIMO, type MinhaOrganizacao, type OrganizacaoAtiva, type Usuario } from "@/features/acesso/contrato";
import { exigirGestor } from "@/features/acesso/servicos/membros";
import { InputError } from "@/lib/server/http";

// A organização aberta (nome) e as organizações de que a pessoa participa (o seletor do menu).

// Todas as organizações da pessoa, com o papel dela em cada. As desativadas e as suspensas aparecem marcadas (o
// seletor mostra, mas não deixa abrir).
export async function minhasOrganizacoes(usuarioId: string): Promise<MinhaOrganizacao[]> {
  const linhas = await banco()
    .select({ org: organizacoes, papel: organizacaoMembros.papel, ativo: organizacaoMembros.ativo })
    .from(organizacaoMembros)
    .innerJoin(organizacoes, eq(organizacoes.id, organizacaoMembros.organizacaoId))
    .where(eq(organizacaoMembros.usuarioId, usuarioId))
    .orderBy(asc(organizacoes.nome));
  return linhas.map((l) => ({ id: l.org.id, nome: l.org.nome, situacao: l.org.situacao, papel: l.papel, ativo: l.ativo }));
}

// Dono ou admin muda o nome da organização aberta.
export async function renomearOrganizacao(nome: unknown, quem: Usuario): Promise<OrganizacaoAtiva> {
  const eu = await exigirGestor(quem);
  const limpo = normalizarNomeDaOrganizacao(nome);
  if (!limpo) throw new InputError(`Informe o nome da organização (até ${NOME_DA_ORGANIZACAO_MAXIMO} caracteres).`);
  const [linha] = await banco().update(organizacoes).set({ nome: limpo }).where(eq(organizacoes.id, eu.organizacao.id)).returning();
  return { id: linha.id, nome: linha.nome, situacao: linha.situacao };
}

// A pessoa participa (ativa) desta organização ativa?
export async function participaAtiva(usuarioId: string, organizacaoId: string) {
  const [linha] = await banco()
    .select({ id: organizacaoMembros.usuarioId })
    .from(organizacaoMembros)
    .innerJoin(organizacoes, eq(organizacoes.id, organizacaoMembros.organizacaoId))
    .where(
      and(
        eq(organizacaoMembros.usuarioId, usuarioId),
        eq(organizacaoMembros.organizacaoId, organizacaoId),
        eq(organizacaoMembros.ativo, true),
        eq(organizacoes.situacao, "ativa"),
      ),
    )
    .limit(1);
  return Boolean(linha);
}
