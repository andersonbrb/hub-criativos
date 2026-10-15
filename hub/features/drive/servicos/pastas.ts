import "server-only";

import { PASTA_RAIZ, PASTAS, type PastaDoDrive } from "@/features/drive/contrato";
import { esquecerTokenDeAcesso, tokenDeAcesso } from "@/features/drive/servicos/conta";

// Base do Drive: a chamada à API (token, novo token no 401, erros em português) e as pastas do hub.
// arquivos.ts usa as duas. Ficam aqui, e não em arquivos.ts, para os dois módulos não dependerem um do outro.

export const API_DRIVE = "https://www.googleapis.com/drive/v3";
export const UPLOAD_DRIVE = "https://www.googleapis.com/upload/drive/v3";
const MIME_PASTA = "application/vnd.google-apps.folder";

// Erro do Google já traduzido. `status` 0 = o Google nem respondeu (rede).
export class ErroDoDrive extends Error {
  readonly status: number;
  constructor(mensagem: string, status: number, opcoes?: ErrorOptions) {
    super(mensagem, opcoes);
    this.name = "ErroDoDrive";
    this.status = status;
  }
}

// Chama a API com o token da conta. O token pode vencer no meio do caminho (num envio longo, por exemplo): no 401
// pede o token de novo uma vez e repete. Por isso o corpo precisa poder ser reenviado (texto ou bytes, nunca stream).
export async function chamarDrive(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenDeAcesso();
  const resposta = await chamarComToken(url, init, token);
  if (resposta.status !== 401) return resposta;
  await descartar(resposta);
  // O token guardado pode ter sido revogado antes de vencer: descarta ESTE token (não um já renovado por outra
  // chamada) e pede outro ao Google.
  await esquecerTokenDeAcesso(token);
  return chamarComToken(url, init, await tokenDeAcesso());
}

async function chamarComToken(url: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(url, { ...init, headers });
  } catch (erro) {
    if (init.signal?.aborted) throw erro;
    // A mensagem do fetch não traz o token; mesmo assim só a causa original vai junto, sem cabeçalhos.
    throw new ErroDoDrive("Sem conexão com o Google Drive. Confira a internet e tente de novo.", 0, { cause: erro });
  }
}

// Libera a conexão de uma resposta cujo corpo não interessa.
export async function descartar(resposta: Response): Promise<void> {
  await resposta.body?.cancel().catch(() => undefined);
}

// Transforma uma resposta de erro do Google numa mensagem legível. `acao`: "enviar o vídeo", "abrir o vídeo"...
export async function erroDoDrive(resposta: Response, acao: string): Promise<ErroDoDrive> {
  let motivo = "";
  let detalhe = "";
  try {
    const json = (await resposta.json()) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
    motivo = json.error?.errors?.[0]?.reason ?? json.error?.status ?? "";
    detalhe = (json.error?.message ?? "").slice(0, 200);
  } catch {
    // Corpo vazio ou fora do JSON: fica só o status.
  }
  const s = resposta.status;
  const mensagem =
    s === 401
      ? "O Google não aceitou o login do Drive. Um admin precisa conectar de novo em Integrações → Google Drive."
      : s === 404
        ? `Não deu para ${acao}: o arquivo ou a pasta não existe mais no Google Drive.`
        : motivo === "storageQuotaExceeded"
          ? "O Google Drive está sem espaço. Libere espaço na conta para guardar novos vídeos."
          : s === 429 || /rateLimitExceeded/i.test(motivo)
            ? `O Google Drive pediu uma pausa (muitos pedidos seguidos) e não deu para ${acao}. Tente de novo em instantes.`
            : s === 403
              ? `O Google Drive negou o acesso para ${acao}${detalhe ? ` (${detalhe})` : ""}.`
              : s >= 500
                ? `O Google Drive está instável agora e não deu para ${acao}. Tente de novo em instantes.`
                : `Não deu para ${acao} no Google Drive (erro ${s}${detalhe ? `: ${detalhe}` : ""}).`;
  return new ErroDoDrive(mensagem, s);
}

// ---------- Pastas ----------
// "Hub de Criativos" na raiz do Drive e uma subpasta por tipo (PASTAS). Os ids ficam na memória do servidor; antes
// de usar um id guardado, confere se a pasta ainda existe (a pessoa pode ter apagado ou mandado para a lixeira).

type ChaveDaPasta = PastaDoDrive | "raiz";

const ids = new Map<ChaveDaPasta, string>();
// Uma promessa por pasta: dois envios ao mesmo tempo esperam a mesma busca/criação em vez de criar duas pastas.
const garantindo = new Map<ChaveDaPasta, Promise<string>>();

// Id da subpasta do tipo, dentro de "Hub de Criativos". Cria o que faltar.
export async function pastaDoDrive(pasta: PastaDoDrive): Promise<string> {
  if (!(pasta in PASTAS)) throw new Error(`Tipo de pasta desconhecido no Drive: ${pasta}.`);
  const raiz = await garantir("raiz", PASTA_RAIZ, "root");
  return garantir(pasta, PASTAS[pasta], raiz);
}

// Esquece os ids guardados (ex.: outra conta Google foi conectada). A próxima chamada procura de novo.
export function esquecerPastas(): void {
  ids.clear();
}

function garantir(chave: ChaveDaPasta, nome: string, pai: string): Promise<string> {
  const emAndamento = garantindo.get(chave);
  if (emAndamento) return emAndamento;
  const promessa = (async () => {
    const guardado = ids.get(chave);
    if (guardado && (await aindaValida(guardado, pai))) return guardado;
    ids.delete(chave);
    const id = (await procurar(nome, pai)) ?? (await criar(nome, pai, chave));
    ids.set(chave, id);
    return id;
  })().finally(() => garantindo.delete(chave));
  garantindo.set(chave, promessa);
  return promessa;
}

// A pasta guardada ainda serve? Some se foi apagada (404), está na lixeira ou não está mais dentro da pasta-mãe
// (a raiz do hub foi recriada, por exemplo). A raiz pode ter sido movida pela pessoa: continua valendo.
async function aindaValida(id: string, pai: string): Promise<boolean> {
  const resposta = await chamarDrive(`${API_DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed,parents`);
  if (resposta.status === 404) {
    await descartar(resposta);
    return false;
  }
  if (!resposta.ok) throw await erroDoDrive(resposta, "conferir a pasta do hub");
  const pasta = (await resposta.json()) as { trashed?: boolean; parents?: string[] };
  return !pasta.trashed && (pai === "root" || (pasta.parents ?? []).includes(pai));
}

// Texto entre aspas simples na busca do Drive.
const literal = (texto: string) => `'${texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function procurar(nome: string, pai: string): Promise<string | null> {
  const q = [`name = ${literal(nome)}`, `mimeType = '${MIME_PASTA}'`, "trashed = false", `${literal(pai)} in parents`].join(" and ");
  // Se houver duas com o mesmo nome (criadas antes desta proteção), fica sempre a mais antiga.
  const busca = new URLSearchParams({ q, fields: "files(id)", spaces: "drive", orderBy: "createdTime", pageSize: "1" });
  const resposta = await chamarDrive(`${API_DRIVE}/files?${busca}`);
  if (!resposta.ok) throw await erroDoDrive(resposta, "procurar a pasta do hub");
  const lista = (await resposta.json()) as { files?: { id: string }[] };
  return lista.files?.[0]?.id ?? null;
}

async function criar(nome: string, pai: string, chave: ChaveDaPasta): Promise<string> {
  const resposta = await chamarDrive(`${API_DRIVE}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: nome, mimeType: MIME_PASTA, parents: [pai], appProperties: { hub: "pasta", chave } }),
  });
  if (!resposta.ok) throw await erroDoDrive(resposta, `criar a pasta "${nome}"`);
  return ((await resposta.json()) as { id: string }).id;
}
