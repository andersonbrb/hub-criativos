import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { inArray } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { memoriaDocumentos as docs } from "@/db/schema";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import type { Autor, Doc, EntradaSalvar } from "@/features/memoria/contrato";
import { ler, salvar } from "@/features/memoria/servicos/memoria";
import { normalizarConteudo } from "@/features/memoria/texto";

// Decisão do Vinícius em 20/10/2026: "como fazer os vídeos vai ser só de acordo com o contexto do Sávio".
// Leva para a Memória de cada organização que importou os documentos do hub: o documento das decisões fechado (que
// passa a entrar no prompt dos agentes) e os playbooks sem as regras que conflitavam com o Sávio. O retrato antigo
// "Contexto Grupo Chegou" fica marcado como substituído.
//
// Só troca documento que ainda é do hub (a versão atual foi gravada por um processo do hub, "Hub (…)"): o que uma
// pessoa editou na tela fica como está e vai para a fila de revisão com o motivo. Nada é apagado: cada troca é uma
// versão nova e as antigas ficam no histórico do documento. Rodar de novo não grava nada (idempotente).

export const AUTOR_DA_DECISAO: Autor = { id: null, nome: "Hub (decisão de 20/10/2026: só o contexto do Sávio)" };
const DATA = "2026-10-20";
const doHub = (d: Doc) => d.autor.startsWith("Hub (");

const MOTIVO_EDITADO =
  "Decisão de 20/10/2026 (como fazer vídeo segue só o contexto do Sávio): este documento foi editado na tela depois da importação, então o hub não trocou o texto. Tire à mão as regras que conflitam com o Sávio (veja o documento decisoes-pendentes).";

export const AVISO_DO_CONTEXTO_ANTIGO =
  "> **Substituído (decisão de 20/10/2026, item 16 do documento decisoes-pendentes).** Este é o retrato de 06/10/2026, feito antes do contexto do Sávio entrar no Hub. Não use como regra: valem os documentos 01 a 03 e os projetos do Sávio. Fica aqui só como histórico.";

type Alvo = {
  slug: string;
  // Arquivo (a partir da pasta do hub) com o texto novo; sem arquivo, o texto novo sai de `mudar`.
  arquivo?: string;
  mudar?: (atual: Doc) => string;
  campos: Omit<EntradaSalvar, "slug" | "conteudo" | "versaoEsperada">;
};

const semMotivo = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "motivoRevisao"));

function alvos(): Alvo[] {
  return [
    {
      slug: "decisoes-pendentes",
      arquivo: "features/memoria/importacao/decisoes-pendentes.md",
      campos: {
        titulo: "Decisões: regras do Sávio x regras antigas do Hub (fechado em 20/10/2026)",
        noPrompt: true,
        precisaRevisao: false,
        nota: "decisão do Vinícius: vale o contexto do Sávio nos 18 itens, e os 4 pontos que ele não decide foram decididos em 20/10/2026",
      },
    },
    {
      slug: "playbook-dropshipping-cod-criativos",
      arquivo: "playbooks/dropshipping-cod-criativos.md",
      campos: { nota: "sem as regras que conflitavam com o contexto do Sávio" },
    },
    {
      slug: "playbook-infoproduto-edicao-video",
      arquivo: "playbooks/infoproduto-edicao-video.md",
      campos: { titulo: "Agente de Edição de Vídeo — infoproduto", nota: "sem as regras que conflitavam com o contexto do Sávio" },
    },
    {
      slug: "playbook-variacoes-criativo-validado",
      arquivo: "playbooks/variacoes-criativo-validado.md",
      campos: { nota: "sem as regras que conflitavam com o contexto do Sávio" },
    },
    {
      slug: "playbook-contexto-grupo-chegou",
      mudar: (atual) => (atual.conteudo.startsWith(AVISO_DO_CONTEXTO_ANTIGO) ? atual.conteudo : `${AVISO_DO_CONTEXTO_ANTIGO}\n\n${atual.conteudo}`),
      campos: {
        titulo: "Contexto Grupo Chegou de 06/10/2026 (substituído)",
        noPrompt: false,
        precisaRevisao: false,
        nota: "substituído pelos documentos 01 a 03 e pelos projetos do Sávio",
      },
    },
  ];
}

export type ResultadoDecisoes = { atualizados: string[]; iguais: string[]; editadosNaTela: string[]; recusados: { slug: string; erro: string }[] };

// Na organização em que o código está rodando (organizacaoAtual).
export async function aplicarDecisoesDoSavio(pastaDoHub = process.cwd()): Promise<ResultadoDecisoes> {
  const r: ResultadoDecisoes = { atualizados: [], iguais: [], editadosNaTela: [], recusados: [] };
  for (const alvo of alvos()) {
    try {
      const atual = await ler(alvo.slug);
      if (!atual) continue; // organização que não importou este documento: nada a fazer
      if (!doHub(atual)) {
        // Marca uma vez só (decisaoDoSavio): depois que a pessoa revisar, o aviso não volta a cada reinício.
        if (!atual.metadados.decisaoDoSavio) {
          await salvar(
            {
              slug: alvo.slug,
              conteudo: atual.conteudo,
              versaoEsperada: atual.versao,
              precisaRevisao: true,
              metadados: { ...atual.metadados, motivoRevisao: MOTIVO_EDITADO, decisaoDoSavio: "editado na tela" },
            },
            AUTOR_DA_DECISAO,
          );
        }
        r.editadosNaTela.push(alvo.slug);
        continue;
      }
      const conteudo = alvo.arquivo ? normalizarConteudo(await readFile(path.join(pastaDoHub, alvo.arquivo), "utf8")) : normalizarConteudo(alvo.mudar!(atual));
      const metadados = {
        ...(alvo.campos.precisaRevisao === false ? semMotivo(atual.metadados) : atual.metadados),
        decisaoDoSavio: DATA,
        ...(alvo.arquivo ? { origem: alvo.arquivo } : {}),
      };
      const igual =
        conteudo === atual.conteudo &&
        (alvo.campos.titulo === undefined || alvo.campos.titulo === atual.titulo) &&
        (alvo.campos.noPrompt === undefined || alvo.campos.noPrompt === atual.noPrompt) &&
        (alvo.campos.precisaRevisao === undefined || alvo.campos.precisaRevisao === atual.precisaRevisao) &&
        atual.metadados.decisaoDoSavio === DATA;
      if (igual) {
        r.iguais.push(alvo.slug);
        continue;
      }
      await salvar({ ...alvo.campos, slug: alvo.slug, conteudo, versaoEsperada: atual.versao, metadados }, AUTOR_DA_DECISAO);
      r.atualizados.push(alvo.slug);
    } catch (err) {
      r.recusados.push({ slug: alvo.slug, erro: err instanceof Error ? err.message : String(err) });
    }
  }
  return r;
}

// Em todas as organizações que têm algum destes documentos (o hub sobe uma vez por publicação; ver instrumentation.ts).
export async function aplicarDecisoesEmTodasAsOrganizacoes(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return; // PC sem banco: o prompt lê os arquivos do disco
  const slugs = alvos().map((a) => a.slug);
  const linhas = await banco().selectDistinct({ organizacaoId: docs.organizacaoId }).from(docs).where(inArray(docs.slug, slugs));
  for (const { organizacaoId } of linhas) {
    const r = await comOrganizacao(organizacaoId, () => aplicarDecisoesDoSavio());
    if (r.atualizados.length || r.editadosNaTela.length || r.recusados.length)
      console.log(
        `[hub] Memória ${organizacaoId}: decisões do Sávio aplicadas (${r.atualizados.join(", ") || "nada novo"})` +
          (r.editadosNaTela.length ? `; editados na tela, para revisão: ${r.editadosNaTela.join(", ")}` : "") +
          (r.recusados.length ? `; recusados: ${r.recusados.map((x) => `${x.slug} (${x.erro})`).join(", ")}` : ""),
      );
  }
}
