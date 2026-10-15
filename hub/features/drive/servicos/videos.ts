import "server-only";

import { access, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type { ArquivoDrive, PastaDoDrive } from "@/features/drive/contrato";
import { abrirTrecho, ArquivoForaDoDrive, baixarParaTemp, enviarArquivo, moverParaLixeira, renomear, situacao } from "@/features/drive/servicos/arquivos";
import { DriveNaoConectado } from "@/features/drive/servicos/conta";
import { downloadName, type Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { CONTENT_TYPES, MEDIA_DIR } from "@/lib/server/media";
import { getGeneration, listGenerations, updateGeneration } from "@/lib/server/store";

// Ponte entre as gerações do hub e o Drive. Contrato estável: as assinaturas não mudam.
//
// Os vídeos gerados (edições, exportações do editor, traduções, b-rolls do FLORA, avatares do HeyGen e as entregas do
// Claude Code) moram SÓ no Drive. O hub guarda o registro (a geração, com `drive.id`) e serve o vídeo pelo mesmo
// /api/media/<file> de sempre, buscando no Drive. Imagens, áudios e arquivos enviados pelas pessoas ficam no disco.
//
// O caminho de um vídeo: fica pronto no disco (ffmpeg, Python, download da ferramenta) → guardarNoDrive sobe para a
// pasta do tipo → a geração ganha `drive` → a cópia local é apagada. Até o envio terminar, o arquivo local serve.

const ESPERA_DO_ESPELHO_MS = 60_000;
// Cópia local que alguém acabou de pedir (ffmpeg, Python) não é apagada logo depois do envio: um script da montagem
// pode passar horas lendo o vídeo. A limpeza do espelho apaga depois desse prazo.
const SEGURA_MS = 6 * 60 * 60 * 1000;

const mensagem = (err: unknown) => (err instanceof Error ? err.message : String(err));
const existe = (caminho: string) => access(caminho).then(() => true, () => false);
const extensao = (file: string) => (file.split(".").pop() ?? "").toLowerCase();

// Estado do processo (sobrevive ao hot reload do dev, como as montagens em lib/server/montage.ts).
type Memoria = {
  envios: Map<string, Promise<Resultado>>;
  emUso: Map<string, number>;
  espelho: { ultima: number; emCurso: Promise<void> | null };
  migracao: EstadoDaMigracao;
};
const memoria: Memoria = ((globalThis as { __videosNoDrive?: Memoria }).__videosNoDrive ??= {
  envios: new Map(),
  emUso: new Map(),
  espelho: { ultima: 0, emCurso: null },
  migracao: { rodando: false, total: 0, feitos: 0, falhas: 0, ultimoErro: null },
});

// ---------- Que vídeo vai para qual pasta ----------

// Pasta do Drive de uma geração; null = fica no disco do hub (imagens, áudios, anexos das pessoas).
export function pastaDaGeracao(g: Generation): PastaDoDrive | null {
  if (g.kind !== "video") return null;
  switch (g.tool) {
    case "montagem":
      return g.params.formato === "batida" ? "batida" : g.params.formato === "sem-legenda" ? "sem-legenda" : "edicao-final";
    case "editor":
      return "editor";
    case "heygen-traducao":
      return "traducao";
    case "flora":
      return "broll";
    case "heygen":
      return "avatar";
    case "higgsfield":
      return "outros";
    case "upload":
      // Só as entregas do Claude Code (link de envio do conector). Vídeo anexado no chat, editor, Fluxo ou tradução
      // é material de quem enviou e continua no disco.
      return g.params.origem === "conector" ? "entregas" : null;
    default:
      return null;
  }
}

// Pronto, com arquivo no disco, ainda não levado e de uma pasta do Drive.
export const vaiParaODrive = (g: Generation) => g.status === "done" && Boolean(g.file) && !g.drive && pastaDaGeracao(g) !== null;

// ---------- Levar para o Drive ----------

type Resultado = { geracao: Generation; erro?: string; naoConectado?: boolean };

// Leva o vídeo pronto de uma geração para o Drive e apaga a cópia local. Sem Drive conectado, deixa local e
// marca para levar depois (não perde o vídeo).
// Nunca lança: a geração já está pronta e não pode virar falha por causa do Drive.
export async function guardarNoDrive(gen: Generation): Promise<Generation> {
  if (!vaiParaODrive(gen)) return gen;
  return (await enviar(gen)).geracao;
}

// Para os pontos onde o vídeo fica pronto: o envio pode levar minutos (vídeo de centenas de MB) e quem chamou não
// espera. A geração só aparece com `drive` quando o envio termina; até lá, o arquivo local serve.
export function guardarNoDriveEmSegundoPlano(gen: Generation | undefined): void {
  if (!gen || !vaiParaODrive(gen)) return;
  guardarNoDrive(gen).catch((err) => console.error(`[drive] vídeo ${gen.id}:`, mensagem(err)));
}

// Uma promessa por geração: o refreshGeneration pode rodar duas vezes ao mesmo tempo (a tela e o chat conferindo o
// mesmo job), e a migração pode passar por um vídeo que já está subindo. Todos esperam o mesmo envio.
function enviar(gen: Generation): Promise<Resultado> {
  let envio = memoria.envios.get(gen.id);
  if (!envio) {
    envio = levar(gen).finally(() => memoria.envios.delete(gen.id));
    memoria.envios.set(gen.id, envio);
  }
  return envio;
}

async function levar(original: Generation): Promise<Resultado> {
  try {
    // Relê: quem chamou pode ter uma cópia antiga (outro envio já terminou, ou a geração foi apagada).
    const gen = await getGeneration(original.id);
    if (!gen) return { geracao: original };
    if (!vaiParaODrive(gen)) return { geracao: gen };
    const pasta = pastaDaGeracao(gen)!;
    const nomeLocal = path.basename(gen.file!);
    const caminho = path.join(MEDIA_DIR, nomeLocal);
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile()) return { geracao: gen, erro: "O arquivo do vídeo não está no disco do hub." };

    let arquivo: ArquivoDrive;
    try {
      arquivo = await enviarArquivo(caminho, { nome: downloadName(gen), pasta, mimeType: CONTENT_TYPES[extensao(nomeLocal)] ?? "video/mp4" });
    } catch (err) {
      const naoConectado = err instanceof DriveNaoConectado;
      console.warn(`[drive] o vídeo ${gen.id} ficou no disco do hub e vai para o Drive depois: ${mensagem(err)}`);
      const marcada = gen.params.paraDrive === true ? gen : ((await updateGeneration(gen.id, { params: { ...gen.params, paraDrive: true } })) ?? gen);
      return { geracao: marcada, erro: mensagem(err), naoConectado };
    }

    const params: Generation["params"] = { ...gen.params, tamanhoNoDrive: info.size };
    delete params.paraDrive;
    const salva = await updateGeneration(gen.id, { drive: { id: arquivo.id, pasta }, params });
    if (!salva) {
      // Apagada no hub durante o envio: o arquivo novo no Drive ficaria sem dono. Vai para a lixeira de lá.
      await moverParaLixeira(arquivo.id).catch((err) => console.warn(`[drive] não consegui tirar do Drive o vídeo ${arquivo.id}, apagado no hub:`, mensagem(err)));
      await unlink(caminho).catch(() => undefined);
      return { geracao: original };
    }
    // Renomeado no hub durante o envio (o PATCH ainda não via o Drive): o Drive acompanha o nome atual.
    const nome = downloadName(salva);
    if (arquivo.nome && arquivo.nome !== nome) await renomear(arquivo.id, nome).catch((err) => console.warn(`[drive] não consegui renomear ${arquivo.id}:`, mensagem(err)));
    // Só agora a cópia local sai. Em uso (ffmpeg, Python), fica para a limpeza do espelho.
    if (!segurado(nomeLocal)) {
      await unlink(caminho).catch((err) => console.warn(`[drive] a cópia local de ${nomeLocal} fica para a próxima limpeza:`, mensagem(err)));
    }
    return { geracao: salva };
  } catch (err) {
    console.error(`[drive] vídeo ${original.id}:`, mensagem(err));
    return { geracao: original, erro: mensagem(err) };
  }
}

// ---------- Ler o vídeo ----------

// Geração dona de um arquivo de mídia (o `file`), inclusive as escondidas pelo espelho.
export async function geracaoDoArquivo(file: string): Promise<Generation | undefined> {
  const nome = path.basename(file);
  return (await listGenerations(undefined, { incluirForaDoDrive: true })).find((g) => g.file === nome);
}

function segurar(nome: string) {
  memoria.emUso.set(nome, Date.now() + SEGURA_MS);
}

function segurado(nome: string) {
  const ate = memoria.emUso.get(nome);
  if (ate === undefined) return false;
  if (ate > Date.now()) return true;
  memoria.emUso.delete(nome);
  return false;
}

// Caminho local de um arquivo de mídia pelo nome (o `file` da geração): se está só no Drive, baixa uma cópia
// temporária. Todo código que lê mídia do disco (ffmpeg, Python, sharp, envio ao HeyGen/FLORA) passa por aqui.
export async function arquivoLocal(file: string): Promise<string> {
  const nome = path.basename(file);
  const local = path.join(MEDIA_DIR, nome);
  // Marca antes de conferir: um envio ao Drive terminando agora não apaga o arquivo que vai ser lido.
  segurar(nome);
  if (await existe(local)) return local;
  memoria.emUso.delete(nome);
  const gen = await geracaoDoArquivo(nome);
  if (gen?.foraDoDrive) throw new InputError("Esse vídeo foi apagado no Drive.");
  // Sem Drive: devolve o caminho de sempre e quem chamou dá o erro de arquivo não encontrado, como antes.
  if (!gen?.drive) return local;
  try {
    return await baixarParaTemp(gen.drive.id, extensao(nome));
  } catch (err) {
    if (err instanceof ArquivoForaDoDrive) throw new InputError("Esse vídeo foi apagado no Drive.");
    throw err;
  }
}

// Vídeo inteiro do Drive em stream (zip do card, link de download do conector), sem cópia no disco.
export async function lerDoDrive(gen: Generation): Promise<{ corpo: ReadableStream<Uint8Array>; tamanho: number | null }> {
  if (!gen.drive) throw new Error("Esse vídeo não está no Drive.");
  const trecho = await abrirTrecho(gen.drive.id, null);
  if (!trecho.corpo || trecho.status === 416) throw new Error("O Google Drive não devolveu o vídeo. Tente de novo.");
  const tamanho = Object.entries(trecho.cabecalhos).find(([k]) => k.toLowerCase() === "content-length")?.[1];
  return { corpo: trecho.corpo, tamanho: tamanho && /^\d+$/.test(tamanho) ? Number(tamanho) : null };
}

// ---------- Apagar e renomear pelo hub ----------

// Apagar no hub manda o vídeo para a lixeira do Drive (dá para recuperar lá por 30 dias). Se o Drive falhar, lança
// um erro legível e quem chamou não apaga o registro.
export async function tirarDoDrive(gen: Generation): Promise<void> {
  if (!gen.drive || gen.foraDoDrive) return;
  try {
    await moverParaLixeira(gen.drive.id);
  } catch (err) {
    throw new Error(`Não consegui mandar o vídeo para a lixeira do Google Drive, então ele não foi apagado. ${mensagem(err)}`, { cause: err });
  }
}

// Renomear no hub renomeia no Drive (nome + extensão, o mesmo do download). `gen` já com o nome novo.
export async function renomearNoDrive(antes: Generation, depois: Generation): Promise<void> {
  if (!antes.drive || antes.foraDoDrive) return;
  const nome = downloadName(depois);
  if (nome === downloadName(antes)) return;
  try {
    await renomear(antes.drive.id, nome);
  } catch (err) {
    throw new Error(`Não consegui renomear o vídeo no Google Drive, então o nome não mudou. ${mensagem(err)}`, { cause: err });
  }
}

// ---------- Espelho ----------

// O que mudou no Drive desde a última conferência. `arquivo` undefined = apagado de vez.
function mudancaDoEspelho(g: Generation, arquivo: ArquivoDrive | undefined): Partial<Generation> | null {
  if (!arquivo || arquivo.noLixo) return g.foraDoDrive ? null : { foraDoDrive: true };
  const patch: Partial<Generation> = {};
  if (g.foraDoDrive) patch.foraDoDrive = false; // voltou da lixeira
  if (arquivo.nome && arquivo.nome !== downloadName(g)) {
    // O nome no Drive tem a extensão; o do hub não (o download soma a extensão).
    const nome = arquivo.nome.replace(/\.[^.\s]{1,5}$/, "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (nome && nome !== g.name) patch.name = nome;
  }
  return Object.keys(patch).length ? patch : null;
}

// Espelho: confere no Drive as gerações que estão lá (apagadas, na lixeira, renomeadas) e atualiza o hub.
// Leve e com intervalo mínimo: pode ser chamada a cada abertura de lista.
export async function sincronizarComDrive(): Promise<void> {
  const { espelho } = memoria;
  if (espelho.emCurso) return espelho.emCurso;
  if (Date.now() - espelho.ultima < ESPERA_DO_ESPELHO_MS) return;
  espelho.ultima = Date.now();
  espelho.emCurso = espelhar().finally(() => {
    espelho.emCurso = null;
  });
  return espelho.emCurso;
}

async function espelhar(): Promise<void> {
  try {
    // Inclui as escondidas: um vídeo que volta da lixeira reaparece no hub.
    const noDrive = (await listGenerations(undefined, { incluirForaDoDrive: true })).filter((g) => g.drive);
    if (noDrive.length) {
      let achados: ArquivoDrive[];
      try {
        achados = await situacao(noDrive.map((g) => g.drive!.id));
      } catch (err) {
        // Login vencido, Drive desconectado ou Google fora: não dá para saber o que mudou, então nada muda.
        if (!(err instanceof DriveNaoConectado)) console.warn("[drive] espelho: não consegui conferir o Drive:", mensagem(err));
        return;
      }
      const porId = new Map(achados.map((a) => [a.id, a]));
      for (const g of noDrive) {
        const patch = mudancaDoEspelho(g, porId.get(g.drive!.id));
        if (patch) await updateGeneration(g.id, patch);
      }
    }
    await limparCopiasLocais();
  } catch (err) {
    console.error("[drive] espelho:", mensagem(err));
  }
}

// Cópias locais que sobraram de vídeos que já estão no Drive (estavam em uso na hora do envio, ou o Windows não
// deixou apagar). Não toca no que está subindo nem no que alguém pediu há pouco.
async function limparCopiasLocais(): Promise<void> {
  const agora = Date.now();
  for (const [nome, ate] of memoria.emUso) if (ate <= agora) memoria.emUso.delete(nome);
  const gens = (await listGenerations()).filter((g) => g.drive && g.file && !memoria.envios.has(g.id));
  for (const g of gens) {
    const nome = path.basename(g.file!);
    if (segurado(nome)) continue;
    await unlink(path.join(MEDIA_DIR, nome)).catch(() => undefined); // quase sempre já não existe
  }
}

// ---------- Migração: o que ficou no disco vai para o Drive ----------

export type EstadoDaMigracao = { rodando: boolean; total: number; feitos: number; falhas: number; ultimoErro: string | null };

export const estadoDaMigracao = (): EstadoDaMigracao => ({ ...memoria.migracao });

// Vídeos de antes da conexão com o Drive e os que ficaram marcados `paraDrive` (o Drive falhou na hora).
async function filaDaMigracao(): Promise<Generation[]> {
  const candidatas = (await listGenerations()).filter(vaiParaODrive);
  const fila: Generation[] = [];
  for (const g of candidatas) if (await existe(path.join(MEDIA_DIR, path.basename(g.file!)))) fila.push(g);
  return fila;
}

// Começa a migração em segundo plano, neste processo, uma de cada vez. Se já está rodando, só devolve o estado.
export async function iniciarMigracao(): Promise<EstadoDaMigracao> {
  const estado = memoria.migracao;
  if (estado.rodando) return estadoDaMigracao();
  Object.assign(estado, { rodando: true, total: 0, feitos: 0, falhas: 0, ultimoErro: null });
  try {
    const fila = await filaDaMigracao();
    estado.total = fila.length;
    void migrar(fila);
  } catch (err) {
    estado.rodando = false;
    estado.ultimoErro = mensagem(err);
  }
  return estadoDaMigracao();
}

async function migrar(fila: Generation[]): Promise<void> {
  const estado = memoria.migracao;
  try {
    // Um vídeo por vez: são arquivos grandes, e o Drive limita pedidos seguidos.
    for (let i = 0; i < fila.length; i++) {
      const { geracao, erro, naoConectado } = await enviar(fila[i]);
      if (geracao.drive || !erro) {
        estado.feitos++;
        continue;
      }
      estado.falhas++;
      estado.ultimoErro = erro;
      if (naoConectado) {
        // Sem Drive, os próximos falhariam todos do mesmo jeito.
        estado.falhas += fila.length - i - 1;
        break;
      }
    }
    await limparCopiasLocais();
  } catch (err) {
    estado.ultimoErro = mensagem(err);
  } finally {
    estado.rodando = false;
  }
}

// Só para os testes: esquece o estado do processo (espelho, migração, cópias em uso).
export function zerarVideosNoDrive() {
  memoria.envios.clear();
  memoria.emUso.clear();
  memoria.espelho.ultima = 0;
  memoria.espelho.emCurso = null;
  Object.assign(memoria.migracao, { rodando: false, total: 0, feitos: 0, falhas: 0, ultimoErro: null });
}
