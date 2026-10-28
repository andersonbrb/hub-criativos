import "server-only";

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { comOrganizacao, organizacaoAtual, organizacaoDoContexto } from "@/features/acesso/servicos/organizacao-atual";
import { segurarTemp, soltarTemp } from "@/features/drive/servicos/arquivos";
import { apagarDaMidia, arquivoLocal, concluirComArquivo } from "@/features/drive/servicos/videos";
import type { Trabalho } from "@/features/edicoes/contrato";
import { duracaoDoArquivo, executarTrabalho, linhaComHora, type Caminhos, type Registro } from "@/features/edicoes/servicos/executar";
import { apagarNoServidor, FalhaNoServidorDeEdicoes, rodarNoServidor, servidorDeEdicoes } from "@/features/edicoes/servicos/remoto";
import { DATA_DIR, pastaDeMidia } from "@/lib/server/pastas";
import { getGeneration, updateGeneration } from "@/lib/server/store";
import { palavrasDaFala } from "@/lib/server/video";

// O lado do site de cada edição de vídeo (edição final, batida, remover legenda, exportação do editor): guarda o
// pedido, baixa as entradas, manda para o servidor de edições (ou roda aqui, sem ele), acompanha o registro e, pronto,
// leva o vídeo para o Google Drive como sempre (concluirComArquivo).
//
// Nenhuma edição se perde num reinício (pedido do dono, 28/10/2026): o pedido fica gravado em .data/edicoes/<id>.json
// até o fim. Na subida (instrumentation.ts), o site volta a acompanhar o que está no servidor de edições, ou roda de
// novo o que estava rodando aqui.

// Logs e pedidos por id da geração (uuid), na raiz de .data/: só são lidos depois de a rota achar a geração na
// organização de quem pede.
const LOG_DIR = path.join(DATA_DIR, "montagem");
const PASTA_DOS_PEDIDOS = path.join(DATA_DIR, "edicoes");

export const logPath = (id: string) => path.join(LOG_DIR, `${id}.log`);
const arquivoDoPedido = (id: string) => path.join(PASTA_DOS_PEDIDOS, `${id}.json`);

// Edições em andamento neste processo do servidor (sobrevive ao hot reload do dev e é a mesma para a subida e as rotas).
const running: Set<string> = ((globalThis as { __montagens?: Set<string> }).__montagens ??= new Set());

// A edição desta geração está em andamento neste processo (a faxina não apaga a pasta de trabalho dela, e a tela não a
// marca como interrompida).
export const edicaoRodando = (id: string) => running.has(id);

export type PedidoDeEdicao = {
  id: string;
  // Na frente da falha ("Montagem: ..."); vazio = só a mensagem (exportação do editor).
  rotulo: string;
  outName: string;
  trabalho: Trabalho;
  // Nome da entrada → arquivo do hub (mídia ou Drive), baixado na hora de rodar (arquivoLocal).
  arquivos: Record<string, string>;
  // Edição final: as palavras da fala destas gerações (transcrição em cache ou Whisper) vão em dados.job.avatar_words.
  palavrasDe?: string[];
  // Remover legenda: a duração desta entrada vai para params.duracao (previsão de tempo da barra de progresso).
  duracaoDe?: string;
  organizacao: string | null;
  criadoEm: string;
};

// Cópias temporárias do Drive (arquivoLocal) ficam seguras da limpeza enquanto a edição trabalha: um trabalho longo
// passa horas sem tocar no arquivo. Soltas no fim, com sucesso ou com erro. Se algo impedir de soltar, a trava vence
// sozinha depois de 12 h.
const SEGURA_COPIAS_MS = 12 * 60 * 60 * 1000;

async function copiaSegura(file: string, copias: string[]): Promise<string> {
  const caminho = await arquivoLocal(file);
  segurarTemp(caminho, SEGURA_COPIAS_MS);
  copias.push(caminho);
  return caminho;
}

// Esvazia a lista: chamar duas vezes solta cada cópia uma vez só.
function soltarCopias(copias: string[]) {
  for (const caminho of copias.splice(0)) soltarTemp(caminho);
}

async function gravarPedido(p: PedidoDeEdicao) {
  await mkdir(PASTA_DOS_PEDIDOS, { recursive: true });
  const destino = arquivoDoPedido(p.id);
  await writeFile(`${destino}.tmp`, JSON.stringify(p));
  await rename(`${destino}.tmp`, destino);
}

// Começa uma edição: a geração já existe (status running). Grava o pedido e roda em segundo plano. As entradas do
// trabalho são os nomes de `arquivos`.
export async function iniciarEdicao(
  p: Omit<PedidoDeEdicao, "organizacao" | "criadoEm" | "trabalho"> & { trabalho: Omit<Trabalho, "entradas"> },
): Promise<void> {
  // Antes de qualquer espera: a tela pode consultar logo depois de criar, e não pode ver como interrompida.
  running.add(p.id);
  try {
    // O fim da edição grava na organização que pediu (a mesma da geração), mesmo horas depois ou depois de um reinício.
    const organizacao = organizacaoDoContexto() ?? (await organizacaoAtual().catch(() => null));
    const trabalho: Trabalho = { ...p.trabalho, entradas: Object.keys(p.arquivos) };
    const pedido: PedidoDeEdicao = { ...p, trabalho, organizacao, criadoEm: new Date().toISOString() };
    await mkdir(LOG_DIR, { recursive: true });
    await gravarPedido(pedido);
    void continuar(pedido, false).catch(avisarFalha(p.id));
  } catch (err) {
    running.delete(p.id);
    await updateGeneration(p.id, { status: "failed", error: `${p.rotulo || "Edição"}: não deu para começar (${err instanceof Error ? err.message : "erro"})` }).catch(() => undefined);
    throw err;
  }
}

const avisarFalha = (id: string) => (err: unknown) => console.error(`[edicoes] ${id}: a edição parou sem registrar o motivo:`, err instanceof Error ? err.message : err);

// Na subida do servidor: continua as edições que estavam em andamento quando ele parou.
export async function retomarEdicoes(): Promise<number> {
  const nomes = (await readdir(PASTA_DOS_PEDIDOS).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
  const pedidos: PedidoDeEdicao[] = [];
  for (const nome of nomes) {
    const arquivo = path.join(PASTA_DOS_PEDIDOS, nome);
    try {
      pedidos.push(JSON.parse(await readFile(arquivo, "utf8")) as PedidoDeEdicao);
    } catch {
      await rm(arquivo, { force: true }).catch(() => undefined);
    }
  }
  const novos = pedidos.filter((p) => !running.has(p.id));
  // Marca todas antes de devolver: a subida espera esta função, e só depois as telas consultam.
  for (const p of novos) running.add(p.id);
  for (const p of novos) void retomar(p).catch(avisarFalha(p.id));
  if (novos.length) console.log(`[edicoes] ${novos.length} edição(ões) em andamento antes do reinício: continuando.`);
  return novos.length;
}

async function retomar(p: PedidoDeEdicao) {
  const naOrganizacao = <T,>(fn: () => T): T => (p.organizacao ? comOrganizacao(p.organizacao, fn) : fn());
  const g = await naOrganizacao(() => getGeneration(p.id)).catch(() => undefined);
  // Apagada, ou terminou bem na hora do reinício: nada a continuar.
  if (!g || g.status !== "running") {
    running.delete(p.id);
    await rm(arquivoDoPedido(p.id), { force: true }).catch(() => undefined);
    return;
  }
  await continuar(p, true);
}

// O registro que a tela mostra: as linhas do site e, embaixo, o registro do servidor de edições (que chega inteiro a
// cada novidade). As gravações vão em fila, para a última sempre valer.
function registroDaEdicao(id: string, retomada: boolean) {
  let local = retomada ? linhaComHora("o servidor do site reiniciou; a edição continua") : "";
  let remoto = "";
  let escrita: Promise<unknown> = Promise.resolve();
  const gravar = () => {
    const texto = local + remoto;
    escrita = escrita.then(() => writeFile(logPath(id), texto)).catch(() => undefined);
  };
  // O que já veio do servidor de edições fica onde está (ele recomeça do zero, ou a edição segue no site).
  const fecharRemoto = () => {
    local += remoto;
    remoto = "";
  };
  const registro: Registro & { remoto: (texto: string) => void; fecharRemoto: () => void } = {
    bruto: (texto) => {
      local += texto;
      gravar();
    },
    linha: (m) => {
      local += linhaComHora(m);
      gravar();
    },
    remoto: (texto) => {
      remoto = texto;
      gravar();
    },
    fecharRemoto,
  };
  if (local) gravar();
  return registro;
}

// Arquivos da edição quando ela roda no site: os mesmos lugares de sempre (pasta de trabalho em .data/tmp/<id>, a do
// Remotion em .data/tmp/<id>-camada, o trabalho do Python e a linha do tempo em .data/montagem/<id>.*).
function caminhosNoSite(id: string, locais: Record<string, string>, saida: string): Caminhos {
  return {
    entrada: (nome) => {
      const caminho = locais[nome];
      if (!caminho) throw new Error(`faltou o arquivo ${nome} da edição`);
      return caminho;
    },
    saida,
    pasta: (nome) =>
      nome === "trabalho"
        ? path.join(DATA_DIR, "tmp", id)
        : nome === "camada"
          ? path.join(DATA_DIR, "tmp", `${id}-camada`)
          : path.join(LOG_DIR, nome === "job.json" ? `${id}.json` : `${id}.${nome}`),
  };
}

// Edição final: as palavras com tempo da fala ORIGINAL de cada vídeo do avatar (transcrição em cache ou Whisper, como
// no contexto do Sávio). Sem elas, o script transcreve sozinho.
async function comPalavras(p: PedidoDeEdicao): Promise<Trabalho> {
  if (!p.palavrasDe?.length) return p.trabalho;
  const avatarWords = await Promise.all(
    p.palavrasDe.map(async (id) => (await palavrasDaFala(id)).map((w) => [w.text, w.start, w.end] as const)),
  ).catch((err) => {
    console.warn(`[hub] montagem ${p.id}: palavras indisponíveis (${err instanceof Error ? err.message : err}), o script transcreve`);
    return null;
  });
  if (!avatarWords) return p.trabalho;
  return { ...p.trabalho, dados: { ...p.trabalho.dados, job: { ...(p.trabalho.dados.job as object), avatar_words: avatarWords } } };
}

async function atualizarDuracao(id: string, caminho: string) {
  const duracao = Math.round(await duracaoDoArquivo(caminho)) || null;
  const g = await getGeneration(id);
  if (g && duracao && duracao !== g.params.duracao) await updateGeneration(id, { params: { ...g.params, duracao } });
}

async function continuar(p: PedidoDeEdicao, retomada: boolean): Promise<void> {
  const naOrganizacao = <T,>(fn: () => T): T => (p.organizacao ? comOrganizacao(p.organizacao, fn) : fn());
  return naOrganizacao(async () => {
    const log = registroDaEdicao(p.id, retomada);
    const copias: string[] = [];
    try {
      const trabalho = await comPalavras(p);
      // Caminhos no disco (vídeo que está só no Google Drive vira uma cópia temporária, segura até o fim).
      const locais = Object.fromEntries(
        await Promise.all(Object.entries(p.arquivos).map(async ([nome, file]) => [nome, await copiaSegura(file, copias)] as const)),
      );
      if (p.duracaoDe && locais[p.duracaoDe]) await atualizarDuracao(p.id, locais[p.duracaoDe]);
      const midia = await pastaDeMidia();
      await mkdir(midia, { recursive: true });
      const saida = path.join(midia, p.outName);
      await rodarOndeDer(p.id, trabalho, locais, saida, log);
      soltarCopias(copias);
      running.delete(p.id);
      // Pronta, a edição segue para o Google Drive em segundo plano. Apagada durante a edição, o vídeo novo não tem
      // dono e sai na hora.
      await concluirComArquivo(p.id, { file: p.outName });
    } catch (err) {
      running.delete(p.id);
      soltarCopias(copias);
      // Com erro, o que ficou pela metade na pasta de mídia sai na hora (regra do dono: vídeo fora do Drive não fica).
      await Promise.all(["", ".gfx.mp4", ".tmp.mp4", ".parcial"].map((fim) => apagarDaMidia(`${p.outName}${fim}`)));
      const mensagem = err instanceof Error ? err.message : "erro";
      await updateGeneration(p.id, { status: "failed", error: p.rotulo ? `${p.rotulo}: ${mensagem}` : mensagem.slice(0, 400) });
    } finally {
      await rm(arquivoDoPedido(p.id), { force: true }).catch(() => undefined);
    }
  });
}

// No servidor de edições, se ele estiver configurado e responder; senão, aqui mesmo (o mesmo resultado, só que o site
// fica mais lento enquanto isso). Só a falha da própria edição (script, ffmpeg, Remotion) é final: problema de conversa
// com o servidor de edições (fora do ar, chave errada, arquivo que não chegou) faz a edição rodar no site.
async function rodarOndeDer(id: string, trabalho: Trabalho, locais: Record<string, string>, saida: string, log: ReturnType<typeof registroDaEdicao>) {
  if (servidorDeEdicoes()) {
    try {
      await rodarNoServidor(id, trabalho, locais, {
        saida,
        registro: log.remoto,
        aoReenviar: () => {
          log.fecharRemoto();
          log.linha("o servidor de edições reiniciou no meio; a edição começa de novo lá");
        },
      });
      return;
    } catch (err) {
      if (err instanceof FalhaNoServidorDeEdicoes) throw err;
      const motivo = err instanceof Error ? err.message : String(err);
      console.warn(`[edicoes] ${id}: ${motivo}; a edição roda no site`);
      log.fecharRemoto();
      log.linha(`${motivo}; a edição roda no servidor do site`);
      void apagarNoServidor(id);
    }
  }
  await executarTrabalho(trabalho, caminhosNoSite(id, locais, saida), log);
}
