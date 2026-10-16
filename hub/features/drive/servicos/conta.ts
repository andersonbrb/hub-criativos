import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { driveConta, drivePedidosLogin } from "@/db/schema";
import { caminhoSeguro } from "@/features/acesso/contrato";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import type { PastaEscolhida, StatusDrive } from "@/features/drive/contrato";
import type { MotivoDoLogin } from "@/features/drive/tela/avisos";
import { lerChave } from "@/features/integracoes/servicos/chaves";
import { cifrar, decifrar, problemaNaChave } from "@/features/integracoes/servicos/cifra";
import { InputError } from "@/lib/server/http";

// A cifra mora em features/integracoes (serve também às chaves das integrações); continua exportada daqui.
export { cifrar, decifrar };

// Conta Google do Drive (login OAuth na tela Integrações). Contrato estável: as assinaturas não mudam.
//
// Uma conta por organização (uma linha em drive_conta por organização; tudo aqui usa a organização em que o código
// está rodando, features/acesso/servicos/organizacao-atual.ts). O login é o OAuth 2.0 do Google para "aplicativo da
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

const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;
// Renova antes de vencer: um envio grande que pega o token aos 59 minutos não pode cair no meio.
const MARGEM_DE_RENOVACAO_MS = 2 * 60_000;
// O espaço muda devagar e a tela Integrações pode ser recarregada à vontade sem ir ao Google toda vez.
const VALIDADE_DO_ESPACO_MS = 60_000;

const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" };

// ---------------------------------------------------------------------------------------------------------------
// Configuração

// O cliente OAuth do Google (ID e chave secreta) é colado no card do Drive, na tela Integrações.
async function credenciais(): Promise<{ id: string; segredo: string } | null> {
  const [id, segredo] = await Promise.all([lerChave("google-client-id"), lerChave("google-client-secret")]);
  return id && segredo ? { id, segredo } : null;
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
export async function oQueFaltaParaConectar(): Promise<string | null> {
  if (!(await credenciais())) return "Falta colar abaixo o ID e a chave secreta do cliente do Google (criado uma vez no Google Cloud).";
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
// Memória do processo, uma por organização (cada uma tem a própria conta Google). Em globalThis porque o Next pode
// carregar este arquivo mais de uma vez (rotas compiladas à parte, recarga no desenvolvimento) e a renovação precisa
// ser UMA por processo e organização.

type Memoria = {
  // Renovação (ou leitura do banco) em andamento: quem pede token enquanto isso espera a mesma resposta.
  renovacao: Promise<string> | null;
  token: { valor: string; expiraEm: number } | null;
  // Último token que o Google recusou (401) antes da hora: nunca mais é devolvido, nem se uma leitura do banco
  // que começou antes da recusa terminar depois dela.
  recusado: string | null;
  espaco: { email: string; quando: number; valor: StatusDrive["espaco"] } | null;
};

const g = globalThis as typeof globalThis & { __hubDrive?: Map<string, Memoria> };
const memorias = () => (g.__hubDrive ??= new Map());
function memoria(org: string): Memoria {
  let m = memorias().get(org);
  if (!m) memorias().set(org, (m = { renovacao: null, token: null, recusado: null, espaco: null }));
  return m;
}

// Esquece o que está em memória (troca de conta e desconexão: só a organização; sem argumento, todas, para os testes).
export function zerarMemoriaDoDrive(org?: string) {
  if (org) memorias().delete(org);
  else g.__hubDrive = undefined;
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

async function lerConta(org: string) {
  const db = bancoOuNada();
  if (!db) return null;
  const [linha] = await db.select().from(driveConta).where(eq(driveConta.organizacaoId, org)).limit(1);
  return linha ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// O dono local (PC sem banco) tem id "local", que não é uma conta do banco.
const contaDoHub = (id: string | null | undefined) => (id && UUID.test(id) ? id : null);

// ---------------------------------------------------------------------------------------------------------------
// Status

export async function statusDrive(): Promise<StatusDrive> {
  const configurado = (await credenciais()) !== null;
  const desligado: StatusDrive = { configurado, conectado: false, conta: null, espaco: null, pasta: null };
  if (!configurado) return desligado;

  let conta: Awaited<ReturnType<typeof lerConta>>;
  try {
    conta = await lerConta(await organizacaoAtual());
  } catch (err) {
    // A tela Integrações não pode cair porque o banco piscou.
    console.error("[drive] não deu para ler a conta do Drive:", err instanceof Error ? err.message : err);
    return desligado;
  }
  if (!conta) return desligado;

  const quem = { email: conta.email, nome: conta.nome };
  const pasta: PastaEscolhida | null = conta.pastaId ? { id: conta.pastaId, nome: conta.pastaNome ?? "Pasta escolhida", compartilhado: Boolean(conta.pastaDriveId) } : null;
  try {
    // Num Drive compartilhado o espaço é o da empresa, não o da conta: o número da conta enganaria.
    const espaco = pasta?.compartilhado ? null : await espacoDaConta(conta.email);
    return { configurado, conectado: true, conta: quem, espaco, pasta };
  } catch (err) {
    // invalid_grant já apagou a conta; chave trocada mantém a linha e mostra QUAL conta precisa de um login novo.
    if (err instanceof DriveSemChave) return { ...desligado, conta: quem };
    if (err instanceof DriveNaoConectado) return desligado;
    // Google fora do ar ou lento: a conta continua conectada, só o espaço fica sem número.
    console.error("[drive] não deu para ler o espaço do Drive:", err instanceof Error ? err.message : err);
    return { configurado, conectado: true, conta: quem, espaco: null, pasta };
  }
}

async function espacoDaConta(email: string): Promise<StatusDrive["espaco"]> {
  const m = memoria(await organizacaoAtual());
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
  const cred = await credenciais();
  const falta = await oQueFaltaParaConectar();
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
    organizacaoId: await organizacaoAtual(),
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
  const cred = await credenciais();
  const falta = await oQueFaltaParaConectar();
  if (!cred || falta) throw new ErroNoLoginDoDrive("configuracao", falta ?? "Google Drive não configurado.");

  const db = banco();
  // Apagar ao ler: o mesmo retorno do Google não serve duas vezes.
  const [pedido] = state ? await db.delete(drivePedidosLogin).where(eq(drivePedidosLogin.state, state)).returning() : [];
  if (!pedido || Date.now() - pedido.criadoEm.getTime() > VALIDADE_DO_PEDIDO_MS)
    throw new ErroNoLoginDoDrive("pedido-vencido", "Retorno do Google com um state desconhecido, vencido ou já usado.");
  if (pedido.iniciadoPor && pedido.iniciadoPor !== contaDoHub(quem))
    throw new ErroNoLoginDoDrive("outra-pessoa", "Retorno do Google aberto por uma conta do hub diferente da que pediu o login.");
  // O Drive vai para a organização onde o login começou, e a pessoa precisa estar nela agora (trocar de organização
  // no meio do caminho conectaria a conta Google numa organização que ela não estava vendo).
  const org = pedido.organizacaoId;
  if (org !== (await organizacaoAtual()))
    throw new ErroNoLoginDoDrive("outra-organizacao", "Retorno do Google aberto em outra organização que não a do pedido.");

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

  // A mesma conta Google não guarda os vídeos de duas organizações. Não revoga: a autorização é a mesma da outra
  // organização, e revogar cortaria o Drive dela.
  const [emOutra] = await db.select({ org: driveConta.organizacaoId }).from(driveConta).where(eq(driveConta.email, perfil.email.toLowerCase())).limit(1);
  if (emOutra && emOutra.org !== org)
    throw new ErroNoLoginDoDrive("conta-em-outra-organizacao", "Essa conta Google já está conectada em outra organização.");

  const anterior = await lerConta(org);
  const outraConta = Boolean(anterior && anterior.email !== perfil.email.toLowerCase());
  const valores = {
    // Outra conta Google não enxerga a pasta escolhida pela anterior: volta para o Meu Drive até escolher de novo.
    ...(outraConta ? { pastaId: null, pastaNome: null, pastaDriveId: null } : {}),
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
    .values({ organizacaoId: org, ...valores })
    .onConflictDoUpdate({ target: driveConta.organizacaoId, set: valores });
  zerarMemoriaDoDrive(org);

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
  const org = await organizacaoAtual();
  zerarMemoriaDoDrive(org);
  if (!db) return;
  const [conta] = await db.delete(driveConta).where(eq(driveConta.organizacaoId, org)).returning();
  if (conta) await revogarGuardado(conta.refreshTokenCifrado);
}

// ---------------------------------------------------------------------------------------------------------------
// Pasta escolhida (onde fica a "Hub de Criativos"). A conferência no Google e a troca ficam em pastas.ts.

export type PastaDoHub = { id: string; nome: string; driveId: string | null };

// A pasta escolhida da organização aberta, ou null (raiz do Meu Drive).
export async function pastaEscolhida(): Promise<PastaDoHub | null> {
  const conta = await lerConta(await organizacaoAtual());
  return conta?.pastaId ? { id: conta.pastaId, nome: conta.pastaNome ?? "Pasta escolhida", driveId: conta.pastaDriveId } : null;
}

// Grava a pasta (ou null, de volta ao Meu Drive). Lança DriveNaoConectado sem conta conectada.
export async function gravarPasta(pasta: PastaDoHub | null): Promise<void> {
  const db = bancoOuNada();
  const org = await organizacaoAtual();
  if (!db || !(await lerConta(org))) throw new DriveNaoConectado();
  await db
    .update(driveConta)
    .set({ pastaId: pasta?.id ?? null, pastaNome: pasta?.nome ?? null, pastaDriveId: pasta?.driveId ?? null })
    .where(eq(driveConta.organizacaoId, org));
}

// ---------------------------------------------------------------------------------------------------------------
// Token de acesso

// Token de acesso válido (renova sozinho). Lança DriveNaoConectado.
export async function tokenDeAcesso(): Promise<string> {
  const org = await organizacaoAtual();
  const m = memoria(org);
  if (m.token && m.token.valor !== m.recusado && m.token.expiraEm - Date.now() > MARGEM_DE_RENOVACAO_MS) return m.token.valor;
  // Uma ida ao banco/Google por vez no processo: o player, os envios e a migração pedindo token juntos esperam a
  // mesma resposta, em vez de cada um gastar uma renovação.
  if (!m.renovacao) {
    const emAndamento: Promise<string> = obterToken(m, org).finally(() => {
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
  const org = await organizacaoAtual();
  const m = memoria(org);
  if (recusado) m.recusado = recusado;
  if (!recusado || m.token?.valor === recusado) m.token = null;
  const db = bancoOuNada();
  if (!db) return;
  // Com o token informado, só apaga se o do banco ainda for ele: se outro pedido já renovou, o novo fica.
  const conta = recusado ? await lerConta(org) : null;
  if (recusado && conta?.accessTokenCifrado && decifrarOuNada(conta.accessTokenCifrado) !== recusado) return;
  await db.update(driveConta).set({ accessTokenCifrado: null, expiraEm: null }).where(eq(driveConta.organizacaoId, org));
}

function decifrarOuNada(cifrado: string): string | null {
  try {
    return decifrar(cifrado);
  } catch {
    return null;
  }
}

async function obterToken(m: Memoria, org: string): Promise<string> {
  const conta = await lerConta(org);
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

  const cred = await credenciais();
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
        .where(and(eq(driveConta.organizacaoId, org), eq(driveConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
      zerarMemoriaDoDrive(org);
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
    .where(and(eq(driveConta.organizacaoId, org), eq(driveConta.refreshTokenCifrado, conta.refreshTokenCifrado)));
  m.token = { valor: dados.access_token, expiraEm: expiraEm.getTime() };
  return dados.access_token;
}
