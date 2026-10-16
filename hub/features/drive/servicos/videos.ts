import "server-only";

import { access, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import type { ArquivoDrive, PastaDoDrive } from "@/features/drive/contrato";
import {
  abrirTrecho,
  ArquivoForaDoDrive,
  baixarParaTemp,
  enviarArquivo,
  listarArquivosDoHub,
  moverParaLixeira,
  renomear,
} from "@/features/drive/servicos/arquivos";
import { DriveNaoConectado, tokenDeAcesso } from "@/features/drive/servicos/conta";
import { downloadName, type Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { CONTENT_TYPES } from "@/lib/server/media";
import { pastaDeMidia } from "@/lib/server/pastas";
import { arquivoDoBanco, getGeneration, listGenerations, updateGeneration } from "@/lib/server/store";

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
// A fila que o espelho leva sozinho terminou com erro: espera antes de tentar de novo, para não subir o mesmo vídeo
// de centenas de MB a cada minuto.
const ESPERA_APOS_FALHA_MS = 10 * 60_000;
// Proteção do espelho contra conta trocada: se mais da metade dos vídeos (e pelo menos estes) some de uma vez, nada
// é marcado.
const MINIMO_PARA_DESCONFIAR = 5;

const mensagem = (err: unknown) => (err instanceof Error ? err.message : String(err));
const existe = (caminho: string) => access(caminho).then(() => true, () => false);
const extensao = (file: string) => (file.split(".").pop() ?? "").toLowerCase();

// Estado do processo (sobrevive ao hot reload do dev, como as montagens em lib/server/montage.ts).
// Envios e cópias em uso valem para todas as organizações (a chave é o id da geração ou o nome do arquivo). Espelho,
// migração e índice são de cada organização: cada uma tem a própria conta Google e o próprio db.json.
type DaOrganizacao = {
  espelho: { ultima: number; emCurso: Promise<void> | null };
  migracao: EstadoDaMigracao;
  proximaFilaSozinha: number;
  indice?: { chave: string; porArquivo: Promise<Map<string, MidiaDoArquivo>> };
};
type Memoria = {
  envios: Map<string, Promise<Resultado>>;
  emUso: Map<string, number>;
  // Opcional: depois de um hot reload, o objeto antigo ainda não tem.
  porOrganizacao?: Map<string, DaOrganizacao>;
};
const memoria: Memoria = ((globalThis as { __videosNoDrive?: Memoria }).__videosNoDrive ??= {
  envios: new Map(),
  emUso: new Map(),
});

async function daOrganizacao(): Promise<DaOrganizacao> {
  const org = await organizacaoAtual();
  const todas = (memoria.porOrganizacao ??= new Map());
  let estado = todas.get(org);
  if (!estado) {
    estado = { espelho: { ultima: 0, emCurso: null }, migracao: { rodando: false, total: 0, feitos: 0, falhas: 0, ultimoErro: null }, proximaFilaSozinha: 0 };
    todas.set(org, estado);
  }
  return estado;
}

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
    const caminho = path.join(await pastaDeMidia(), nomeLocal);
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile()) return { geracao: gen, erro: "O arquivo do vídeo não está no disco do hub." };

    let arquivo: ArquivoDrive;
    try {
      arquivo = await enviarArquivo(caminho, { nome: downloadName(gen), pasta, mimeType: CONTENT_TYPES[extensao(nomeLocal)] ?? "video/mp4" });
    } catch (err) {
      const naoConectado = err instanceof DriveNaoConectado;
      console.warn(`[drive] o vídeo ${gen.id} ficou no disco do hub e vai para o Drive depois: ${mensagem(err)}`);
      return { geracao: await marcarParaDepois(gen), erro: mensagem(err), naoConectado };
    }

    // Antes de a cópia local sair: o Drive precisa ter o vídeo inteiro, e o arquivo do disco não pode ter mudado
    // durante o envio. Se não bater, a cópia do Drive vai para a lixeira e o vídeo fica no hub para ir de novo.
    const tamanhoLocal = (await stat(caminho).catch(() => null))?.size ?? info.size;
    if (arquivo.tamanho !== info.size || tamanhoLocal !== info.size) {
      console.warn(
        `[drive] o vídeo ${gen.id} chegou ao Drive com ${arquivo.tamanho} bytes, mas tem ${tamanhoLocal} no hub: ficou no disco e vai de novo depois.`,
      );
      await moverParaLixeira(arquivo.id).catch((err) => console.warn(`[drive] não consegui tirar do Drive a cópia incompleta ${arquivo.id}:`, mensagem(err)));
      return { geracao: await marcarParaDepois(gen), erro: "O vídeo não chegou inteiro ao Google Drive. Ele continua no hub e vai de novo depois." };
    }

    // Relê logo antes de gravar: o envio leva minutos, e outra parte do hub pode ter mudado os params nesse tempo.
    const atual = await getGeneration(gen.id);
    const params: Generation["params"] = { ...(atual ?? gen).params, tamanhoNoDrive: info.size };
    delete params.paraDrive;
    const salva = atual ? await updateGeneration(gen.id, { drive: { id: arquivo.id, pasta }, params }) : undefined;
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

// Marca para levar depois. Relê a geração: os params podem ter mudado durante o envio.
async function marcarParaDepois(gen: Generation): Promise<Generation> {
  const atual = await getGeneration(gen.id);
  if (!atual) return gen;
  if (atual.params.paraDrive === true) return atual;
  return (await updateGeneration(gen.id, { params: { ...atual.params, paraDrive: true } })) ?? atual;
}

// ---------- Ler o vídeo ----------

// Geração dona de um arquivo de mídia (o `file`), inclusive as escondidas pelo espelho.
export async function geracaoDoArquivo(file: string): Promise<Generation | undefined> {
  const nome = path.basename(file);
  return (await listGenerations(undefined, { incluirForaDoDrive: true })).find((g) => g.file === nome);
}

// O que a rota de mídia e o arquivoLocal precisam saber de um arquivo.
export type MidiaDoArquivo = Pick<Generation, "drive" | "foraDoDrive" | "kind">;

// Como geracaoDoArquivo, mas por um índice em memória: o player pede o vídeo em muitos pedaços, e cada pedaço
// relia o db.json inteiro. O índice vale enquanto o db.json não muda (data de modificação e tamanho).
export async function midiaDoArquivo(file: string): Promise<MidiaDoArquivo | undefined> {
  return (await indiceDaMidia()).get(path.basename(file));
}

async function indiceDaMidia(): Promise<Map<string, MidiaDoArquivo>> {
  const info = await stat(await arquivoDoBanco()).catch(() => null);
  // Sem db.json (servidor novo) não há o que guardar: lê direto.
  if (!info) return montarIndice();
  const da = await daOrganizacao();
  const chave = `${info.mtimeMs}:${info.size}`;
  if (da.indice?.chave === chave) return da.indice.porArquivo;
  // Os pedaços que chegam juntos esperam a mesma leitura. Se ela falhar, o próximo pedido tenta de novo.
  const porArquivo = montarIndice();
  da.indice = { chave, porArquivo };
  porArquivo.catch(() => {
    if (da.indice?.porArquivo === porArquivo) da.indice = undefined;
  });
  return porArquivo;
}

async function montarIndice(): Promise<Map<string, MidiaDoArquivo>> {
  const porArquivo = new Map<string, MidiaDoArquivo>();
  for (const g of await listGenerations(undefined, { incluirForaDoDrive: true })) {
    // Mesmo arquivo em duas gerações: vale a primeira da lista, como em geracaoDoArquivo.
    if (g.file && !porArquivo.has(g.file)) porArquivo.set(g.file, { drive: g.drive, foraDoDrive: g.foraDoDrive, kind: g.kind });
  }
  return porArquivo;
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
  const local = path.join(await pastaDeMidia(), nome);
  // Marca antes de conferir: um envio ao Drive terminando agora não apaga o arquivo que vai ser lido.
  segurar(nome);
  if (await existe(local)) return local;
  memoria.emUso.delete(nome);
  const gen = await midiaDoArquivo(nome);
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

// Espelho: confere no Drive as gerações que estão lá (apagadas, na lixeira, renomeadas) e atualiza o hub. Depois
// leva para o Drive, em segundo plano, os vídeos que ficaram no disco do hub (a fila).
// Leve e com intervalo mínimo: pode ser chamada a cada abertura de lista.
export async function sincronizarComDrive(): Promise<void> {
  const { espelho } = await daOrganizacao();
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
    // Inclui as escondidas: um vídeo que volta da lixeira (ou da conta antiga) reaparece no hub.
    const noDrive = (await listGenerations(undefined, { incluirForaDoDrive: true })).filter((g) => g.drive);
    let conectado = false;
    if (noDrive.length) {
      let arquivos: ArquivoDrive[];
      try {
        // Uma lista só (paginada), com a lixeira: o que não está nela foi apagado de vez.
        arquivos = await listarArquivosDoHub();
      } catch (err) {
        // Login vencido, Drive desconectado ou Google fora: não dá para saber o que mudou, então nada muda.
        if (!(err instanceof DriveNaoConectado)) console.warn("[drive] espelho: não consegui conferir o Drive:", mensagem(err));
        return;
      }
      conectado = true;
      const porId = new Map(arquivos.map((a) => [a.id, a]));
      // Outra conta conectada (ou uma lista que veio pela metade) faria sumir quase tudo de uma vez e esconderia os
      // vídeos da conta antiga. Nesse caso nada é marcado, e o aviso fica no log.
      const visiveis = noDrive.filter((g) => !g.foraDoDrive);
      const sumidos = visiveis.filter((g) => !porId.has(g.drive!.id)).length;
      if (sumidos >= MINIMO_PARA_DESCONFIAR && sumidos > visiveis.length / 2) {
        console.warn(`[drive] espelho: ${sumidos} de ${visiveis.length} vídeos sumiram do Drive de uma vez (conta trocada?). Nada foi marcado.`);
        return;
      }
      for (const g of noDrive) {
        const patch = mudancaDoEspelho(g, porId.get(g.drive!.id));
        if (patch) await updateGeneration(g.id, patch);
      }
    }
    await limparCopiasLocais();
    await levarAFila(conectado);
  } catch (err) {
    console.error("[drive] espelho:", mensagem(err));
  }
}

// Fila: vídeos que ficaram no disco do hub (Drive desconectado ou falha na hora do envio) vão sozinhos para o Drive
// quando ele está conectado. Um por vez, pela mesma migração do botão de Integrações.
async function levarAFila(conectado: boolean): Promise<void> {
  const da = await daOrganizacao();
  if (da.migracao.rodando || Date.now() < da.proximaFilaSozinha) return;
  if (!(await filaDaMigracao()).length) return;
  if (!conectado) {
    try {
      await tokenDeAcesso();
    } catch {
      return; // sem Drive conectado, a fila espera
    }
  }
  await iniciarMigracao();
}

// Quantos vídeos ainda estão no disco do hub esperando para ir ao Drive (card do Drive em Integrações).
export async function videosNaFila(): Promise<number> {
  return (await filaDaMigracao()).length;
}

// Cópias locais que sobraram de vídeos que já estão no Drive (estavam em uso na hora do envio, ou o Windows não
// deixou apagar). Não toca no que está subindo nem no que alguém pediu há pouco.
async function limparCopiasLocais(): Promise<void> {
  const agora = Date.now();
  for (const [nome, ate] of memoria.emUso) if (ate <= agora) memoria.emUso.delete(nome);
  const gens = (await listGenerations()).filter((g) => g.drive && g.file && !memoria.envios.has(g.id));
  const midia = await pastaDeMidia();
  for (const g of gens) {
    const nome = path.basename(g.file!);
    if (segurado(nome)) continue;
    await unlink(path.join(midia, nome)).catch(() => undefined); // quase sempre já não existe
  }
}

// ---------- Migração: o que ficou no disco vai para o Drive ----------

export type EstadoDaMigracao = { rodando: boolean; total: number; feitos: number; falhas: number; ultimoErro: string | null };

export const estadoDaMigracao = async (): Promise<EstadoDaMigracao> => ({ ...(await daOrganizacao()).migracao });

// Vídeos de antes da conexão com o Drive e os que ficaram marcados `paraDrive` (o Drive falhou na hora).
async function filaDaMigracao(): Promise<Generation[]> {
  const candidatas = (await listGenerations()).filter(vaiParaODrive);
  const fila: Generation[] = [];
  const midia = await pastaDeMidia();
  for (const g of candidatas) if (await existe(path.join(midia, path.basename(g.file!)))) fila.push(g);
  return fila;
}

// Começa a migração em segundo plano, neste processo, uma de cada vez. Se já está rodando, só devolve o estado.
export async function iniciarMigracao(): Promise<EstadoDaMigracao> {
  const da = await daOrganizacao();
  const estado = da.migracao;
  if (estado.rodando) return { ...estado };
  Object.assign(estado, { rodando: true, total: 0, feitos: 0, falhas: 0, ultimoErro: null });
  try {
    const fila = await filaDaMigracao();
    estado.total = fila.length;
    void migrar(fila, da);
  } catch (err) {
    estado.rodando = false;
    estado.ultimoErro = mensagem(err);
  }
  return { ...estado };
}

async function migrar(fila: Generation[], da: DaOrganizacao): Promise<void> {
  const estado = da.migracao;
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
    if (estado.ultimoErro) da.proximaFilaSozinha = Date.now() + ESPERA_APOS_FALHA_MS;
  }
}

// Só para os testes: esquece o estado do processo (espelho, migração, cópias em uso, índice da mídia).
export function zerarVideosNoDrive() {
  memoria.envios.clear();
  memoria.emUso.clear();
  memoria.porOrganizacao?.clear();
}
