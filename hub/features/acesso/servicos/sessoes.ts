import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { sessoes, usuarios } from "@/db/schema";
import { DURACAO_DA_SESSAO_SEGUNDOS, type Usuario } from "@/features/acesso/contrato";
import { escolherOrganizacao, paraUsuario, vinculoDe } from "@/features/acesso/servicos/usuarios";

// Sessões do site, sem nada do Next: recebem o token puro e falam só com o banco. Os wrappers que leem o cookie
// ficam em sessao.ts. Assim dá para testar tudo com o Postgres em memória.
// Cada sessão guarda a organização aberta (a pessoa troca pelo menu).

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const DURACAO_MS = DURACAO_DA_SESSAO_SEGUNDOS * 1000;

export type MetaDaSessao = { ip?: string | null; navegador?: string | null };

// Token aleatório de 32 bytes. Só o SHA-256 dele vai para o banco: quem lê o banco não consegue entrar.
export const novoToken = () => randomBytes(32).toString("base64url");
export const hashDoToken = (token: string) => createHash("sha256").update(token).digest("hex");

const tokenComFormato = (token: unknown): token is string => typeof token === "string" && /^[\w-]{20,100}$/.test(token);

// organizacaoId: onde a sessão abre (ex.: a do convite recém-aceito). Sem ela, a última aberta pela pessoa.
export async function criarSessao(usuarioId: string, meta: MetaDaSessao = {}, organizacaoId?: string | null) {
  const token = novoToken();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + DURACAO_MS);
  const organizacao = await escolherOrganizacao(usuarioId, organizacaoId);
  await banco()
    .insert(sessoes)
    .values({
      usuarioId,
      organizacaoId: organizacao,
      tokenHash: hashDoToken(token),
      expiraEm,
      ultimoUsoEm: agora,
      ip: meta.ip?.slice(0, 100) ?? null,
      navegador: meta.navegador?.slice(0, 300) ?? null,
    });
  await banco()
    .update(usuarios)
    .set({ ultimoAcessoEm: agora, ...(organizacao ? { ultimaOrganizacaoId: organizacao } : {}) })
    .where(eq(usuarios.id, usuarioId));
  return { token, expiraEm, organizacaoId: organizacao };
}

// Pessoa dona do token, vista na organização aberta da sessão, ou null (token desconhecido ou sessão vencida).
// Saiu, foi removida ou desativada na organização aberta (ou ela foi suspensa)? A sessão passa sozinha para outra
// organização ativa da pessoa. Sem nenhuma, volta a pessoa sem organização (a tela "sem acesso" explica).
// Usou depois de mais de 1 dia? Empurra o vencimento para mais 30 dias e marca o último acesso da conta.
export async function usuarioPeloToken(token: string | null | undefined, agora = new Date()): Promise<Usuario | null> {
  if (!tokenComFormato(token)) return null;
  const [linha] = await banco()
    .select({ sessao: sessoes, usuario: usuarios })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashDoToken(token)), gt(sessoes.expiraEm, agora)))
    .limit(1);
  if (!linha) return null;

  let vinculo = await vinculoDe(linha.usuario.id, linha.sessao.organizacaoId);
  if (!vinculo?.membro.ativo || vinculo.org.situacao !== "ativa") {
    const outra = await escolherOrganizacao(linha.usuario.id);
    if (outra && outra !== linha.sessao.organizacaoId) {
      await banco().update(sessoes).set({ organizacaoId: outra }).where(eq(sessoes.id, linha.sessao.id));
      vinculo = await vinculoDe(linha.usuario.id, outra);
    }
  }

  if (agora.getTime() - linha.sessao.ultimoUsoEm.getTime() > UM_DIA_MS) {
    await banco()
      .update(sessoes)
      .set({ ultimoUsoEm: agora, expiraEm: new Date(agora.getTime() + DURACAO_MS) })
      .where(eq(sessoes.id, linha.sessao.id));
    await banco().update(usuarios).set({ ultimoAcessoEm: agora }).where(eq(usuarios.id, linha.usuario.id));
  }
  return paraUsuario(linha.usuario, vinculo?.membro, vinculo?.org);
}

// Troca a organização aberta nesta sessão. Só para uma organização ativa em que a pessoa está ativa.
// Devolve false quando não dá (a rota explica).
export async function trocarOrganizacaoDaSessao(token: string | null | undefined, usuarioId: string, organizacaoId: string): Promise<boolean> {
  if (!tokenComFormato(token)) return false;
  const destino = await escolherOrganizacao(usuarioId, organizacaoId);
  if (destino !== organizacaoId) return false;
  const trocadas = await banco()
    .update(sessoes)
    .set({ organizacaoId })
    .where(and(eq(sessoes.tokenHash, hashDoToken(token)), eq(sessoes.usuarioId, usuarioId)))
    .returning({ id: sessoes.id });
  if (!trocadas.length) return false;
  await banco().update(usuarios).set({ ultimaOrganizacaoId: organizacaoId }).where(eq(usuarios.id, usuarioId));
  return true;
}

export async function encerrarSessao(token: string | null | undefined) {
  if (!tokenComFormato(token)) return;
  await banco().delete(sessoes).where(eq(sessoes.tokenHash, hashDoToken(token)));
}

// Derruba todas as sessões da pessoa (senha trocada pelo script).
export async function encerrarSessoesDe(usuarioId: string) {
  await banco().delete(sessoes).where(eq(sessoes.usuarioId, usuarioId));
}
