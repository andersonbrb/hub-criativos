import { and, eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { organizacaoMembros, organizacoes, usuarios } from "@/db/schema";
import { ORGANIZACAO_PADRAO, type Chave, type Papel, type Usuario } from "@/features/acesso/contrato";
import { gerarHashDeSenha } from "@/features/acesso/servicos/senha";
import { usuarioNaOrganizacao } from "@/features/acesso/servicos/usuarios";

// Contas e organizações prontas para os testes, gravadas direto no banco. O banco de teste nasce do schema (sem as
// migrações), então a organização padrão é criada aqui quando falta.

export async function garantirOrganizacaoPadrao() {
  await banco().insert(organizacoes).values({ id: ORGANIZACAO_PADRAO.id, nome: ORGANIZACAO_PADRAO.nome }).onConflictDoNothing();
  return ORGANIZACAO_PADRAO.id;
}

export async function criarOrganizacao(nome = "Outra Empresa", situacao: "ativa" | "suspensa" = "ativa") {
  const [org] = await banco().insert(organizacoes).values({ nome, situacao }).returning();
  return org.id;
}

type Vinculo = { papel?: Papel; chaves?: Chave[]; ativo?: boolean };

export async function vincular(usuarioId: string, organizacaoId: string, dados: Vinculo = {}) {
  const vinculo = { papel: dados.papel ?? "membro", chaves: dados.chaves ?? [], ativo: dados.ativo ?? true };
  await banco()
    .insert(organizacaoMembros)
    .values({ organizacaoId, usuarioId, ...vinculo })
    .onConflictDoUpdate({ target: [organizacaoMembros.organizacaoId, organizacaoMembros.usuarioId], set: vinculo });
}

// Muda o papel, as chaves ou a situação da pessoa numa organização (a padrão, se não disser).
export async function mudarVinculo(usuarioId: string, dados: Vinculo, organizacaoId: string = ORGANIZACAO_PADRAO.id) {
  await banco()
    .update(organizacaoMembros)
    .set(dados)
    .where(and(eq(organizacaoMembros.usuarioId, usuarioId), eq(organizacaoMembros.organizacaoId, organizacaoId)));
}

// Conta pronta, já na organização (a padrão, se não disser), vista dentro dela.
export async function criarConta(
  dados: {
    email: string;
    nome?: string;
    papel?: Papel;
    chaves?: Chave[];
    senha?: string | null;
    ativo?: boolean;
    organizacaoId?: string | null;
    operaPlataforma?: boolean;
  },
): Promise<Usuario> {
  const org = dados.organizacaoId === null ? null : (dados.organizacaoId ?? (await garantirOrganizacaoPadrao()));
  const [linha] = await banco()
    .insert(usuarios)
    .values({
      email: dados.email,
      nome: dados.nome ?? dados.email.split("@")[0],
      senhaHash: dados.senha === null ? null : await gerarHashDeSenha(dados.senha ?? "senha-de-teste-123"),
      operaPlataforma: dados.operaPlataforma ?? false,
    })
    .returning();
  if (org) await vincular(linha.id, org, dados);
  return (await usuarioNaOrganizacao(linha.id, org))!;
}
