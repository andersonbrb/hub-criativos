import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { chavesApi, organizacoes, usuarios } from "@/db/schema";
import { ehAdmin, SemPermissao, type Usuario } from "@/features/acesso/contrato";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { NOME_MAXIMO, NOME_MINIMO, PREFIXO_DA_CHAVE, TAMANHO_DO_COMECO, type ChaveNaTela } from "@/features/api/contrato";
import { hashDe, novo } from "@/features/conector/servicos/segredos";
import { InputError } from "@/lib/server/http";

// Chaves de API da organização aberta (tela "Chaves de API") e a conferência da chave que outro sistema manda.
// Criar e revogar: só o dono ou um admin. A chave em texto existe só na resposta de criarChave.

function exigirAdmin(usuario: Usuario) {
  if (ehAdmin(usuario) && usuario.ativo && usuario.organizacao?.situacao === "ativa") return;
  const erro = new SemPermissao();
  erro.message = "Só o dono ou um admin da organização cria e revoga chaves de API.";
  throw erro;
}

function nomeValido(nome: unknown): string {
  const limpo = typeof nome === "string" ? nome.replace(/\s+/g, " ").trim() : "";
  if (limpo.length < NOME_MINIMO || limpo.length > NOME_MAXIMO) {
    throw new InputError(`Dê um nome à chave, de ${NOME_MINIMO} a ${NOME_MAXIMO} letras (ex.: "Skala — produção").`);
  }
  return limpo;
}

const paraTela = (l: typeof chavesApi.$inferSelect, criadaPor: string | null): ChaveNaTela => ({
  id: l.id,
  nome: l.nome,
  comeco: l.comeco,
  criadaEm: l.criadaEm.toISOString(),
  criadaPor,
  ultimoUsoEm: l.ultimoUsoEm?.toISOString() ?? null,
  revogadaEm: l.revogadaEm?.toISOString() ?? null,
});

export async function criarChave(nome: unknown, usuario: Usuario): Promise<{ chave: string; registro: ChaveNaTela }> {
  exigirAdmin(usuario);
  const texto = novo(PREFIXO_DA_CHAVE);
  const [linha] = await banco()
    .insert(chavesApi)
    .values({
      organizacaoId: await organizacaoAtual(),
      nome: nomeValido(nome),
      comeco: texto.slice(0, TAMANHO_DO_COMECO),
      tokenHash: hashDe(texto),
      criadaPor: usuario.id,
    })
    .returning();
  return { chave: texto, registro: paraTela(linha, usuario.nome) };
}

// As chaves da organização aberta, mais novas primeiro (as revogadas também, para a trilha). Só dono ou admin.
export async function listarChaves(usuario: Usuario): Promise<ChaveNaTela[]> {
  exigirAdmin(usuario);
  const linhas = await banco()
    .select({ chave: chavesApi, criadaPor: usuarios.nome })
    .from(chavesApi)
    .leftJoin(usuarios, eq(usuarios.id, chavesApi.criadaPor))
    .where(eq(chavesApi.organizacaoId, await organizacaoAtual()))
    .orderBy(desc(chavesApi.criadaEm));
  return linhas.map((l) => paraTela(l.chave, l.criadaPor));
}

// Revoga na hora. false: a chave não existe nesta organização (ou já estava revogada).
export async function revogarChave(id: string, usuario: Usuario): Promise<boolean> {
  exigirAdmin(usuario);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const revogadas = await banco()
    .update(chavesApi)
    .set({ revogadaEm: new Date(), revogadaPor: usuario.id })
    .where(and(eq(chavesApi.id, id), eq(chavesApi.organizacaoId, await organizacaoAtual()), isNull(chavesApi.revogadaEm)))
    .returning({ id: chavesApi.id });
  return revogadas.length > 0;
}

export type ChaveConferida = { id: string; nome: string; organizacaoId: string; organizacao: string };

// A chave que outro sistema mandou: vale se existe, não foi revogada e a organização dela está ativa. Marca o uso.
export async function conferirChave(texto: string, agora = new Date()): Promise<ChaveConferida | null> {
  if (!texto.startsWith(PREFIXO_DA_CHAVE) || texto.length > 200) return null;
  const [linha] = await banco()
    .select({ id: chavesApi.id, nome: chavesApi.nome, organizacaoId: chavesApi.organizacaoId, organizacao: organizacoes.nome })
    .from(chavesApi)
    .innerJoin(organizacoes, eq(organizacoes.id, chavesApi.organizacaoId))
    .where(and(eq(chavesApi.tokenHash, hashDe(texto)), isNull(chavesApi.revogadaEm), eq(organizacoes.situacao, "ativa")))
    .limit(1);
  if (!linha) return null;
  await banco().update(chavesApi).set({ ultimoUsoEm: agora }).where(eq(chavesApi.id, linha.id));
  return linha;
}
