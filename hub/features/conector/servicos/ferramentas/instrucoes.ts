import "server-only";

import { CHAVES, podeUsar, type Chave, type Usuario } from "@/features/acesso/contrato";
import { documentosDoPrompt, listarIndice } from "@/features/memoria/servicos/memoria";
import { SO_LEITURA, esquema, inteiro, pagina, type Ferramenta } from "@/features/conector/servicos/ferramentas/comum";

// A ferramenta "instrucoes": o mapa para trabalhar no Hub, no papel do mapa_dos_dados do Chegou Operações.
//
// O QUE ENTRA: como usar as ferramentas (só as que esta pessoa tem), as regras e os fatos centrais da memória (os
// documentos que entram no prompt dos agentes do hub e são do tipo regra, fato ou decisão: leia-primeiro, 01, 02, 03 e o
// documento das decisões) e a
// lista dos outros documentos, para o Claude saber o que existe e ler sob demanda.
//
// Sem a chave "memoria", nada da memória entra: o texto é só o como usar.

// "decisao" entra também: o documento das decisões (como fazer vídeo segue só o contexto do Sávio, decisão de
// 20/10/2026) precisa chegar ao Claude Code de cada PC, não só aos agentes do hub.
const CENTRAIS = new Set(["regra", "fato", "decisao"]);

// "leia-primeiro" antes de tudo; o resto pela ordem do slug (01-, 02-, 03-…).
const ordem = (a: string, b: string) =>
  (a.startsWith("leia-primeiro") ? 0 : 1) - (b.startsWith("leia-primeiro") ? 0 : 1) || a.localeCompare(b, "pt-BR", { numeric: true });

const rotulo = (chave: Chave) => CHAVES.find((c) => c.chave === chave)?.rotulo ?? chave;

function comoUsar(usuario: Usuario): string {
  const pode = (c: Chave) => podeUsar(usuario, c);
  const partes = [
    "## Como usar as ferramentas",
    `Este é o Hub de Criativos da organização ${usuario.organizacao?.nome ?? "desta pessoa"}: a memória, a Biblioteca e o Fluxo são só dela. As ferramentas que aparecem para você dependem das permissões desta pessoa; se uma não está na lista, ela não tem acesso.`,
  ];
  if (pode("memoria")) {
    partes.push(
      "- **Memória (consultar):** antes de afirmar qualquer fato, fluxo, regra ou dado do negócio, busque (`memoria_buscar`) e leia o documento (`memoria_ler`). O índice completo sai em `memoria_indice`; com `projetos: true`, o índice de projetos (lotes). Documento marcado como \"precisa de revisão manual\" ainda não foi confirmado: use com cuidado e diga isso.",
    );
  }
  if (pode("memoria_editar")) {
    partes.push(
      "- **Memória (gravar):** busque antes de criar um documento novo. Prefira `memoria_acrescentar` (acrescenta uma seção no fim) a reescrever. `memoria_salvar` substitui o conteúdo e exige `versao_esperada` (a versão que você leu; null para documento novo). Fatos levam data absoluta (AAAA-MM-DD); o que não foi confirmado vai com `precisa_revisao: true`. Nunca grave chaves, tokens ou senhas: a gravação é recusada. Ao terminar um lote, registre o projeto (`projeto_registrar`) e as lições (`licao_registrar`).",
    );
  }
  if (pode("biblioteca")) {
    partes.push(
      "- **Biblioteca:** entregas (vídeos, imagens e áudios finais) vão para a Biblioteca do Hub pelo `link_de_envio`, que devolve um comando curl para rodar no terminal (um link por arquivo, vale 15 minutos). Para baixar um arquivo do Hub: `biblioteca_listar` para achar o id e `link_de_download` para o curl.\n- **Vídeos ficam só no Google Drive da organização** (regra do Vinícius): o vídeo enviado vai para o Drive (pasta Entregas do Claude) e só aparece na Biblioteca quando chega lá; a resposta do curl diz se já chegou. Sem o Drive conectado no Hub, o envio de vídeo é recusado (imagem e áudio continuam): avise quem cuida das Integrações. Não guarde cópia de vídeo em outro lugar do Hub. Para pôr a entrega no quadro, vincule o `generation_id` ao card com `fluxo_salvar_card`.",
    );
  }
  if (pode("fluxo")) {
    partes.push("- **Fluxo:** o quadro da produção sai em `fluxo_ver`; `fluxo_salvar_card` cria ou atualiza cards, muda a etapa e vincula arquivos do Hub.");
  }
  const faltam = (["memoria", "memoria_editar", "biblioteca", "fluxo"] as const).filter((c) => !pode(c));
  if (faltam.length) {
    partes.push(`Esta conta não tem acesso a: ${faltam.map(rotulo).join("; ")}. Se precisar, peça a um admin do Hub.`);
  }
  return partes.join("\n");
}

async function mapa(usuario: Usuario): Promise<string> {
  const partes = [`# Hub de Criativos: mapa de trabalho (${usuario.nome})`, comoUsar(usuario)];
  if (!podeUsar(usuario, "memoria")) return partes.join("\n\n");

  const centrais = (await documentosDoPrompt()).filter((d) => CENTRAIS.has(d.tipo)).sort((a, b) => ordem(a.slug, b.slug));
  const ja = new Set(centrais.map((d) => d.slug));
  const outros = (await listarIndice()).filter((d) => !ja.has(d.slug)).sort((a, b) => ordem(a.slug, b.slug));

  partes.push(
    [
      "## Outros documentos da memória",
      "Não vêm abaixo; leia com `memoria_ler` quando o assunto aparecer.",
      ...(outros.length
        ? outros.map((d) => `- \`${d.slug}\`: ${d.titulo} (${d.tipo}, ${d.frente}${d.precisaRevisao ? ", precisa de revisão" : ""})`)
        : ["(nenhum)"]),
    ].join("\n"),
  );
  partes.push(
    [
      "## Regras e fatos centrais (valem sempre)",
      centrais.length
        ? "Siga estas regras em toda tarefa. Como fazer vídeo segue só o contexto do Sávio (documento decisoes-pendentes, decisão de 20/10/2026): antes de produzir, editar, traduzir ou revisar um vídeo, leia os documentos de produção (04, 05, 07, 08, 09, 10, 11, 12 e 22)."
        : "(a memória ainda não tem regras centrais)",
      ...centrais.map(
        (d) =>
          `### ${d.titulo}\n_\`${d.slug}\` · ${d.tipo} · ${d.frente} · versão ${d.versao} · atualizado em ${d.atualizadoEm}${d.precisaRevisao ? " · PRECISA DE REVISÃO MANUAL" : ""}_\n\n${d.conteudo.trim()}`,
      ),
    ].join("\n\n"),
  );
  return partes.join("\n\n");
}

export const FERRAMENTA_INSTRUCOES: Ferramenta = {
  chave: null,
  definicao: {
    name: "instrucoes",
    title: "Instruções do Hub",
    description:
      "Chame ANTES de qualquer tarefa no Hub de Criativos. Devolve o mapa de trabalho: como usar as ferramentas, as regras e os fatos centrais da operação (valem sempre) e a lista dos outros documentos da memória. Se a resposta disser que há mais páginas, leia todas com `pagina`.",
    inputSchema: esquema({ pagina: { type: "integer", minimum: 1, default: 1, description: "Página do mapa (padrão 1)." } }),
    annotations: { title: "Instruções do Hub", ...SO_LEITURA },
  },
  async executar(ctx, args) {
    const numero = inteiro(args, "pagina", { padrao: 1 })!;
    return pagina(await mapa(ctx.usuario), numero, (proxima) => `chame instrucoes com pagina ${proxima} e leia antes de começar.`);
  },
};
