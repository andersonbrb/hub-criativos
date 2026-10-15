import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { driveConta, drivePedidosLogin } from "@/db/schema";
import { caminhoSeguro } from "@/features/acesso/contrato";
import type { StatusDrive } from "@/features/drive/contrato";
import type { MotivoDoLogin } from "@/features/drive/tela/avisos";
import { InputError } from "@/lib/server/http";

// Conta Google do Drive (login OAuth na tela Integrações). Contrato estável: as assinaturas não mudam.
//
// Uma conta só para o hub inteiro (linha única em drive_conta). O login é o OAuth 2.0 do Google para "aplicativo da
// Web" (com client_secret) mais PKCE e state. Escopo drive.file: o hub só enxerga os arquivos que ele mesmo criou, e
// por isso o Google não exige verificação do app (o login não vence a cada 7 dias).
//
// Os tokens ficam cifrados no banco (AES-256-GCM com HUB_CHAVE_SEGREDOS). Sem essa chave o hub se recusa a
// conectar: gravar a autorização permanente do Drive em texto puro não é opção.

// InputError: a rota responde 400 com a mensagem (é algo que um admin resolve, não uma falha do servidor).
export class DriveNaoConectado extends InputError {
  constructor() {
    super("O Google Drive não está conectado. Um admin precisa conectar em Integrações → Google Drive.");
  }
}

// A conta está no banco, mas o hub não consegue abrir os tokens (HUB_CHAVE_SEGREDOS sumiu ou mudou depois da
// conexão). Para quem chama é o mesmo que "não conectado": precisa de um login novo.
export class DriveSemChave extends DriveNaoConectado {
  constructor(motivo: string) {
    super();
    this.message = `${motivo} A conexão com o Google Drive precisa ser refeita em Integrações → Google Drive.`;
  }
}

// Login que não deu certo. `motivo` vira o aviso da tela (tela/avisos.ts); a mensagem fica para o log.
export class ErroNoLoginDoDrive extends Error {
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
const PERFIL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOGAR = "https://oauth2.googleapis.com/revoke";
const SOBRE_O_DRIVE = "https://www.googleapis.com/drive/v3/about?fields=storageQuota,user";

export const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.file";
// openid/email/profile: só para mostrar no card QUAL conta Google está conectada.
const ESCOPOS = [ESCOPO_DRIVE, "openid", "email", "profile"];

export const CAMINHO_DE_VOLTA = "/api/integracoes/google-drive/callback";

const LINHA = "unica";
const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;
// Renova antes de vencer: um envio grande que pega o token aos 59 minutos não pode cair no meio.
const MARGEM_DE_RENOVACAO_MS = 2 * 60_000;
// O espaço muda devagar e a tela Integrações pode ser recarregada à vontade sem ir ao Google toda vez.
const VALIDADE_DO_ESPACO_MS = 60_000;

const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" };

// ---------------------------------------------------------------------------------------------------------------
// Configuração

function credenciais(): { id: string; segredo: string } | null {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const segredo = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && segredo ? { id, segredo } : null;
}

function problemaNaChave(): string | null {
  const bruta = process.env.HUB_CHAVE_SEGREDOS?.trim();
  if (!bruta) return "Falta HUB_CHAVE_SEGREDOS nas variáveis do servidor: sem ela o hub não guarda a autorização do Google com segurança.";
  if (Buffer.from(bruta, "base64").length !== 32)
    return "HUB_CHAVE_SEGREDOS precisa ter 32 bytes em base64 (44 caracteres, terminando em \"=\"). Gere uma como explica docs/google-drive.md.";
  return null;
}

// banco() lança quando não há DATABASE_URL (o PC sem Postgres). Aqui isso significa só "sem conta conectada".
function bancoOuNada(): Banco | null {
  try {
    return banco();
  } catch {
    return null;
  }
}

// O que falta no servidor para conectar o Drive (texto para o card), ou null quando dá para conectar.
export function oQueFaltaParaConectar(): string | null {
  if (!credenciais()) return "Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis do servidor (passo a passo em docs/google-drive.md).";
  const chave = problemaNaChave();
  if (chave) return chave;
  if (!bancoOuNada()) return "O Google Drive precisa do banco do hub, que só existe no hub da nuvem. Conecte por lá.";
  return null;
}

// Origem pública de um pedido: atrás do proxy do Railway, request.url traz o endereço interno.
export function origemPublica(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocolo = (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")).split(",")[0].trim();
  return host ? `${protocolo}://${host}` : new URL(request.url).origin;
}

// O endereço de volta precisa estar cadastrado no cliente OAuth do Google, letra por letra.
export function enderecoDeVolta(origem: string): string {
  const base = (process.env.HUB_PUBLIC_URL?.trim() || origem).replace(/\/+$/, "");
  return `${base}${CAMINHO_DE_VOLTA}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cifra dos segredos guardados no banco (AES-256-GCM). Formato: v1.<iv>.<etiqueta>.<cifrado>, em base64url.
// O GCM confere a etiqueta ao abrir: um valor adulterado no banco não decifra, em vez de virar um token errado.

const VERSAO_DA_CIFRA = "v1";

function chaveDosSegredos(): Buffer {
  const problema = problemaNaChave();
  if (problema) throw new Error(problema);
  return Buffer.from(process.env.HUB_CHAVE_SEGREDOS!.trim(), "base64");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveDosSegredos(), iv);
  const corpo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [VERSAO_DA_CIFRA, iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), corpo.toString("base64url")].join(".");
}

export function decifrar(cifrado: string): string {
  const chave = chaveDosSegredos();
  const [versao, iv, etiqueta, corpo, ...resto] = cifrado.split(".");
  try {
    if (versao !== VERSAO_DA_CIFRA || !iv || !etiqueta || corpo === undefined || resto.length) throw new Error("formato");
    // authTagLength fixo: sem ele o Node aceitaria uma etiqueta encurtada, mais fácil de forjar.
    const decifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decifra.setAuthTag(Buffer.from(etiqueta, "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(corpo, "base64url")), decifra.final()]).toString("utf8");
  } catch {
    throw new Error("Não deu para abrir um segredo guardado no banco: a chave HUB_CHAVE_SEGREDOS não é a mesma de quando ele foi gravado.");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Memória do processo. Em globalThis porque o Next pode carregar este arquivo mais de uma vez (rotas compiladas à
// parte, recarga no desenvolvimento) e a renovação precisa ser UMA por processo.

type Memoria = {
  // Renovação (ou leitura do banco) em andamento: quem pede token enquanto isso espera a mesma resposta.
  renovacao: Promise<string> | null;
  token: { valor: string; expiraEm: number } | null;
  // Último token que o Google recusou (401) antes da hora: nunca mais é devolvido, nem se uma leitura do banco
  // que começou antes da recusa terminar depois dela.
  recusado: string | null;
  espaco: { email: string; quando: number; valor: StatusDrive["espaco"] } | null;
};

const g = globalThis as typeof globalThis & { __hubDrive?: Memoria };
const memoria = (): Memoria => (g.__hubDrive ??= { renovacao: null, token: null, recusado: null, espaco: null });

// Esquece tudo o que está em memória (troca de conta, desconexão e testes).
export function zerarMemoriaDoDrive() {
  g.__hubDrive = undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Conversa com o Google

type RespostaDeToken = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function chamarGoogle(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Não deu para falar com o Google agora. Confira a internet do servidor e tente de novo.");
  }
}

async function lerJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

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

// Revogar é cortesia com a conta Google (tira o hub de "Apps com acesso à sua conta"): se falhar, a conexão sai do
// hub do mesmo jeito.
async function revogarGuardado(tokenCifrado: string) {
  let token: string;
  try {
    token = decifrar(tokenCifrado);
  } catch {
    console.error("[drive] não deu para revogar no Google: o token guardado não abre com a chave atual.");
    return;
  }
  if (!(await revogarNoGoogle(token))) console.error("[drive] o Google não confirmou a revogação; a conexão saiu do hub mesmo assim.");
}

// ---------------------------------------------------------------------------------------------------------------
// Banco

async function lerConta() {
  const db = bancoOuNada();
  if (!db) return null;
  const [linha] = await db.select().from(driveConta).where(eq(driveConta.id, LINHA)).limit(1);
  return linha ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// O dono local (PC sem banco) tem id "local", que não é uma conta do banco.
const contaDoHub = (id: string | null | undefined) => (id && UUID.test(id) ? id : null);

// ---------------------------------------------------------------------------------------------------------------
// Status

export async function statusDrive(): Promise<StatusDrive> {
  const configurado = credenciais() !== null;
  const desligado: StatusDrive = { configurado, conectado: false, conta: null, espaco: null };
  if (!configurado) return desligado;

  let conta: Awaited<ReturnType<typeof lerConta>>;
  try {
    conta = await lerConta();
  } catch (err) {
    // A tela Integrações não pode cair porque o banco piscou.
    console.error("[drive] não deu para ler a conta do Drive:", err instanceof Error ? err.message : err);
    return desligado;
  }
  if (!conta) return desligado;

  const quem = { email: conta.email, nome: conta.nome };
  try {
    return { configurado, conectado: true, conta: quem, espaco: await espacoDaConta(conta.email) };
  } catch (err) {
    // invalid_grant já apagou a conta; chave trocada mantém a linha e mostra QUAL conta precisa de um login novo.
    if (err instanceof DriveSemChave) return { ...desligado, conta: quem };
    if (err instanceof DriveNaoConectado) return desligado;
    // Google fora do ar ou lento: a conta continua conectada, só o espaço fica sem número.
    console.error("[drive] não deu para ler o espaço do Drive:", err instanceof Error ? err.message : err);
    return { configurado, conectado: true, conta: quem, espaco: null };
  }
}

async function espacoDaConta(email: string): Promise<StatusDrive["espaco"]> {
  const m = memoria();
  if (m.espaco && m.espaco.email === email && Date.now() - m.espaco.quando < VALIDADE_DO_ESPACO_MS) return m.espaco.valor;

  const token = await tokenDeAcesso();
  const res = await chamarGoogle(SOBRE_O_DRIVE, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) await esquecerTokenDeAcesso(token);
  if (!res.ok) throw new Error(`O Google Drive respondeu ${res.status} ao informar o espaço.`);
  const { storageQuota } = await lerJson<{ storageQuota?: { usage?: string; limit?: string } }>(res);
  const usado = Number(storageQuota?.usage);
  // Sem "limit": conta com espaço ilimitado (alguns planos do Workspace).
  const limite = storageQuota?.limit ? Number(storageQuota.limit) : NaN;
  const valor = Number.isFinite(usado) ? { usado, limite: Number.isFinite(limite) ? limite : null } : null;
  m.espaco = { email, quando: Date.now(), valor };
  return valor;
}

// ---------------------------------------------------------------------------------------------------------------
// Login

// Endereço do Google para a pessoa autorizar. `volta`: caminho do hub para onde ela volta depois.
// `quem` (acréscimo ao contrato): id da conta do hub que pediu. O retorno do Google só vale para essa mesma conta.
export async function iniciarLogin(volta: string, origem: string, quem?: string | null): Promise<string> {
  const cred = credenciais();
  const falta = oQueFaltaParaConectar();
  if (!cred || falta) throw new ErroNoLoginDoDrive("configuracao", falta ?? "Google Drive não configurado.");

  const state = randomBytes(32).toString("base64url");
  const verificador = randomBytes(48).toString("base64url");
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  const redirectUri = enderecoDeVolta(origem);

  const db = banco();
  // Pedidos abandonados (a pessoa fechou a aba do Google) não ficam acumulando.
  await db.delete(drivePedidosLogin).where(lt(drivePedidosLogin.criadoEm, new Date(Date.now() - VALIDADE_DO_PEDIDO_MS)));
  await db.insert(drivePedidosLogin).values({
    state,
    verifierCifrado: cifrar(verificador),
    volta: caminhoSeguro(volta, "/integracoes"),
    redirectUri,
    iniciadoPor: contaDoHub(quem),
  });

  const url = new URL(AUTORIZAR);
  url.search = new URLSearchParams({
    client_id: cred.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPOS.join(" "),
    // offline + consent: o Google só manda o refresh token (a autorização permanente) com os dois.
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: desafio,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

// Recebe o retorno do Google; devolve o caminho para onde mandar a pessoa (com ?drive=conectado).
// `origem` não é usada: o redirect_uri da troca é o mesmo que foi ao Google, guardado no pedido.
// `quem` (acréscimo ao contrato): a conta do hub que voltou do Google; precisa ser a mesma que começou.
export async function concluirLogin(code: string, state: string, origem: string, quem?: string | null): Promise<string> {
  void origem;
  const cred = credenciais();
  const falta = oQueFaltaParaConectar();
  if (!cred || falta) throw new ErroNoLoginDoDrive("configuracao", falta ?? "Google Drive não configurado.");

  const db = banco();
  // Apagar ao ler: o mesmo retorno do Google não serve duas vezes.
  const [pedido] = state ? await db.delete(drivePedidosLogin).where(eq(drivePedidosLogin.state, state)).returning() : [];
  if (!pedido || Date.now() - pedido.criadoEm.getTime() > VALIDADE_DO_PEDIDO_MS)
    throw new ErroNoLoginDoDrive("pedido-vencido", "Retorno do Google com um state desconhecido, vencido ou já usado.");
  if (pedido.iniciadoPor && pedido.iniciadoPor !== contaDoHub(quem))
    throw new ErroNoLoginDoDrive("outra-pessoa", "Retorno do Google aberto por uma conta do hub diferente da que pediu o login.");

  let verificador: string;
  try {
    verificador = decifrar(pedido.verifierCifrado);
  } catch (err) {
    throw new ErroNoLoginDoDrive("configuracao", err instanceof Error ? err.message : "HUB_CHAVE_SEGREDOS mudou no meio do login.");
  }

  const res = await chamarGoogle(TOKEN, {
    method: "POST",
    headers: FORMULARIO,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pedido.redirectUri,
      client_id: cred.id,
      client_secret: cred.segredo,
      code_verifier: verificador,
    }),
  });
  const tokens = await lerJson<RespostaDeToken>(res);
  if (!res.ok || !tokens.access_token) throw new ErroNoLoginDoDrive("google", `O Google recusou a troca do código (${descrever(tokens, res.status)}).`);

  // Na tela do Google a pessoa pode desmarcar o Drive e liberar só o e-mail. Sem o Drive a conexão não serve.
  const escopos = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  if (!escopos.includes(ESCOPO_DRIVE)) {
    await revogarNoGoogle(tokens.refresh_token ?? tokens.access_token);
    throw new ErroNoLoginDoDrive("sem-drive", "A pessoa não liberou o Google Drive na tela de consentimento.");
  }
  if (!tokens.refresh_token) throw new ErroNoLoginDoDrive("sem-renovacao", "O Google não mandou o refresh token.");

  const perfilRes = await chamarGoogle(PERFIL, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const perfil = await lerJson<{ email?: string; name?: string }>(perfilRes);
  if (!perfilRes.ok || !perfil.email) {
    await revogarNoGoogle(tokens.refresh_token);
    throw new ErroNoLoginDoDrive("google", `O Google não informou o e-mail da conta (status ${perfilRes.status}).`);
  }

  const anterior = await lerConta();
  const valores = {
    email: perfil.email.toLowerCase(),
    nome: perfil.name?.trim() || null,
    refreshTokenCifrado: cifrar(tokens.refresh_token),
    accessTokenCifrado: cifrar(tokens.access_token),
    expiraEm: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    escopos,
    conectadoPor: contaDoHub(quem) ?? pedido.iniciadoPor,
    conectadoEm: new Date(),
  };
  await db
    .insert(driveConta)
    .values({ id: LINHA, ...valores })
    .onConflictDoUpdate({ target: driveConta.id, set: valores });
  zerarMemoriaDoDrive();

  // Trocou de conta Google: a autorização da antiga não serve mais. Na MESMA conta não se revoga: o Google tiraria o
  // acesso do hub inteiro, e a autorização nova cairia junto.
  if (anterior && anterior.email !== valores.email) await revogarGuardado(anterior.refreshTokenCifrado);

  const destino = new URL(pedido.volta, "http://hub");
  destino.searchParams.set("drive", "conectado");
  return `${destino.pathname}${destino.search}${destino.hash}`;
}

// Tira a conta do hub e revoga a autorização no Google. Os arquivos continuam no Drive da conta.
export async function desconectar(): Promise<void> {
  const db = bancoOuNada();
  zerarMemoriaDoDrive();
  if (!db) return;
  const [conta] = await db.delete(driveConta).where(eq(driveConta.id, LINHA)).returning();
  if (conta) await revogarGuardado(conta.refreshTokenCifrado);
}

// ---------------------------------------------------------------------------------------------------------------
// Token de acesso

// Token de acesso válido (renova sozinho). Lança DriveNaoConectado.
export async function tokenDeAcesso(): Promise<string> {
  const m = memoria();
  if (m.token && m.token.valor !== m.recusado && m.token.expiraEm - Date.now() > MARGEM_DE_RENOVACAO_MS) return m.token.valor;
  // Uma ida ao banco/Google por vez no processo: o player, os envios e a migração pedindo token juntos esperam a
  // mesma resposta, em vez de cada um gastar uma renovação.
  if (!m.renovacao) {
    const emAndamento: Promise<string> = obterToken(m).finally(() => {
      if (m.renovacao === emAndamento) m.renovacao = null;
    });
    m.renovacao = emAndamento;
  }
  return m.renovacao;
}

// Acréscimo ao contrato: o Drive respondeu 401 a um token que ainda não tinha vencido pelo relógio (a pessoa tirou o
// acesso na conta Google, por exemplo). Joga o token fora, na memória e no banco; o próximo tokenDeAcesso() renova
// (continua uma renovação por vez) ou, se a autorização permanente também foi cortada, desconecta e lança
// DriveNaoConectado. Uso: no 401, `await esquecerTokenDeAcesso(tokenUsado)` e peça tokenDeAcesso() de novo, uma vez.
// `recusado`: o token que levou o 401. Com ele, nem uma leitura do banco já em andamento devolve o mesmo token.
export async function esquecerTokenDeAcesso(recusado?: string): Promise<void> {
  const m = memoria();
  if (recusado) m.recusado = recusado;
  if (!recusado || m.token?.valor === recusado) m.token = null;
  const db = bancoOuNada();
  if (!db) return;
  // Com o token informado, só apaga se o do banco ainda for ele: se outro pedido já renovou, o novo fica.
  const conta = recusado ? await lerConta() : null;
  if (recusado && conta?.accessTokenCifrado && decifrarOuNada(conta.accessTokenCifrado) !== recusado) return;
  await db.update(driveConta).set({ accessTokenCifrado: null, expiraEm: null }).where(eq(driveConta.id, LINHA));
}

function decifrarOuNada(cifrado: string): string | null {
  try {
    return decifrar(cifrado);
  } catch {
    return null;
  }
}

async function obterToken(m: Memoria): Promise<string> {
  const conta = await lerConta();
  if (!conta) throw new DriveNaoConectado();

  let guardado: string | null = null;
  let renovacao: string;
  try {
    if (conta.accessTokenCifrado && conta.expiraEm && conta.expiraEm.getTime() - Date.now() > MARGEM_DE_RENOVACAO_MS)
      guardado = decifrar(conta.accessTokenCifrado);
    renovacao = decifrar(conta.refreshTokenCifrado);
  } catch {
    throw new DriveSemChave(problemaNaChave() ?? "A chave HUB_CHAVE_SEGREDOS mudou depois que o Drive foi conectado.");
  }
  if (guardado && guardado !== m.recusado) {
    m.token = { valor: guardado, expiraEm: conta.expiraEm!.getTime() };
    return guardado;
  }

  const cred = credenciais();
  if (!cred) throw new DriveNaoConectado();
  const res = await chamarGoogle(TOKEN, {
    method: "POST",
    headers: FORMULARIO,
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: renovacao, client_id: cred.id, client_secret: cred.segredo }),
  });
  const dados = await lerJson<RespostaDeToken>(res);
  if (!res.ok || !dados.access_token) {
    if (dados.error === "invalid_grant") {
      // A pessoa tirou o acesso do hub na conta Google, trocou a senha, ou a autorização venceu: só um login novo
      // resolve. Apagar a conta faz o card mostrar "Conectar" em vez de um erro que se repete a cada vídeo.
      await banco()
        .delete(driveConta)
        .where(and(eq(driveConta.id, LINHA), eq(driveConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
      zerarMemoriaDoDrive();
      console.error("[drive] o Google recusou a autorização guardada (invalid_grant); a conta foi desconectada.");
      throw new DriveNaoConectado();
    }
    throw new Error(`O Google não renovou o acesso ao Drive (${descrever(dados, res.status)}). Tente de novo em instantes.`);
  }

  const expiraEm = new Date(Date.now() + (dados.expires_in ?? 3600) * 1000);
  // Só grava se a conta ainda é a mesma: se alguém conectou outra no meio da renovação, este token é da antiga.
  await banco()
    .update(driveConta)
    .set({ accessTokenCifrado: cifrar(dados.access_token), expiraEm, ...(dados.refresh_token ? { refreshTokenCifrado: cifrar(dados.refresh_token) } : {}) })
    .where(and(eq(driveConta.id, LINHA), eq(driveConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
  m.token = { valor: dados.access_token, expiraEm: expiraEm.getTime() };
  return dados.access_token;
}
