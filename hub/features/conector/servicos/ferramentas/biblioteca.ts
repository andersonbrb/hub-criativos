import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import { ErroDaFerramenta } from "@/features/conector/erros";
import {
  SO_LEITURA,
  booleano,
  esquema,
  grava,
  inteiro,
  listaQueCabe,
  texto,
  umDe,
  type Ferramenta,
} from "@/features/conector/servicos/ferramentas/comum";
import { criarLinkDeDownload, criarLinkDeEnvio, extensoesAceitas, tipoDoArquivo } from "@/features/conector/servicos/links";
import { driveConectado } from "@/features/drive/servicos/conta";
import { MENSAGEM_SEM_DRIVE, sincronizarComDrive } from "@/features/drive/servicos/videos";
import { apareceNasListas, downloadName, generationTitle, type Generation } from "@/lib/generations";
import { pastaDeMidia } from "@/lib/server/pastas";
import { getGeneration, listGenerations } from "@/lib/server/store";

// A Biblioteca do hub pelo conector: listar o que existe, mandar entrega para lá e baixar arquivo. O arquivo nunca
// passa pela conversa: as duas ferramentas de link devolvem um curl para o terminal da pessoa.

const KINDS = ["video", "image", "audio"] as const;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function tamanhoLegivel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Tamanho do arquivo em bytes; null = sem arquivo no hub. Vídeo no Google Drive: o tamanho anotado no envio.
async function tamanhoDe(g: Generation): Promise<number | null> {
  if (!g.file || !/^[\w-]+\.\w+$/.test(g.file) || g.foraDoDrive) return null;
  if (g.drive) return typeof g.params.tamanhoNoDrive === "number" ? g.params.tamanhoNoDrive : null;
  const info = await stat(path.join(await pastaDeMidia(), g.file)).catch(() => null);
  return info?.isFile() ? info.size : null;
}

// Tem arquivo para baixar: no disco do hub ou no Google Drive.
const temArquivo = async (g: Generation) => Boolean(g.drive && !g.foraDoDrive && g.file) || (await tamanhoDe(g)) !== null;

const bibliotecaListar: Ferramenta = {
  chave: "biblioteca",
  definicao: {
    name: "biblioteca_listar",
    title: "Listar a Biblioteca",
    description:
      "Lista os arquivos da Biblioteca do Hub (criativos finais, entregas e anexos salvos), do mais novo para o mais antigo: id, nome, tipo (video, image, audio), ferramenta que gerou, status, data e tamanho. Use para achar o id de um arquivo antes de link_de_download, ou para conferir uma entrega. `busca` procura no nome e no texto; `incluir_estudios: true` inclui também o que foi gerado nos estúdios e ainda não foi salvo na Biblioteca.",
    inputSchema: esquema({
      busca: { type: "string", description: "Palavras do nome ou do texto do arquivo." },
      tipo: { type: "string", enum: [...KINDS], description: "Só vídeos, imagens ou áudios." },
      limite: { type: "integer", minimum: 1, maximum: 200, default: 30, description: "Quantos itens (padrão 30, máximo 200)." },
      incluir_estudios: { type: "boolean", description: "true para incluir as gerações dos estúdios que não estão salvas na Biblioteca." },
    }),
    annotations: { title: "Listar a Biblioteca", ...SO_LEITURA },
  },
  async executar(_ctx, args) {
    // Espelho do Drive em segundo plano (no máximo 1 vez por minuto): o que foi apagado ou renomeado lá aparece na
    // próxima listagem. Os vídeos apagados no Drive já não vêm em listGenerations.
    void sincronizarComDrive();
    const busca = semAcento(texto(args, "busca", { max: 200 })?.trim() ?? "");
    const kind = umDe(args, "tipo", KINDS);
    const limite = inteiro(args, "limite", { max: 200, padrao: 30 })!;
    const todas = booleano(args, "incluir_estudios") === true;
    // Vídeo que ainda não está no Google Drive não aparece (regra do dono: vídeo da Biblioteca é sempre do Drive).
    const achadas = (await listGenerations()).filter(
      (g) =>
        apareceNasListas(g) &&
        (todas || g.saved) &&
        (!kind || g.kind === kind) &&
        (!busca || semAcento(`${g.name ?? ""} ${g.prompt} ${g.id}`).includes(busca)),
    );
    const itens = await Promise.all(
      achadas.slice(0, limite).map(async (g) => {
        const bytes = await tamanhoDe(g);
        return {
          id: g.id,
          nome: generationTitle(g),
          tipo: g.kind,
          ferramenta: g.tool,
          status: g.status,
          data: g.createdAt,
          tamanho: bytes === null ? null : tamanhoLegivel(bytes),
          tamanho_bytes: bytes,
          ...(g.saved ? {} : { na_biblioteca: false }),
        };
      }),
    );
    return listaQueCabe(itens, (lista, cortados) => ({
      itens: lista,
      total_encontrado: achadas.length,
      ...(achadas.length > limite ? { aviso: `Mostrando ${limite} de ${achadas.length}. Use busca, tipo ou limite para achar o resto.` } : {}),
      ...(cortados ? { aviso_tamanho: `${cortados} item(ns) ficaram de fora por tamanho da resposta.` } : {}),
    }));
  },
};

const linkDeEnvio: Ferramenta = {
  chave: "biblioteca",
  definicao: {
    name: "link_de_envio",
    title: "Link para enviar arquivo",
    description:
      "Gera um link de uso único (vale 15 minutos) para enviar um arquivo deste computador para a Biblioteca do Hub, e devolve o comando curl pronto para rodar no terminal. É assim que as entregas (vídeos, imagens, áudios finais) vão para o Hub. Um link por arquivo. O arquivo vai direto pelo terminal, sem passar pela conversa; a resposta do curl traz o id do arquivo no Hub.",
    inputSchema: esquema(
      { nome_arquivo: { type: "string", description: 'Nome do arquivo com a extensão (ex.: "kit-chile-v3.mp4"). É o nome que aparece na Biblioteca.' } },
      ["nome_arquivo"],
    ),
    annotations: { title: "Link para enviar arquivo", ...grava(false) },
  },
  async executar(ctx, args) {
    const nome = path.basename(texto(args, "nome_arquivo", { obrigatorio: true, max: 200 }).replace(/\\/g, "/")).replace(/["\r\n]/g, "").trim();
    if (!nome) throw new ErroDaFerramenta("Informe `nome_arquivo` com o nome do arquivo e a extensão.");
    const tipo = tipoDoArquivo(nome);
    if (!tipo) {
      throw new ErroDaFerramenta(`A Biblioteca aceita só vídeo, imagem e áudio. Extensões aceitas: ${extensoesAceitas().join(", ")}.`);
    }
    // Regra do dono: vídeo fica só no Google Drive da organização. Sem Drive conectado, nem gera o link.
    if (tipo.kind === "video" && !(await driveConectado())) throw new ErroDaFerramenta(MENSAGEM_SEM_DRIVE);
    const link = await criarLinkDeEnvio(ctx.usuario.id, nome, ctx.base);
    return [
      `Link de envio para "${nome}" (uso único, vale até ${link.expiraEm.toISOString()}, 15 minutos).`,
      "",
      "Rode no terminal, na pasta onde o arquivo está (ou troque o nome pelo caminho completo):",
      "",
      link.comando,
      "",
      "A resposta do curl é um JSON com o generation_id do arquivo no Hub. Se der erro de link vencido ou usado, peça outro link.",
      "No Windows PowerShell, escreva curl.exe no lugar de curl.",
    ].join("\n");
  },
};

const linkDeDownload: Ferramenta = {
  chave: "biblioteca",
  definicao: {
    name: "link_de_download",
    title: "Link para baixar arquivo",
    description:
      "Gera um link (vale 10 minutos, pode repetir) para baixar um arquivo do Hub para este computador, e devolve o comando curl pronto para o terminal. Pegue o `generation_id` em biblioteca_listar.",
    inputSchema: esquema({ generation_id: { type: "string", description: "O id do arquivo, como biblioteca_listar devolve." } }, ["generation_id"]),
    annotations: { title: "Link para baixar arquivo", ...SO_LEITURA, idempotentHint: false },
  },
  async executar(ctx, args) {
    const id = texto(args, "generation_id", { obrigatorio: true, max: 100 }).trim();
    const geracao = await getGeneration(id);
    if (!geracao) throw new ErroDaFerramenta(`Não existe arquivo com o id "${id}". Use biblioteca_listar para achar o certo.`);
    if (geracao.foraDoDrive) throw new ErroDaFerramenta("Este vídeo foi apagado no Google Drive e não existe mais no Hub.");
    if (geracao.status !== "done" || !(await temArquivo(geracao))) {
      throw new ErroDaFerramenta("Este item ainda não tem arquivo pronto no Hub (está gerando, falhou ou ficou só como link externo).");
    }
    const nome = downloadName(geracao);
    const link = await criarLinkDeDownload(ctx.usuario.id, geracao.id, nome, ctx.base);
    return [
      `Link de download de "${nome}" (vale até ${link.expiraEm.toISOString()}, 10 minutos; pode repetir dentro do prazo).`,
      "",
      "Rode no terminal, na pasta onde o arquivo deve ficar:",
      "",
      link.comando,
      "",
      "No Windows PowerShell, escreva curl.exe no lugar de curl.",
    ].join("\n");
  },
};

export const FERRAMENTAS_DA_BIBLIOTECA: Ferramenta[] = [bibliotecaListar, linkDeEnvio, linkDeDownload];
