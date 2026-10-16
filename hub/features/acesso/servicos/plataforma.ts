import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { convites, organizacaoMembros, organizacoes, usuarios } from "@/db/schema";
import {
  normalizarNomeDaOrganizacao,
  NOME_DA_ORGANIZACAO_MAXIMO,
  ORGANIZACAO_PADRAO,
  SemPermissao,
  type OrganizacaoDaPlataforma,
  type Usuario,
} from "@/features/acesso/contrato";
import { RegraDeMembros } from "@/features/acesso/erros";
import { gravarConvite } from "@/features/acesso/servicos/convites";
import { ehUuid } from "@/features/acesso/servicos/membros";
import { normalizarEmail, normalizarNome, podeSerDono } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Tela Plataforma (como no Cifra): quem opera a plataforma cria organizações, muda o nome e suspende. Não dá acesso aos
// dados de nenhuma: para entrar numa organização, o operador precisa ser convidado como qualquer pessoa (ou se
// convidar como primeiro dono, ao criar).

// Quem pede, como está AGORA no banco (a marca pode ter sido tirada depois de a sessão abrir).
async function exigirOperador(quem: Usuario) {
  const [conta] = await banco().select().from(usuarios).where(eq(usuarios.id, quem.id)).limit(1);
  if (!conta?.operaPlataforma || !podeSerDono(conta.email)) throw new SemPermissao();
  return conta;
}

export async function listarOrganizacoes(quem: Usuario): Promise<OrganizacaoDaPlataforma[]> {
  await exigirOperador(quem);
  const [orgs, membros, donos, pendentes] = await Promise.all([
    banco().select().from(organizacoes).orderBy(asc(organizacoes.nome)),
    banco()
      .select({ org: organizacaoMembros.organizacaoId, n: count() })
      .from(organizacaoMembros)
      .where(eq(organizacaoMembros.ativo, true))
      .groupBy(organizacaoMembros.organizacaoId),
    banco()
      .select({ org: organizacaoMembros.organizacaoId, nome: usuarios.nome })
      .from(organizacaoMembros)
      .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
      .where(and(eq(organizacaoMembros.papel, "dono"), eq(organizacaoMembros.ativo, true))),
    banco().select({ org: convites.organizacaoId, n: count() }).from(convites).where(isNull(convites.usadoEm)).groupBy(convites.organizacaoId),
  ]);
  return orgs.map((o) => ({
    id: o.id,
    nome: o.nome,
    situacao: o.situacao,
    criadoEm: o.criadoEm.toISOString(),
    membros: membros.find((m) => m.org === o.id)?.n ?? 0,
    donos: donos.filter((d) => d.org === o.id).map((d) => d.nome),
    convitesPendentes: pendentes.find((p) => p.org === o.id)?.n ?? 0,
    padrao: o.id === ORGANIZACAO_PADRAO.id,
  }));
}

function dadosDoDono(entrada: { email?: unknown; nome?: unknown }) {
  const email = normalizarEmail(entrada.email);
  if (!email) throw new InputError("Informe o e-mail de quem vai ser o dono da organização.");
  const nome = entrada.nome === undefined || entrada.nome === null || entrada.nome === "" ? null : normalizarNome(entrada.nome);
  if (entrada.nome && !nome) throw new InputError("O nome pode ter até 100 caracteres.");
  return { email, nome };
}

// Cria a organização vazia e o convite do primeiro dono. O link aparece só nesta resposta.
export async function criarOrganizacao(entrada: { nome?: unknown; email?: unknown; nomeDoDono?: unknown }, quem: Usuario) {
  const operador = await exigirOperador(quem);
  const nome = normalizarNomeDaOrganizacao(entrada.nome);
  if (!nome) throw new InputError(`Informe o nome da organização (até ${NOME_DA_ORGANIZACAO_MAXIMO} caracteres).`);
  const dono = dadosDoDono({ email: entrada.email, nome: entrada.nomeDoDono });
  const [org] = await banco().insert(organizacoes).values({ nome, criadoPor: operador.id }).returning();
  const { link } = await gravarConvite({ organizacaoId: org.id, email: dono.email, nome: dono.nome, papel: "dono", chaves: [], criadoPor: operador.id });
  return { organizacao: (await listarOrganizacoes(quem)).find((o) => o.id === org.id)!, link };
}

// Novo link de dono (o primeiro dono perdeu o link, ou a organização ficou sem ninguém que mande).
export async function convidarDono(id: string, entrada: { email?: unknown; nome?: unknown }, quem: Usuario) {
  const operador = await exigirOperador(quem);
  if (!ehUuid(id)) throw new InputError("Organização não encontrada.");
  const [org] = await banco().select().from(organizacoes).where(eq(organizacoes.id, id)).limit(1);
  if (!org) throw new InputError("Organização não encontrada.");
  const dono = dadosDoDono(entrada);
  const [vinculo] = await banco()
    .select({ ativo: organizacaoMembros.ativo })
    .from(organizacaoMembros)
    .innerJoin(usuarios, eq(usuarios.id, organizacaoMembros.usuarioId))
    .where(and(eq(organizacaoMembros.organizacaoId, id), eq(usuarios.email, dono.email)))
    .limit(1);
  if (vinculo) throw new RegraDeMembros(`${dono.email} já faz parte de ${org.nome}. Mudar o papel é com um dono dela, na tela Equipe.`);
  const { link } = await gravarConvite({ organizacaoId: id, email: dono.email, nome: dono.nome, papel: "dono", chaves: [], criadoPor: operador.id });
  return { link };
}

export async function alterarOrganizacao(id: string, mudancas: { nome?: unknown; situacao?: unknown }, quem: Usuario) {
  await exigirOperador(quem);
  if (!ehUuid(id)) throw new InputError("Organização não encontrada.");
  const novo: Partial<typeof organizacoes.$inferInsert> = {};
  if (mudancas.nome !== undefined) {
    const nome = normalizarNomeDaOrganizacao(mudancas.nome);
    if (!nome) throw new InputError(`Informe o nome da organização (até ${NOME_DA_ORGANIZACAO_MAXIMO} caracteres).`);
    novo.nome = nome;
  }
  if (mudancas.situacao !== undefined) {
    if (mudancas.situacao !== "ativa" && mudancas.situacao !== "suspensa") throw new InputError("Situação inválida: use ativa ou suspensa.");
    // A organização de quem opera a plataforma não para: sem ela, ninguém administraria o hub.
    if (mudancas.situacao === "suspensa" && id === ORGANIZACAO_PADRAO.id) throw new RegraDeMembros("Esta é a organização da plataforma e não pode ser suspensa.");
    novo.situacao = mudancas.situacao;
  }
  if (!Object.keys(novo).length) throw new InputError("Nada para mudar.");
  const atualizadas = await banco().update(organizacoes).set(novo).where(eq(organizacoes.id, id)).returning({ id: organizacoes.id });
  if (!atualizadas.length) throw new InputError("Organização não encontrada.");
  return (await listarOrganizacoes(quem)).find((o) => o.id === id)!;
}
