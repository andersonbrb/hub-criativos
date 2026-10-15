import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { sessoes, usuarios } from "@/db/schema";
import { DURACAO_DA_SESSAO_SEGUNDOS, type Usuario } from "@/features/acesso/contrato";
import { paraUsuario } from "@/features/acesso/servicos/usuarios";

// Sessões do site, sem nada do Next: recebem o token puro e falam só com o banco. Os wrappers que leem o cookie
// ficam em sessao.ts. Assim dá para testar tudo com o Postgres em memória.

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const DURACAO_MS = DURACAO_DA_SESSAO_SEGUNDOS * 1000;

export type MetaDaSessao = { ip?: string | null; navegador?: string | null };

// Token aleatório de 32 bytes. Só o SHA-256 dele vai para o banco: quem lê o banco não consegue entrar.
export const novoToken = () => randomBytes(32).toString("base64url");
export const hashDoToken = (token: string) => createHash("sha256").update(token).digest("hex");

const tokenComFormato = (token: unknown): token is string => typeof token === "string" && /^[\w-]{20,100}$/.test(token);

export async function criarSessao(usuarioId: string, meta: MetaDaSessao = {}) {
  const token = novoToken();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + DURACAO_MS);
  await banco()
    .insert(sessoes)
    .values({
      usuarioId,
      tokenHash: hashDoToken(token),
      expiraEm,
      ultimoUsoEm: agora,
      ip: meta.ip?.slice(0, 100) ?? null,
      navegador: meta.navegador?.slice(0, 300) ?? null,
    });
  await banco().update(usuarios).set({ ultimoAcessoEm: agora }).where(eq(usuarios.id, usuarioId));
  return { token, expiraEm };
}

// Pessoa dona do token, ou null (token desconhecido, sessão vencida ou conta desativada).
// Usou depois de mais de 1 dia? Empurra o vencimento para mais 30 dias e marca o último acesso da conta.
export async function usuarioPeloToken(token: string | null | undefined, agora = new Date()): Promise<Usuario | null> {
  if (!tokenComFormato(token)) return null;
  const [linha] = await banco()
    .select({ sessao: sessoes, usuario: usuarios })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashDoToken(token)), gt(sessoes.expiraEm, agora)))
    .limit(1);
  if (!linha || !linha.usuario.ativo) return null;

  if (agora.getTime() - linha.sessao.ultimoUsoEm.getTime() > UM_DIA_MS) {
    await banco()
      .update(sessoes)
      .set({ ultimoUsoEm: agora, expiraEm: new Date(agora.getTime() + DURACAO_MS) })
      .where(eq(sessoes.id, linha.sessao.id));
    await banco().update(usuarios).set({ ultimoAcessoEm: agora }).where(eq(usuarios.id, linha.usuario.id));
  }
  return paraUsuario(linha.usuario);
}

export async function encerrarSessao(token: string | null | undefined) {
  if (!tokenComFormato(token)) return;
  await banco().delete(sessoes).where(eq(sessoes.tokenHash, hashDoToken(token)));
}

// Derruba todas as sessões da pessoa (conta desativada ou senha trocada pelo script).
export async function encerrarSessoesDe(usuarioId: string) {
  await banco().delete(sessoes).where(eq(sessoes.usuarioId, usuarioId));
}
