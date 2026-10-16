import "server-only";

import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { PASTA_RAIZ, PASTAS, type PastaDoDrive, type PastaEscolhida } from "@/features/drive/contrato";
import { esquecerTokenDeAcesso, gravarPasta, pastaEscolhida, tokenDeAcesso } from "@/features/drive/servicos/conta";
import { InputError } from "@/lib/server/http";

// Base do Drive: a chamada à API (token, novo token no 401, erros em português) e as pastas do hub.
// arquivos.ts usa as duas. Ficam aqui, e não em arquivos.ts, para os dois módulos não dependerem um do outro.

export const API_DRIVE = "https://www.googleapis.com/drive/v3";
export const UPLOAD_DRIVE = "https://www.googleapis.com/upload/drive/v3";
const MIME_PASTA = "application/vnd.google-apps.folder";

// Drive compartilhado (o da empresa): sem supportsAllDrives o Google responde "não encontrado" para o que está num, e
// as buscas só olham o Meu Drive sem includeItemsFromAllDrives. Vai em todo pedido; no Meu Drive não muda nada.
export const TODOS_OS_DRIVES = "supportsAllDrives=true";
export const BUSCA_EM_TODOS_OS_DRIVES = { supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives" };

// Erro do Google já traduzido. `status` 0 = o Google nem respondeu (rede). `motivo` é o motivo que o Google deu
// ("rateLimitExceeded", "storageQuotaExceeded"...), ou vazio: serve para decidir se vale tentar de novo.
export class ErroDoDrive extends Error {
  readonly status: number;
  readonly motivo: string;
  constructor(mensagem: string, status: number, opcoes?: ErrorOptions & { motivo?: string }) {
    super(mensagem, opcoes);
    this.name = "ErroDoDrive";
    this.status = status;
    this.motivo = opcoes?.motivo ?? "";
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
  return new ErroDoDrive(mensagem, s, { motivo });
}

// ---------- Pastas ----------
// "Hub de Criativos" na raiz do Meu Drive, ou dentro da pasta escolhida em Integrações, e uma subpasta por tipo (PASTAS). Os ids ficam na memória do servidor; antes
// de usar um id guardado, confere se a pasta ainda existe (a pessoa pode ter apagado ou mandado para a lixeira).

type ChaveDaPasta = PastaDoDrive | "raiz";

// Memória do processo, uma por organização (cada uma tem a própria conta Google, com as próprias pastas). Em
// globalThis porque o Next pode carregar este arquivo mais de uma vez (rotas compiladas à parte, recarga no
// desenvolvimento): com um mapa por cópia do módulo, dois envios criariam duas pastas iguais.
type MemoriaDasPastas = {
  ids: Map<ChaveDaPasta, string>;
  // Uma promessa por pasta: dois envios ao mesmo tempo esperam a mesma busca/criação em vez de criar duas pastas.
  garantindo: Map<ChaveDaPasta, Promise<string>>;
};
const g = globalThis as typeof globalThis & { __hubDrivePastas?: Map<string, MemoriaDasPastas> };
const memorias = (g.__hubDrivePastas ??= new Map());
function memoriaDa(org: string): MemoriaDasPastas {
  let m = memorias.get(org);
  if (!m) memorias.set(org, (m = { ids: new Map(), garantindo: new Map() }));
  return m;
}

// Id da subpasta do tipo, dentro de "Hub de Criativos". Cria o que faltar.
export async function pastaDoDrive(pasta: PastaDoDrive): Promise<string> {
  if (!(pasta in PASTAS)) throw new Error(`Tipo de pasta desconhecido no Drive: ${pasta}.`);
  const m = memoriaDa(await organizacaoAtual());
  const raiz = await garantir(m, "raiz", PASTA_RAIZ, (await pastaEscolhida())?.id ?? "root");
  return garantir(m, pasta, PASTAS[pasta], raiz);
}

// Pasta escolhida na janela do Google (tela Integrações): confere que o hub a enxerga e consegue criar nela, grava, e já
// cria a "Hub de Criativos" lá dentro. Com o escopo drive.file, o hub só enxerga uma pasta que não criou depois que a
// pessoa a escolhe nessa janela. Se não der para criar, volta para a pasta de antes.
export async function escolherPasta(id: unknown): Promise<PastaEscolhida> {
  const limpo = typeof id === "string" ? id.trim() : "";
  if (!/^[\w-]{10,200}$/.test(limpo)) throw new InputError("Pasta inválida. Escolha de novo pela janela do Google.");
  const campos = new URLSearchParams({ fields: "id,name,mimeType,driveId,trashed,capabilities(canAddChildren)", supportsAllDrives: "true" });
  const resposta = await chamarDrive(`${API_DRIVE}/files/${encodeURIComponent(limpo)}?${campos}`);
  if (resposta.status === 404) {
    await descartar(resposta);
    throw new InputError("O Google não liberou essa pasta para o hub. Abra a janela de novo e escolha a pasta por lá.");
  }
  if (!resposta.ok) throw await erroDoDrive(resposta, "abrir a pasta escolhida");
  const achada = (await resposta.json()) as { id: string; name?: string; mimeType?: string; driveId?: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } };
  if (achada.mimeType !== MIME_PASTA || achada.trashed) throw new InputError("Escolha uma pasta, não um arquivo.");
  if (achada.capabilities?.canAddChildren === false)
    throw new InputError("A conta Google conectada não pode criar arquivos nessa pasta. Peça a quem gerencia a pasta para dar acesso de editor.");

  const anterior = await pastaEscolhida();
  const nova = { id: achada.id, nome: achada.name?.trim() || "Pasta escolhida", driveId: achada.driveId ?? null };
  await gravarPasta(nova);
  esquecerPastas();
  try {
    await garantir(memoriaDa(await organizacaoAtual()), "raiz", PASTA_RAIZ, nova.id);
  } catch (erro) {
    await gravarPasta(anterior);
    esquecerPastas();
    throw new InputError(`Não deu para criar a pasta "${PASTA_RAIZ}" dentro de "${nova.nome}". ${erro instanceof Error ? erro.message : ""}`.trim());
  }
  return { id: nova.id, nome: nova.nome, compartilhado: Boolean(nova.driveId) };
}

// Volta a guardar na raiz do Meu Drive. Os vídeos que já foram para a pasta escolhida continuam lá.
export async function voltarParaMeuDrive(): Promise<void> {
  await gravarPasta(null);
  esquecerPastas();
}

// Esquece os ids guardados, de todas as organizações (ex.: uma pasta sumiu no meio de um envio). A próxima chamada
// procura de novo (e só confere de novo nas outras organizações).
export function esquecerPastas(): void {
  for (const m of memorias.values()) m.ids.clear();
}

function garantir({ ids, garantindo }: MemoriaDasPastas, chave: ChaveDaPasta, nome: string, pai: string): Promise<string> {
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
  const resposta = await chamarDrive(`${API_DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed,parents&${TODOS_OS_DRIVES}`);
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
  const busca = new URLSearchParams({ q, fields: "incompleteSearch,files(id)", spaces: "drive", orderBy: "createdTime", pageSize: "1", ...BUSCA_EM_TODOS_OS_DRIVES });
  const resposta = await chamarDrive(`${API_DRIVE}/files?${busca}`);
  if (!resposta.ok) throw await erroDoDrive(resposta, "procurar a pasta do hub");
  const lista = (await resposta.json()) as { incompleteSearch?: boolean; files?: { id: string }[] };
  const id = lista.files?.[0]?.id ?? null;
  // Busca pela metade sem achar: criar agora poderia duplicar a pasta. O vídeo fica no hub e sobe na próxima vez.
  if (!id && lista.incompleteSearch) throw new ErroDoDrive("O Google Drive não terminou de procurar a pasta do hub. Tente de novo em instantes.", 200);
  return id;
}

async function criar(nome: string, pai: string, chave: ChaveDaPasta): Promise<string> {
  const resposta = await chamarDrive(`${API_DRIVE}/files?fields=id&${TODOS_OS_DRIVES}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: nome, mimeType: MIME_PASTA, parents: [pai], appProperties: { hub: "pasta", chave } }),
  });
  if (!resposta.ok) throw await erroDoDrive(resposta, `criar a pasta "${nome}"`);
  return ((await resposta.json()) as { id: string }).id;
}
