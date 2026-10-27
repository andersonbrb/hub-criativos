import "server-only";

import { readFile, unlink } from "node:fs/promises";

import { driveConectado } from "@/features/drive/servicos/conta";
import type { CriativoDoSkala, Valor } from "@/features/skala/contrato";
import type { Entrega } from "@/features/skala/servicos/entregas";
import { baixarMidia, MidiaIndisponivel } from "@/features/skala/servicos/midia";
import { anexoDeMidiaSalva, prepararAnexo, type Prepared } from "@/lib/server/chat/anexos";

// A primeira mensagem da conversa que nasce do botão "Gerar ganchos" do Skala: o pedido, o vídeo (ou a imagem) de
// cada criativo e uma ficha com tudo o que o Skala sabe dele (copy, produto, países, números, anúncios).
//
// O que não deu para trazer não trava a conversa: os ganchos saem pelo que chegou, e o aviso aparece na bolha para a
// pessoa e para o agente (regra do dono: nunca esconder problema).

export type PrimeiraMensagem = { texto: string; anexos: Prepared[] };

const formatar = (v: Valor) => (v === null ? "—" : typeof v === "boolean" ? (v ? "sim" : "não") : String(v));
const nomeDoArquivo = (nome: string, ext: string) => `${nome.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "criativo"}.${ext}`;

// Ficha em Markdown: vai para o agente como arquivo anexado e aparece na bolha como "Ficha do Skala".
export function fichaDoCriativo(c: CriativoDoSkala): string {
  const linhas = [`# ${c.nome}`, ""];
  const campo = (rotulo: string, v: string | undefined) => v && linhas.push(`- **${rotulo}:** ${v}`);
  campo("Id no Skala", c.id);
  campo("Plataforma", c.plataforma);
  campo("Produto", c.produto);
  campo("Países", c.paises?.join(", "));
  campo("Período dos números", c.periodo);
  campo("Link no Skala", c.link);
  campo("Título do anúncio", c.titulo);
  campo("Chamada (CTA)", c.chamada);
  if (c.texto) linhas.push("", "## Texto do anúncio", "", c.texto);
  if (c.metricas) {
    linhas.push("", "## Números", "");
    for (const [k, v] of Object.entries(c.metricas)) linhas.push(`- **${k}:** ${formatar(v)}`);
  }
  if (c.anuncios?.length) {
    const colunas = [...new Set(c.anuncios.flatMap((a) => Object.keys(a)))];
    const celula = (v: Valor | undefined) => (v === undefined ? "" : formatar(v)).replace(/\|/g, "/").replace(/\n/g, " ");
    linhas.push("", "## Anúncios com este criativo", "", `| ${colunas.join(" | ")} |`, `| ${colunas.map(() => "---").join(" | ")} |`);
    for (const a of c.anuncios) linhas.push(`| ${colunas.map((k) => celula(a[k])).join(" | ")} |`);
  }
  return `${linhas.join("\n")}\n`;
}

async function imagem(url: string, nome: string): Promise<Prepared> {
  const baixada = await baixarMidia(url, "image");
  try {
    const bytes = await readFile(baixada.caminho);
    return await prepararAnexo(new File([bytes], nomeDoArquivo(nome, baixada.ext), { type: baixada.contentType }));
  } finally {
    // prepararAnexo grava a própria cópia (e converte, se precisar).
    await unlink(baixada.caminho).catch(() => undefined);
  }
}

async function midiaDoCriativo(c: CriativoDoSkala, comDrive: boolean, avisos: string[]): Promise<Prepared[]> {
  const motivo = (err: unknown) => (err instanceof MidiaIndisponivel ? err.message : "erro inesperado no download");
  if (c.videoUrl) {
    if (!comDrive) avisos.push(`o vídeo de "${c.nome}" não entrou porque o Google Drive não está conectado (o hub guarda vídeo só no Drive)`);
    else {
      try {
        const v = await baixarMidia(c.videoUrl, "video");
        return [await anexoDeMidiaSalva(v.arquivo, nomeDoArquivo(c.nome, v.ext), "video")];
      } catch (err) {
        console.error(`[skala] vídeo do criativo ${c.id}:`, err instanceof Error ? err.message : err);
        avisos.push(`não deu para trazer o vídeo de "${c.nome}": ${motivo(err)}`);
      }
    }
  }
  // Estático: a imagem do anúncio. Sem o vídeo (não veio ou não deu para baixar): a capa, para o agente ver o quadro.
  const url = c.imagemUrl ?? c.capaUrl;
  if (!url) {
    if (!c.videoUrl) avisos.push(`"${c.nome}" chegou sem vídeo e sem imagem`);
    return [];
  }
  try {
    return [await imagem(url, c.imagemUrl ? c.nome : `${c.nome} (capa)`)];
  } catch (err) {
    console.error(`[skala] imagem do criativo ${c.id}:`, err instanceof Error ? err.message : err);
    avisos.push(`não deu para trazer a ${c.imagemUrl ? "imagem" : "capa"} de "${c.nome}": ${motivo(err)}`);
    return [];
  }
}

// Roda dentro da organização da entrega (a da conversa): a mídia vai para a pasta e o Drive dela.
export async function montarPrimeiraMensagem(entrega: Entrega): Promise<PrimeiraMensagem> {
  const avisos: string[] = [];
  const comDrive = entrega.criativos.some((c) => c.videoUrl) ? await driveConectado() : false;
  const anexos: Prepared[] = [];
  for (const c of entrega.criativos) {
    anexos.push(...(await midiaDoCriativo(c, comDrive, avisos)));
    const nome = nomeDoArquivo(`Ficha do Skala - ${c.nome}`, "md");
    anexos.push(await prepararAnexo(new File([fichaDoCriativo(c)], nome, { type: "text/markdown" })));
  }
  const nomes = entrega.criativos.map((c) => `"${c.nome}"`).join(", ");
  const linhas = [`${entrega.pedido}`, "", `Criativo${entrega.criativos.length > 1 ? "s" : ""} do Skala: ${nomes}.`];
  if (avisos.length) linhas.push("", `Aviso: ${avisos.join("; ")}. Os ganchos saem pelo que chegou.`);
  return { texto: linhas.join("\n"), anexos };
}
