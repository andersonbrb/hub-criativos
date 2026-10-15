import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { ehAdmin, limparChaves, NaoAutenticado, type Membro, type Papel, type Usuario } from "@/features/acesso/contrato";
import { MembroNaoEncontrado, RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { encerrarSessoesDe } from "@/features/acesso/servicos/sessoes";
import { normalizarNome, paraUsuario, type LinhaUsuario } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Gestão de membros. Regras (as mesmas do Chegou Operações, mais duras onde mexe em quem manda):
// - só admin ou dono gerencia; admin cuida de membros, e mexer em admin ou dono é com o dono;
// - só o dono promove alguém a admin ou rebaixa um admin; o papel "dono" só vem do script criar-dono;
// - ninguém se desativa nem muda o próprio papel; sempre sobra pelo menos um dono ativo;
// - desativar derruba as sessões abertas da pessoa na hora.

const ORDEM_DO_PAPEL: Record<Papel, number> = { dono: 0, admin: 1, membro: 2 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const paraMembro = (l: LinhaUsuario): Membro => ({
  ...paraUsuario(l),
  criadoEm: l.criadoEm.toISOString(),
  ultimoAcessoEm: l.ultimoAcessoEm?.toISOString() ?? null,
  temSenha: Boolean(l.senhaHash),
});

async function linhaPorId(id: string, db: Banco = banco()) {
  if (!ehUuid(id)) return null;
  const [linha] = await db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
  return linha ?? null;
}

// Quem pede a mudança, como está agora no banco: a sessão pode ter sido aberta antes de a pessoa perder o cargo.
export async function exigirGestor(quem: Usuario): Promise<Usuario> {
  const linha = await linhaPorId(quem.id);
  if (!linha?.ativo) throw new NaoAutenticado();
  const atual = paraUsuario(linha);
  if (!ehAdmin(atual)) throw new SoQuemPode("Só admins e o dono do hub gerenciam membros e convites.");
  return atual;
}

export async function listarMembros(): Promise<Membro[]> {
  const linhas = await banco().select().from(usuarios);
  return linhas
    .map(paraMembro)
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || ORDEM_DO_PAPEL[a.papel] - ORDEM_DO_PAPEL[b.papel] || a.nome.localeCompare(b.nome, "pt-BR"));
}

export type MudancasDoMembro = { papel?: unknown; chaves?: unknown; ativo?: unknown; nome?: unknown };

export async function atualizarMembro(id: string, mudancas: MudancasDoMembro, quemAltera: Usuario): Promise<Membro> {
  const eu = await exigirGestor(quemAltera);
  const alvo = await linhaPorId(id);
  if (!alvo) throw new MembroNaoEncontrado();
  const proprio = alvo.id === eu.id;
  const souDono = eu.papel === "dono";

  // Desativar ou mexer nas chaves de um admin equivale a rebaixá-lo: só o dono.
  if (!proprio && alvo.papel !== "membro" && !souDono) throw new SoQuemPode("Só o dono do hub altera admins e donos.");

  const novo: Partial<typeof usuarios.$inferInsert> = {};
  if (mudancas.nome !== undefined) {
    const nome = normalizarNome(mudancas.nome);
    if (!nome) throw new InputError("Informe um nome (até 100 caracteres).");
    novo.nome = nome;
  }
  if (mudancas.chaves !== undefined) {
    if (!Array.isArray(mudancas.chaves)) throw new InputError("Lista de acessos inválida.");
    novo.chaves = limparChaves(mudancas.chaves);
  }
  if (mudancas.papel !== undefined && mudancas.papel !== alvo.papel) {
    if (mudancas.papel === "dono") throw new RegraDeMembros("O papel de dono só é dado pelo script do servidor (criar-dono).");
    if (mudancas.papel !== "admin" && mudancas.papel !== "membro") throw new InputError("Papel inválido: use admin ou membro.");
    novo.papel = mudancas.papel;
  }
  if (mudancas.ativo !== undefined && mudancas.ativo !== alvo.ativo) {
    if (typeof mudancas.ativo !== "boolean") throw new InputError("Valor inválido para ativo.");
    novo.ativo = mudancas.ativo;
  }

  const deixaDeSerDonoAtivo = alvo.papel === "dono" && alvo.ativo && ((novo.papel !== undefined && novo.papel !== "dono") || novo.ativo === false);

  // O último dono vem antes das outras regras: é a explicação mais útil quando o único dono tenta sair.
  const atualizado = await banco().transaction(async (tx) => {
    if (deixaDeSerDonoAtivo) {
      // Trava as linhas dos donos: duas mudanças ao mesmo tempo não podem deixar o hub sem nenhum.
      const donos = await tx.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.papel, "dono"), eq(usuarios.ativo, true), ne(usuarios.id, alvo.id))).for("update");
      if (donos.length === 0) throw new RegraDeMembros("O hub precisa de pelo menos um dono ativo. Crie outro dono antes (script criar-dono).");
    }
    if (proprio && novo.ativo === false) throw new RegraDeMembros("Você não pode desativar a sua própria conta.");
    if (proprio && novo.papel !== undefined) throw new RegraDeMembros("Você não pode mudar o seu próprio papel.");
    if (novo.papel !== undefined && !souDono) throw new SoQuemPode("Só o dono do hub promove alguém a admin ou rebaixa um admin.");

    if (Object.keys(novo).length === 0) return alvo;
    const [linha] = await tx.update(usuarios).set(novo).where(eq(usuarios.id, alvo.id)).returning();
    return linha;
  });

  if (novo.ativo === false) await encerrarSessoesDe(alvo.id);
  return paraMembro(atualizado);
}
