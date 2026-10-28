import "server-only";

import { readdir, readFile, rm, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { banco } from "@/db/cliente";
import { organizacoes } from "@/db/schema";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { comOrganizacao, ehIdDeOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { copiaSegurada, limparTemp } from "@/features/drive/servicos/arquivos";
import { driveConectado } from "@/features/drive/servicos/conta";
import {
  apagarDaMidia,
  enviarConferido,
  estadoDaMigracao,
  levarPendentesAoDrive,
  limparCopiasLocais,
  subindoAgora,
} from "@/features/drive/servicos/videos";
import type { Generation } from "@/lib/generations";
import { CONTENT_TYPES } from "@/lib/server/media";
import { montagemRodando } from "@/lib/server/montage";
import { pastaDaOrganizacao, pastaDeMidiaDa } from "@/lib/server/pastas";
import { listGenerations, updateGeneration } from "@/lib/server/store";

// Faxina dos vídeos (regra do dono: vídeo só fica guardado no Google Drive). Roda quando o servidor sobe e depois a
// cada 5 minutos (instrumentation.ts), em cada organização:
// - leva ao Drive o que ficou no disco (vídeos antigos e os que o Drive não aceitou na hora), se ela tem Drive;
// - descarta o vídeo novo que passou do prazo de 12 horas sem chegar ao Drive (a geração vira falha, com o motivo);
// - apaga as cópias locais de vídeos que já estão no Drive e os vídeos soltos na pasta de mídia (sem registro);
// e, uma vez para todas: cópias temporárias sem uso há 30 minutos e pastas de trabalho de edições interrompidas.
// Vídeo antigo (de antes da regra) de organização sem Drive NÃO é apagado: fica até ela conectar o Drive.

const A_CADA_MS = 5 * 60_000;
const PRIMEIRA_RODADA_MS = 30_000;
// Arquivo solto na pasta de mídia só sai depois disto sem mudar: pode ser um envio ou uma exportação ainda gravando.
const SOLTO_HA_MS = 60 * 60_000;
// Pasta de trabalho de edição sem edição rodando: sai depois disto (o Python cria a pasta logo depois de começar).
const PASTA_DE_TRABALHO_HA_MS = 10 * 60_000;
// Marca, no disco do hub, de quando a regra começou: arquivo solto de antes dela é sobra antiga (vai para o Drive
// antes de sair); de depois, é resto de trabalho do próprio hub (sai direto). Fica na raiz dos dados.
const marcaDaRegra = () => path.join(pastaDaOrganizacao(ORGANIZACAO_PADRAO.id), "videos-so-no-drive.json");

const EXTENSOES_DE_VIDEO = new Set([
  ...Object.entries(CONTENT_TYPES)
    .filter(([, tipo]) => tipo.startsWith("video/"))
    .map(([ext]) => ext),
  "3gp",
  "mpg",
  "mpeg",
  "wmv",
  "flv",
  "mts",
  "m2ts",
  "ogv",
]);
// Vídeo, ou o pedaço de um vídeo sendo gravado (".parcial" do envio, ".gfx.mp4" dos gráficos animados).
const ehArquivoDeVideo = (nome: string) => {
  const base = nome.replace(/\.parcial$/i, "").replace(/\.gfx\.mp4$/i, "");
  return EXTENSOES_DE_VIDEO.has((base.split(".").pop() ?? "").toLowerCase()) || base !== nome;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mensagem = (err: unknown) => (err instanceof Error ? err.message : String(err));
const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export const MOTIVO_DO_DESCARTE =
  "Este vídeo não chegou ao Google Drive em até 12 horas e foi descartado (o hub guarda vídeos só no Drive). Confira o Drive em Integrações e gere de novo.";
export const MOTIVO_SEM_ARQUIVO = "O arquivo deste vídeo não está mais no hub e não chegou ao Google Drive.";

type Estado = { relogio: ReturnType<typeof setInterval> | null; rodada: Promise<void> | null; recuperando: Set<string> };
const g = globalThis as typeof globalThis & { __hubFaxinaDosVideos?: Estado };
const estado = (): Estado => (g.__hubFaxinaDosVideos ??= { relogio: null, rodada: null, recuperando: new Set() });

// ---------- Organizações com dados no disco ----------

export type OrganizacaoDaFaxina = { id: string; nome: string };

// A padrão, as do banco e as que só têm pasta no disco (cada uma tem a própria pasta de mídia).
export async function organizacoesComDados(): Promise<OrganizacaoDaFaxina[]> {
  const todas = new Map<string, string>([[ORGANIZACAO_PADRAO.id, ORGANIZACAO_PADRAO.nome]]);
  try {
    for (const o of await banco().select({ id: organizacoes.id, nome: organizacoes.nome }).from(organizacoes)) todas.set(o.id.toLowerCase(), o.nome);
  } catch {
    // PC sem banco (só a padrão) ou banco fora do ar: as pastas do disco abaixo ainda entram.
  }
  const pastas = await readdir(path.join(pastaDaOrganizacao(ORGANIZACAO_PADRAO.id), "organizacoes")).catch(() => [] as string[]);
  for (const nome of pastas) if (ehIdDeOrganizacao(nome) && !todas.has(nome.toLowerCase())) todas.set(nome.toLowerCase(), "(sem cadastro no banco)");
  return [...todas].map(([id, nome]) => ({ id, nome }));
}

// ---------- A rodada ----------

// Liga o relógio da faxina (uma vez por processo). A primeira rodada é a "da subida": nada está em uso, então todas
// as cópias temporárias e pastas de trabalho que sobraram saem, e o registro conta o que ainda está no disco.
export function iniciarFaxinaDosVideos(): void {
  const e = estado();
  if (e.relogio) return;
  setTimeout(() => void faxinaDosVideos({ naSubida: true }), PRIMEIRA_RODADA_MS).unref?.();
  e.relogio = setInterval(() => void faxinaDosVideos(), A_CADA_MS);
  e.relogio.unref?.();
}

// Uma rodada por vez: se a anterior ainda está rodando, esta espera por ela e não faz outra.
export function faxinaDosVideos(opcoes: { naSubida?: boolean; agora?: number } = {}): Promise<void> {
  const e = estado();
  if (e.rodada) return e.rodada;
  e.rodada = rodada(opcoes)
    .catch((err) => console.error("[videos-no-drive] faxina:", mensagem(err)))
    .finally(() => {
      e.rodada = null;
    });
  return e.rodada;
}

async function rodada({ naSubida = false, agora = Date.now() }: { naSubida?: boolean; agora?: number }): Promise<void> {
  const desde = await inicioDaRegra(agora);
  // Cópias temporárias do Drive e pastas de trabalho de edição: são de todas as organizações (raiz de .data/).
  await limparTemp(naSubida ? { idadeMaximaMs: 0 } : {}).catch((err) => console.error("[videos-no-drive] cópias temporárias:", mensagem(err)));
  await limparPastasDeTrabalho(naSubida, agora);

  const resumo: string[] = [];
  for (const org of await organizacoesComDados()) {
    try {
      const linha = await comOrganizacao(org.id, () => faxinaDaOrganizacao(org, { desde, agora, naSubida }));
      if (linha) resumo.push(linha);
    } catch (err) {
      console.error(`[videos-no-drive] organização ${org.nome} (${org.id}):`, mensagem(err));
    }
  }
  if (naSubida) for (const linha of resumo) console.info(linha);
}

// Quando a regra começou neste disco (gravado na primeira rodada; nunca muda depois).
async function inicioDaRegra(agora: number): Promise<number> {
  const marca = marcaDaRegra();
  try {
    const { desde } = JSON.parse(await readFile(marca, "utf8")) as { desde?: string };
    const quando = Date.parse(desde ?? "");
    if (Number.isFinite(quando)) return quando;
  } catch {
    // primeira vez neste disco
  }
  await mkdir(path.dirname(marca), { recursive: true });
  await writeFile(marca, JSON.stringify({ desde: new Date(agora).toISOString() }));
  return agora;
}

// Pastas .data/tmp/<id da geração> (Python), <id>-gfx e <id>-camada (Remotion) de edições que não estão rodando: o
// servidor reiniciou no meio, e o Python não chegou a apagar.
async function limparPastasDeTrabalho(naSubida: boolean, agora: number): Promise<void> {
  // A raiz dos dados é a pasta da organização padrão (.data/, a mesma do lib/server/montage.ts).
  const raiz = path.join(pastaDaOrganizacao(ORGANIZACAO_PADRAO.id), "tmp");
  for (const nome of await readdir(raiz).catch(() => [] as string[])) {
    const id = nome.replace(/-(gfx|camada)$/, "");
    if (!UUID.test(id) || montagemRodando(id)) continue;
    const caminho = path.join(raiz, nome);
    const info = await stat(caminho).catch(() => null);
    if (!info?.isDirectory() || (!naSubida && agora - info.mtimeMs < PASTA_DE_TRABALHO_HA_MS)) continue;
    await rm(caminho, { recursive: true, force: true }).catch(() => undefined);
  }
}

type Contexto = { desde: number; agora: number; naSubida: boolean };

// Devolve a linha do registro da subida (o que ainda está no disco desta organização).
async function faxinaDaOrganizacao(org: OrganizacaoDaFaxina, ctx: Contexto): Promise<string | null> {
  const midia = pastaDeMidiaDa(org.id);
  // Sem pasta de dados, a organização nunca guardou nada aqui.
  if (!(await stat(pastaDaOrganizacao(org.id)).catch(() => null))) return null;

  await limparCopiasLocais();
  const gens = await listGenerations(undefined, { incluirForaDoDrive: true });
  await descartarVencidos(gens, midia, ctx.agora);

  const conectado = await driveConectado();
  if (conectado) await levarPendentesAoDrive();

  // O que ficou: vídeos com registro esperando o Drive e vídeos soltos (sem registro).
  const usados = new Set(gens.map((x) => x.file).filter(Boolean) as string[]);
  const esperando = await videosEsperando(midia);
  const soltos = await soltosNaMidia(midia, usados, ctx);
  if (conectado && soltos.antigos.length) recuperarSoltos(org, soltos.antigos);

  if (!ctx.naSubida) return null;
  const situacao = conectado ? "Drive conectado" : "SEM Drive conectado (nada foi apagado)";
  return (
    `[videos-no-drive] subida · organização ${org.nome} (${org.id}): ${situacao}; ` +
    `${esperando.quantos} vídeos com registro no disco do hub (${mb(esperando.bytes)})` +
    `${conectado && esperando.quantos ? ", indo para o Drive agora" : ""}; ` +
    `${soltos.antigos.length} vídeos soltos antigos (${mb(soltos.bytesAntigos)})` +
    `${conectado && soltos.antigos.length ? ", indo para a pasta Recuperados do hub" : ""}; ` +
    `${soltos.apagados} restos de trabalho apagados (${mb(soltos.bytesApagados)}).`
  );
}

// Vídeo novo que passou do prazo sem chegar ao Drive: sai do disco e a geração vira falha. Vídeo pronto sem arquivo
// em lugar nenhum (nem no disco nem no Drive) também vira falha, para a tela não ficar esperando para sempre.
// Vídeo antigo (sem o prazo) com o arquivo no disco não é tocado aqui.
async function descartarVencidos(gens: Generation[], midia: string, agora: number): Promise<void> {
  for (const gen of gens) {
    if (gen.kind !== "video" || gen.status !== "done" || gen.drive || !gen.file || subindoAgora(gen.id)) continue;
    const caminho = path.join(midia, path.basename(gen.file));
    const noDisco = Boolean((await stat(caminho).catch(() => null))?.isFile());
    const prazo = typeof gen.params.prazoNoHub === "string" ? Date.parse(gen.params.prazoNoHub) : NaN;
    const venceu = Number.isFinite(prazo) && prazo <= agora;
    if (noDisco && !venceu) continue;
    if (noDisco && copiaSegurada(caminho)) continue;
    const params = { ...gen.params };
    delete params.paraDrive;
    delete params.prazoNoHub;
    await updateGeneration(gen.id, { status: "failed", error: noDisco ? MOTIVO_DO_DESCARTE : MOTIVO_SEM_ARQUIVO, file: undefined, params });
    if (noDisco) {
      await apagarDaMidia(gen.file);
      console.warn(`[videos-no-drive] vídeo ${gen.id} descartado: não chegou ao Drive em até 12 horas.`);
    }
  }
}

// Vídeos com registro ainda no disco (os antigos e os que esperam o Drive), para o registro da subida.
async function videosEsperando(midia: string): Promise<{ quantos: number; bytes: number }> {
  let quantos = 0;
  let bytes = 0;
  for (const gen of await listGenerations(undefined, { incluirForaDoDrive: true })) {
    if (gen.kind !== "video" || gen.drive || !gen.file) continue;
    const info = await stat(path.join(midia, path.basename(gen.file))).catch(() => null);
    if (!info?.isFile()) continue;
    quantos++;
    bytes += info.size;
  }
  return { quantos, bytes };
}

type Solto = { nome: string; caminho: string; tamanho: number; quando: number };

// Vídeos na pasta de mídia sem nenhuma geração apontando para eles. Os de depois do começo da regra são restos de
// trabalho do próprio hub e saem; os de antes (sobras antigas) ficam para ir ao Drive antes de sair.
async function soltosNaMidia(midia: string, usados: Set<string>, ctx: Contexto) {
  const antigos: Solto[] = [];
  let bytesAntigos = 0;
  let apagados = 0;
  let bytesApagados = 0;
  for (const nome of await readdir(midia).catch(() => [] as string[])) {
    if (usados.has(nome) || !ehArquivoDeVideo(nome)) continue;
    const caminho = path.join(midia, nome);
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile() || copiaSegurada(caminho)) continue;
    if (info.mtimeMs < ctx.desde && !/\.(parcial|gfx\.mp4)$/i.test(nome)) {
      antigos.push({ nome, caminho, tamanho: info.size, quando: info.mtimeMs });
      bytesAntigos += info.size;
      continue;
    }
    if (ctx.agora - info.mtimeMs < SOLTO_HA_MS) continue; // ainda gravando, talvez
    // Confere de novo logo antes: uma geração pode ter acabado de ganhar este arquivo.
    if ((await listGenerations(undefined, { incluirForaDoDrive: true })).some((x) => x.file === nome)) continue;
    await unlink(caminho).then(
      () => {
        apagados++;
        bytesApagados += info.size;
      },
      () => undefined,
    );
  }
  return { antigos, bytesAntigos, apagados, bytesApagados };
}

// Sobras antigas vão para "Recuperados do hub" no Drive, uma por vez e em segundo plano; cada uma só sai do disco
// depois de conferida lá (tamanho e impressão digital). Não roda junto com a migração (as duas sobem vídeos grandes).
function recuperarSoltos(org: OrganizacaoDaFaxina, soltos: Solto[]): void {
  const e = estado();
  if (e.recuperando.has(org.id)) return;
  e.recuperando.add(org.id);
  void (async () => {
    if ((await estadoDaMigracao()).rodando) return;
    let levados = 0;
    let bytes = 0;
    let falhas = 0;
    let ultimoErro = "";
    for (const s of soltos) {
      const atual = await stat(s.caminho).catch(() => null);
      if (!atual?.isFile() || atual.size !== s.tamanho || copiaSegurada(s.caminho)) continue;
      const ext = (s.nome.split(".").pop() ?? "mp4").toLowerCase();
      const dia = new Date(s.quando).toISOString().slice(0, 10);
      try {
        await enviarConferido(s.caminho, { nome: `Recuperado do hub ${dia} ${s.nome}`, pasta: "recuperados", mimeType: CONTENT_TYPES[ext] ?? "video/mp4" });
        await unlink(s.caminho);
        levados++;
        bytes += s.tamanho;
      } catch (err) {
        falhas++;
        ultimoErro = mensagem(err);
      }
    }
    console.info(
      `[videos-no-drive] organização ${org.nome} (${org.id}): ${levados} de ${soltos.length} vídeos soltos antigos levados para ` +
        `"Recuperados do hub" no Drive, conferidos e apagados do hub (${mb(bytes)} liberados); ${falhas} com erro${ultimoErro ? ` (último: ${ultimoErro})` : ""}.`,
    );
  })()
    .catch((err) => console.error(`[videos-no-drive] recuperar soltos de ${org.nome}:`, mensagem(err)))
    .finally(() => e.recuperando.delete(org.id));
}

// Só para os testes: desliga o relógio e esquece o estado.
export async function zerarFaxinaDosVideos() {
  const e = estado();
  if (e.relogio) clearInterval(e.relogio);
  await e.rodada?.catch(() => undefined);
  g.__hubFaxinaDosVideos = undefined;
}
