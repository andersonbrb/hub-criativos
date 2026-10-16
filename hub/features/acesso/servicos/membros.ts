import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { organizacaoMembros, usuarios } from "@/db/schema";
import { ehAdmin, limparChaves, NaoAutenticado, type Membro, type Papel, type Usuario } from "@/features/acesso/contrato";
import { MembroNaoEncontrado, RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { SemOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { usuarioNaOrganizacao, type LinhaMembro, type LinhaUsuario } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Equipe da organização aberta. Regras (as do Chegou Operações e do Cifra, mais duras onde mexe em quem manda):
// - só admin ou dono gerencia; admin cuida de membros, e mexer em admin ou dono é com um dono;
// - só um dono muda papéis (inclusive dar o papel de dono a outra pessoa);
// - ninguém se desativa, se remove nem muda o próprio papel (para sair existe "Sair da organização");
// - toda organização mantém pelo menos um dono ativo;
// - desativar ou remover vale na hora: a próxima tela que a pessoa abrir já não é desta organização.
// Tudo vale só dentro da organização: um admin daqui não mexe na conta de ninguém (nome, senha, outras organizações).

const ORDEM_DO_PAPEL: Record<Papel, number> = { dono: 0, admin: 1, membro: 2 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const paraMembro = (conta: LinhaUsuario, vinculo: LinhaMembro): Membro => ({
  id: conta.id,
  email: conta.email,
  nome: conta.nome,
  papel: vinculo.papel,
  ativo: vinculo.ativo,
  chaves: limparChaves(vinculo.chaves),
  entrouEm: vinculo.entrouEm.toISOString(),
  ultimoAcessoEm: conta.ultimoAcessoEm?.toISOString() ?? null,
  temSenha: Boolean(conta.senhaHash),
});

async function membroPorId(organizacaoId: string, id: string, db: Banco = banco()) {
  if (!ehUuid(id)) return null;
  const [linha] = await db
    .select({ conta: usuarios, vinculo: organizacaoMembros })
    .from(organizacaoMembros)
    .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
    .where(and(eq(organizacaoMembros.organizacaoId, organizacaoId), eq(organizacaoMembros.usuarioId, id)))
    .limit(1);
  return linha ?? null;
}

// Organização aberta de quem pede, e a pessoa como está AGORA nela (a sessão pode ter sido aberta antes de ela
// perder o cargo).
export async function exigirNaOrganizacao(quem: Usuario): Promise<Usuario & { organizacao: NonNullable<Usuario["organizacao"]> }> {
  if (!quem.organizacao) throw new SemOrganizacao();
  const atual = await usuarioNaOrganizacao(quem.id, quem.organizacao.id);
  if (!atual) throw new NaoAutenticado();
  if (!atual.organizacao || !atual.ativo || atual.organizacao.situacao !== "ativa") throw new SemOrganizacao();
  return atual as Usuario & { organizacao: NonNullable<Usuario["organizacao"]> };
}

export async function exigirGestor(quem: Usuario) {
  const atual = await exigirNaOrganizacao(quem);
  if (!ehAdmin(atual)) throw new SoQuemPode("Só admins e donos da organização gerenciam a equipe e os convites.");
  return atual;
}

export async function listarMembros(organizacaoId: string): Promise<Membro[]> {
  const linhas = await banco()
    .select({ conta: usuarios, vinculo: organizacaoMembros })
    .from(organizacaoMembros)
    .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
    .where(eq(organizacaoMembros.organizacaoId, organizacaoId));
  return linhas
    .map((l) => paraMembro(l.conta, l.vinculo))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || ORDEM_DO_PAPEL[a.papel] - ORDEM_DO_PAPEL[b.papel] || a.nome.localeCompare(b.nome, "pt-BR"));
}

// Trava os outros donos ativos da organização: duas mudanças ao mesmo tempo não podem deixá-la sem nenhum.
async function sobraOutroDono(tx: Banco, organizacaoId: string, alvoId: string) {
  const donos = await tx
    .select({ id: organizacaoMembros.usuarioId })
    .from(organizacaoMembros)
    .where(
      and(
        eq(organizacaoMembros.organizacaoId, organizacaoId),
        eq(organizacaoMembros.papel, "dono"),
        eq(organizacaoMembros.ativo, true),
        ne(organizacaoMembros.usuarioId, alvoId),
      ),
    )
    .for("update");
  return donos.length > 0;
}

const SEM_DONO = "A organização precisa de pelo menos um dono ativo. Dê o papel de dono a outra pessoa antes.";

export type MudancasDoMembro = { papel?: unknown; chaves?: unknown; ativo?: unknown };

export async function atualizarMembro(id: string, mudancas: MudancasDoMembro, quemAltera: Usuario): Promise<Membro> {
  const eu = await exigirGestor(quemAltera);
  const org = eu.organizacao.id;
  const alvo = await membroPorId(org, id);
  if (!alvo) throw new MembroNaoEncontrado();
  const proprio = alvo.conta.id === eu.id;
  const souDono = eu.papel === "dono";

  // Desativar ou mexer nas chaves de um admin equivale a rebaixá-lo: só um dono.
  if (!proprio && alvo.vinculo.papel !== "membro" && !souDono) throw new SoQuemPode("Só um dono da organização altera admins e donos.");

  const novo: Partial<typeof organizacaoMembros.$inferInsert> = {};
  if (mudancas.chaves !== undefined) {
    if (!Array.isArray(mudancas.chaves)) throw new InputError("Lista de acessos inválida.");
    novo.chaves = limparChaves(mudancas.chaves);
  }
  if (mudancas.papel !== undefined && mudancas.papel !== alvo.vinculo.papel) {
    if (mudancas.papel !== "dono" && mudancas.papel !== "admin" && mudancas.papel !== "membro") throw new InputError("Papel inválido: use dono, admin ou membro.");
    novo.papel = mudancas.papel;
  }
  if (mudancas.ativo !== undefined && mudancas.ativo !== alvo.vinculo.ativo) {
    if (typeof mudancas.ativo !== "boolean") throw new InputError("Valor inválido para ativo.");
    novo.ativo = mudancas.ativo;
  }

  const deixaDeSerDonoAtivo =
    alvo.vinculo.papel === "dono" && alvo.vinculo.ativo && ((novo.papel !== undefined && novo.papel !== "dono") || novo.ativo === false);

  const atualizado = await banco().transaction(async (tx) => {
    // O último dono vem antes das outras regras: é a explicação mais útil quando o único dono tenta sair.
    if (deixaDeSerDonoAtivo && !(await sobraOutroDono(tx, org, alvo.conta.id))) throw new RegraDeMembros(SEM_DONO);
    if (proprio && novo.ativo === false) throw new RegraDeMembros("Você não pode desativar a si mesmo. Para sair, use \"Sair da organização\".");
    if (proprio && novo.papel !== undefined) throw new RegraDeMembros("Você não pode mudar o seu próprio papel.");
    if (novo.papel !== undefined && !souDono) throw new SoQuemPode("Só um dono da organização muda o papel das pessoas.");

    if (Object.keys(novo).length === 0) return alvo.vinculo;
    const [linha] = await tx
      .update(organizacaoMembros)
      .set(novo)
      .where(and(eq(organizacaoMembros.organizacaoId, org), eq(organizacaoMembros.usuarioId, alvo.conta.id)))
      .returning();
    return linha;
  });

  return paraMembro(alvo.conta, atualizado);
}

// Tira a pessoa da organização (o vínculo some; a conta e as outras organizações dela continuam).
export async function removerMembro(id: string, quemRemove: Usuario) {
  const eu = await exigirGestor(quemRemove);
  const org = eu.organizacao.id;
  const alvo = await membroPorId(org, id);
  if (!alvo) throw new MembroNaoEncontrado();
  if (alvo.conta.id === eu.id) throw new RegraDeMembros("Para sair você mesmo, use \"Sair da organização\".");
  if (alvo.vinculo.papel !== "membro" && eu.papel !== "dono") throw new SoQuemPode("Só um dono da organização remove admins e donos.");
  await banco().transaction(async (tx) => {
    if (alvo.vinculo.papel === "dono" && alvo.vinculo.ativo && !(await sobraOutroDono(tx, org, alvo.conta.id))) throw new RegraDeMembros(SEM_DONO);
    await tx.delete(organizacaoMembros).where(and(eq(organizacaoMembros.organizacaoId, org), eq(organizacaoMembros.usuarioId, alvo.conta.id)));
  });
}

// A própria pessoa sai da organização aberta. O último dono não sai (a organização ficaria sem ninguém que mande).
export async function sairDaOrganizacao(quem: Usuario) {
  const eu = await exigirNaOrganizacao(quem);
  const org = eu.organizacao.id;
  await banco().transaction(async (tx) => {
    if (eu.papel === "dono" && !(await sobraOutroDono(tx, org, eu.id))) throw new RegraDeMembros("Você é o único dono desta organização. Dê o papel de dono a outra pessoa antes de sair.");
    await tx.delete(organizacaoMembros).where(and(eq(organizacaoMembros.organizacaoId, org), eq(organizacaoMembros.usuarioId, eu.id)));
  });
}
