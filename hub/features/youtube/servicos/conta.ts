import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, inArray, lt } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { youtubeConta, youtubeEnvios, youtubePedidosLogin } from "@/db/schema";
import { caminhoSeguro } from "@/features/acesso/contrato";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { lerChave } from "@/features/integracoes/servicos/chaves";
import { cifrar, decifrar, problemaNaChave } from "@/features/integracoes/servicos/cifra";
import { linkDoCanal, type CanalDoYoutube, type StatusYoutube } from "@/features/youtube/contrato";
import type { MotivoDoLogin } from "@/features/youtube/tela/avisos";
import { InputError } from "@/lib/server/http";

// A origem pública do pedido é calculada como no Drive (atrás do proxy do Railway, request.url traz o endereço interno).
export { origemPublica } from "@/features/drive/servicos/conta";

// Canal do YouTube de cada organização (login OAuth do Google na tela Integrações).
//
// Aproveita o que o Drive já tem: o mesmo cliente OAuth do Google (colado no card do Google Drive), a mesma cifra
// dos tokens (HUB_CHAVE_SEGREDOS) e o mesmo jeito de logar (PKCE + state guardado no banco, volta só para quem
// pediu, na mesma organização). A conexão é separada da do Drive: o canal pode ser de outra conta Google ou de uma
// conta de marca, escolhida na própria tela do Google.
//
// Escopos: youtube.upload (enviar vídeos e miniaturas) e youtube.readonly (ler o nome do canal e conferir como o
// YouTube processou o vídeo). Nada que apague ou mude o que já está no canal.

export class YoutubeNaoConectado extends InputError {
  constructor() {
    super("O YouTube não está conectado nesta organização. Um admin precisa conectar em Integrações → YouTube.");
  }
}

// O canal está no banco, mas o hub não consegue abrir os tokens (HUB_CHAVE_SEGREDOS sumiu ou mudou).
export class YoutubeSemChave extends YoutubeNaoConectado {
  constructor(motivo: string) {
    super();
    this.message = `${motivo} A conexão com o YouTube precisa ser refeita em Integrações → YouTube.`;
  }
}

// Falha ao falar com o Google/YouTube, já com a mensagem em linguagem simples (vai como está para a tela).
// `passageira`: rede caída ou Google instável; o envio espera um pouco e tenta de novo. As outras param na hora.
export class ErroDoYoutube extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly passageira = false,
  ) {
    super(message);
    this.name = "ErroDoYoutube";
  }
}

export class ErroNoLoginDoYoutube extends Error {
  constructor(
    public motivo: MotivoDoLogin,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Endereços e prazos

const AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOGAR = "https://oauth2.googleapis.com/revoke";
export const API_YOUTUBE = "https://www.googleapis.com/youtube/v3";
const MEU_CANAL = `${API_YOUTUBE}/channels?part=snippet&mine=true`;

export const ESCOPO_ENVIO = "https://www.googleapis.com/auth/youtube.upload";
export const ESCOPO_LEITURA = "https://www.googleapis.com/auth/youtube.readonly";
const ESCOPOS = [ESCOPO_ENVIO, ESCOPO_LEITURA];

export const CAMINHO_DE_VOLTA = "/api/integracoes/youtube/callback";

const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;
const MARGEM_DE_RENOVACAO_MS = 2 * 60_000;
const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" };

// ---------------------------------------------------------------------------------------------------------------
// Configuração

async function clienteDoGoogle(): Promise<{ id: string; segredo: string } | null> {
  const [id, segredo] = await Promise.all([lerChave("google-client-id"), lerChave("google-client-secret")]);
  return id && segredo ? { id, segredo } : null;
}

function bancoOuNada(): Banco | null {
  try {
    return banco();
  } catch {
    return null;
  }
}

// O que falta no servidor para conectar o YouTube (texto para o card), ou null quando dá para conectar.
export async function oQueFaltaParaConectar(): Promise<string | null> {
  if (!(await clienteDoGoogle()))
    return "Falta colar o ID e a chave secreta do cliente do Google, no card do Google Drive. O YouTube usa o mesmo cliente.";
  const chave = problemaNaChave();
  if (chave) return chave;
  if (!bancoOuNada()) return "O YouTube precisa do banco do hub, que só existe no hub da nuvem. Conecte por lá.";
  return null;
}

export function enderecoDeVolta(origem: string): string {
  const base = (process.env.HUB_PUBLIC_URL?.trim() || origem).replace(/\/+$/, "");
  return `${base}${CAMINHO_DE_VOLTA}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Memória do processo, uma por organização (renovação do token: uma por vez).

type Memoria = { renovacao: Promise<string> | null; token: { valor: string; expiraEm: number } | null; recusado: string | null };

const g = globalThis as typeof globalThis & { __hubYoutube?: Map<string, Memoria> };
const memorias = () => (g.__hubYoutube ??= new Map());
function memoria(org: string): Memoria {
  let m = memorias().get(org);
  if (!m) memorias().set(org, (m = { renovacao: null, token: null, recusado: null }));
  return m;
}

export function zerarMemoriaDoYoutube(org?: string) {
  if (org) memorias().delete(org);
  else g.__hubYoutube = undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Conversa com o Google

type RespostaDeToken = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string; error_description?: string };

export async function chamarGoogle(url: string, init?: RequestInit, prazoMs = 30_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(prazoMs) });
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new ErroDoYoutube("Não deu para falar com o YouTube agora. Confira a internet do servidor e tente de novo.", 0, true);
  }
}

async function lerJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

// Erro no formato das APIs do Google: { error: { code, message, errors: [{ reason }], status, details } }.
export type ErroDoGoogle = { status: number; motivo: string; mensagem: string };

export async function lerErroDoGoogle(res: Response): Promise<ErroDoGoogle> {
  const dados = await lerJson<{
    error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } | string;
    error_description?: string;
  }>(res);
  const erro = typeof dados.error === "object" ? dados.error : null;
  const motivo = erro?.errors?.[0]?.reason ?? erro?.details?.find((d) => d.reason)?.reason ?? erro?.status ?? (typeof dados.error === "string" ? dados.error : "");
  const mensagem = (erro?.message ?? dados.error_description ?? "").slice(0, 300);
  return { status: res.status, motivo: motivo ?? "", mensagem };
}

// A API do YouTube não está ligada no projeto do Google Cloud do cliente OAuth.
export const apiDesligada = (e: ErroDoGoogle) => /accessNotConfigured|SERVICE_DISABLED/i.test(e.motivo) || /has not been used in project|is disabled/i.test(e.mensagem);

const descrever = (dados: RespostaDeToken, status: number) =>
  [dados.error, dados.error_description].filter(Boolean).join(": ").slice(0, 200) || `status ${status}`;

async function revogarNoGoogle(token: string): Promise<boolean> {
  try {
    const res = await chamarGoogle(REVOGAR, { method: "POST", headers: FORMULARIO, body: new URLSearchParams({ token }) });
    return res.ok;
  } catch {
    return false;
  }
}

async function revogarGuardado(tokenCifrado: string) {
  let token: string;
  try {
    token = decifrar(tokenCifrado);
  } catch {
    console.error("[youtube] não deu para revogar no Google: o token guardado não abre com a chave atual.");
    return;
  }
  if (!(await revogarNoGoogle(token))) console.error("[youtube] o Google não confirmou a revogação; a conexão saiu do hub mesmo assim.");
}

// ---------------------------------------------------------------------------------------------------------------
// Banco

async function lerConta(org: string) {
  const db = bancoOuNada();
  if (!db) return null;
  const [linha] = await db.select().from(youtubeConta).where(eq(youtubeConta.organizacaoId, org)).limit(1);
  return linha ?? null;
}

const canalDaLinha = (linha: typeof youtubeConta.$inferSelect): CanalDoYoutube => ({
  id: linha.canalId,
  titulo: linha.canalTitulo,
  foto: linha.canalFoto,
  endereco: linha.canalEndereco ? `https://www.youtube.com/${linha.canalEndereco}` : linkDoCanal(linha.canalId),
});

// Canal conectado na organização aberta (sem conferir os tokens), ou null.
export async function canalConectado(): Promise<CanalDoYoutube | null> {
  const conta = await lerConta(await organizacaoAtual());
  return conta ? canalDaLinha(conta) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contaDoHub = (id: string | null | undefined) => (id && UUID.test(id) ? id : null);

// ---------------------------------------------------------------------------------------------------------------
// Status

export async function statusYoutube(): Promise<StatusYoutube> {
  const configurado = (await clienteDoGoogle()) !== null;
  const desligado: StatusYoutube = { configurado, conectado: false, canal: null };
  let conta: Awaited<ReturnType<typeof lerConta>>;
  try {
    conta = await lerConta(await organizacaoAtual());
  } catch (err) {
    console.error("[youtube] não deu para ler o canal:", err instanceof Error ? err.message : err);
    return desligado;
  }
  if (!conta) return desligado;
  const canal = canalDaLinha(conta);
  try {
    decifrar(conta.refreshTokenCifrado);
  } catch {
    // Chave trocada: mostra QUAL canal precisa de um login novo.
    return { configurado, conectado: false, canal };
  }
  return { configurado, conectado: configurado, canal };
}

// ---------------------------------------------------------------------------------------------------------------
// Login

export async function iniciarLogin(volta: string, origem: string, quem?: string | null): Promise<string> {
  const cliente = await clienteDoGoogle();
  const falta = await oQueFaltaParaConectar();
  if (!cliente || falta) throw new ErroNoLoginDoYoutube("configuracao", falta ?? "YouTube não configurado.");

  const state = randomBytes(32).toString("base64url");
  const verificador = randomBytes(48).toString("base64url");
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  const redirectUri = enderecoDeVolta(origem);

  const db = banco();
  await db.delete(youtubePedidosLogin).where(lt(youtubePedidosLogin.criadoEm, new Date(Date.now() - VALIDADE_DO_PEDIDO_MS)));
  await db.insert(youtubePedidosLogin).values({
    state,
    verifierCifrado: cifrar(verificador),
    volta: caminhoSeguro(volta, "/integracoes"),
    redirectUri,
    iniciadoPor: contaDoHub(quem),
    organizacaoId: await organizacaoAtual(),
  });

  const url = new URL(AUTORIZAR);
  url.search = new URLSearchParams({
    client_id: cliente.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPOS.join(" "),
    access_type: "offline",
    // select_account: o Google sempre mostra a lista de contas e de canais (contas de marca), para escolher o canal.
    prompt: "consent select_account",
    state,
    code_challenge: desafio,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

type CanalDoGoogle = { id?: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } };

export async function concluirLogin(code: string, state: string, quem?: string | null): Promise<string> {
  const cliente = await clienteDoGoogle();
  const falta = await oQueFaltaParaConectar();
  if (!cliente || falta) throw new ErroNoLoginDoYoutube("configuracao", falta ?? "YouTube não configurado.");

  const db = banco();
  const [pedido] = state ? await db.delete(youtubePedidosLogin).where(eq(youtubePedidosLogin.state, state)).returning() : [];
  if (!pedido || Date.now() - pedido.criadoEm.getTime() > VALIDADE_DO_PEDIDO_MS)
    throw new ErroNoLoginDoYoutube("pedido-vencido", "Retorno do Google com um state desconhecido, vencido ou já usado.");
  if (pedido.iniciadoPor && pedido.iniciadoPor !== contaDoHub(quem))
    throw new ErroNoLoginDoYoutube("outra-pessoa", "Retorno do Google aberto por uma conta do hub diferente da que pediu o login.");
  const org = pedido.organizacaoId;
  if (org !== (await organizacaoAtual())) throw new ErroNoLoginDoYoutube("outra-organizacao", "Retorno do Google aberto em outra organização que não a do pedido.");

  let verificador: string;
  try {
    verificador = decifrar(pedido.verifierCifrado);
  } catch (err) {
    throw new ErroNoLoginDoYoutube("configuracao", err instanceof Error ? err.message : "HUB_CHAVE_SEGREDOS mudou no meio do login.");
  }

  const res = await chamarGoogle(TOKEN, {
    method: "POST",
    headers: FORMULARIO,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pedido.redirectUri,
      client_id: cliente.id,
      client_secret: cliente.segredo,
      code_verifier: verificador,
    }),
  });
  const tokens = await lerJson<RespostaDeToken>(res);
  if (!res.ok || !tokens.access_token) throw new ErroNoLoginDoYoutube("google", `O Google recusou a troca do código (${descrever(tokens, res.status)}).`);

  // Na tela do Google a pessoa pode desmarcar as permissões. Sem enviar e ler o canal, a conexão não serve.
  const escopos = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  if (!ESCOPOS.every((e) => escopos.includes(e))) {
    await revogarNoGoogle(tokens.refresh_token ?? tokens.access_token);
    throw new ErroNoLoginDoYoutube("sem-permissao", "A pessoa não liberou as permissões do YouTube na tela de consentimento.");
  }
  if (!tokens.refresh_token) throw new ErroNoLoginDoYoutube("sem-renovacao", "O Google não mandou o refresh token.");

  const canalRes = await chamarGoogle(MEU_CANAL, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!canalRes.ok) {
    const erro = await lerErroDoGoogle(canalRes);
    await revogarNoGoogle(tokens.refresh_token);
    if (apiDesligada(erro)) throw new ErroNoLoginDoYoutube("api-desligada", `A YouTube Data API v3 está desligada no projeto do Google Cloud (${erro.mensagem}).`);
    throw new ErroNoLoginDoYoutube("google", `O YouTube não informou o canal (status ${erro.status}, ${erro.motivo}).`);
  }
  const { items } = await lerJson<{ items?: CanalDoGoogle[] }>(canalRes);
  const canal = items?.[0];
  if (!canal?.id) {
    await revogarNoGoogle(tokens.refresh_token);
    throw new ErroNoLoginDoYoutube("sem-canal", "A conta Google escolhida não tem canal no YouTube.");
  }

  // O mesmo canal não publica por duas organizações. Não revoga: a autorização pode ser a mesma da outra.
  const [emOutra] = await db.select({ org: youtubeConta.organizacaoId }).from(youtubeConta).where(eq(youtubeConta.canalId, canal.id)).limit(1);
  if (emOutra && emOutra.org !== org) throw new ErroNoLoginDoYoutube("canal-em-outra-organizacao", "Esse canal já está conectado em outra organização.");

  const anterior = await lerConta(org);
  const valores = {
    canalId: canal.id,
    canalTitulo: canal.snippet?.title?.trim() || "Canal do YouTube",
    canalFoto: canal.snippet?.thumbnails?.default?.url ?? null,
    canalEndereco: canal.snippet?.customUrl?.trim() || null,
    refreshTokenCifrado: cifrar(tokens.refresh_token),
    accessTokenCifrado: cifrar(tokens.access_token),
    expiraEm: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    escopos,
    conectadoPor: contaDoHub(quem) ?? pedido.iniciadoPor,
    conectadoEm: new Date(),
  };
  await db
    .insert(youtubeConta)
    .values({ organizacaoId: org, ...valores })
    .onConflictDoUpdate({ target: youtubeConta.organizacaoId, set: valores });
  zerarMemoriaDoYoutube(org);

  // Trocou de canal: a autorização do anterior não serve mais (cada canal é uma identidade própria no Google).
  if (anterior && anterior.canalId !== valores.canalId) {
    await revogarGuardado(anterior.refreshTokenCifrado);
    await cancelarPendentes(org, anterior.canalId, "Cancelado: o canal do YouTube foi trocado antes do envio.");
  }

  const destino = new URL(pedido.volta, "http://hub");
  destino.searchParams.set("youtube", "conectado");
  return `${destino.pathname}${destino.search}${destino.hash}`;
}

// Tira o canal do hub e revoga a autorização no Google. Os vídeos já enviados continuam no canal; os agendados
// deste canal são cancelados (sem a conexão eles não teriam como subir).
export async function desconectar(): Promise<void> {
  const db = bancoOuNada();
  const org = await organizacaoAtual();
  zerarMemoriaDoYoutube(org);
  if (!db) return;
  const [conta] = await db.delete(youtubeConta).where(eq(youtubeConta.organizacaoId, org)).returning();
  if (!conta) return;
  await revogarGuardado(conta.refreshTokenCifrado);
  await cancelarPendentes(org, conta.canalId, "Cancelado: o YouTube foi desconectado antes do envio.");
}

async function cancelarPendentes(org: string, canalId: string, motivo: string) {
  await banco()
    .update(youtubeEnvios)
    .set({ situacao: "cancelado", aviso: motivo, sessaoCifrada: null, atualizadoEm: new Date() })
    .where(and(eq(youtubeEnvios.organizacaoId, org), eq(youtubeEnvios.canalId, canalId), inArray(youtubeEnvios.situacao, ["agendado", "enviando"])));
}

// ---------------------------------------------------------------------------------------------------------------
// Token de acesso

// Token de acesso válido do canal da organização aberta (renova sozinho). Lança YoutubeNaoConectado.
export async function tokenDeAcesso(): Promise<string> {
  const org = await organizacaoAtual();
  const m = memoria(org);
  if (m.token && m.token.valor !== m.recusado && m.token.expiraEm - Date.now() > MARGEM_DE_RENOVACAO_MS) return m.token.valor;
  if (!m.renovacao) {
    const emAndamento: Promise<string> = obterToken(m, org).finally(() => {
      if (m.renovacao === emAndamento) m.renovacao = null;
    });
    m.renovacao = emAndamento;
  }
  return m.renovacao;
}

// O YouTube respondeu 401 a um token que ainda não tinha vencido: joga fora; o próximo tokenDeAcesso() renova.
export async function esquecerTokenDeAcesso(recusado: string): Promise<void> {
  const org = await organizacaoAtual();
  const m = memoria(org);
  m.recusado = recusado;
  if (m.token?.valor === recusado) m.token = null;
  const db = bancoOuNada();
  if (db) await db.update(youtubeConta).set({ accessTokenCifrado: null, expiraEm: null }).where(eq(youtubeConta.organizacaoId, org));
}

async function obterToken(m: Memoria, org: string): Promise<string> {
  const conta = await lerConta(org);
  if (!conta) throw new YoutubeNaoConectado();

  let guardado: string | null = null;
  let renovacao: string;
  try {
    if (conta.accessTokenCifrado && conta.expiraEm && conta.expiraEm.getTime() - Date.now() > MARGEM_DE_RENOVACAO_MS) guardado = decifrar(conta.accessTokenCifrado);
    renovacao = decifrar(conta.refreshTokenCifrado);
  } catch {
    throw new YoutubeSemChave(problemaNaChave() ?? "A chave HUB_CHAVE_SEGREDOS mudou depois que o YouTube foi conectado.");
  }
  if (guardado && guardado !== m.recusado) {
    m.token = { valor: guardado, expiraEm: conta.expiraEm!.getTime() };
    return guardado;
  }

  const cliente = await clienteDoGoogle();
  if (!cliente) throw new YoutubeNaoConectado();
  const res = await chamarGoogle(TOKEN, {
    method: "POST",
    headers: FORMULARIO,
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: renovacao, client_id: cliente.id, client_secret: cliente.segredo }),
  });
  const dados = await lerJson<RespostaDeToken>(res);
  if (!res.ok || !dados.access_token) {
    if (dados.error === "invalid_grant") {
      // A pessoa tirou o acesso do hub na conta Google, ou a autorização venceu: só um login novo resolve.
      await banco()
        .delete(youtubeConta)
        .where(and(eq(youtubeConta.organizacaoId, org), eq(youtubeConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
      zerarMemoriaDoYoutube(org);
      console.error("[youtube] o Google recusou a autorização guardada (invalid_grant); o canal foi desconectado.");
      throw new YoutubeNaoConectado();
    }
    console.error(`[youtube] o Google não renovou o acesso (${descrever(dados, res.status)}).`);
    // Cliente do Google errado ou apagado no Google Cloud: tentar de novo não resolve.
    if (dados.error === "invalid_client" || dados.error === "unauthorized_client")
      throw new ErroDoYoutube(
        "O Google recusou o cliente do Google colado em Integrações (card do Google Drive). Confira o ID e a chave secreta do cliente e use Tentar de novo.",
        res.status,
      );
    throw new ErroDoYoutube("O Google não renovou o acesso ao YouTube agora. Tente de novo em instantes.", res.status, res.status >= 500 || res.status === 429);
  }

  const expiraEm = new Date(Date.now() + (dados.expires_in ?? 3600) * 1000);
  await banco()
    .update(youtubeConta)
    .set({ accessTokenCifrado: cifrar(dados.access_token), expiraEm, ...(dados.refresh_token ? { refreshTokenCifrado: cifrar(dados.refresh_token) } : {}) })
    .where(and(eq(youtubeConta.organizacaoId, org), eq(youtubeConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
  m.token = { valor: dados.access_token, expiraEm: expiraEm.getTime() };
  return dados.access_token;
}
