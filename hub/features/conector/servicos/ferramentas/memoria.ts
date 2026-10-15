import "server-only";

import { FRENTES, LIMITE_BUSCA, LIMITE_BUSCA_MAX, TIPOS, type Doc, type DocResumo } from "@/features/memoria/contrato";
import {
  acrescentarSecao,
  buscar,
  historico,
  indiceDeProjetos,
  ler,
  listarIndice,
  marcarRevisado,
  pendentesDeRevisao,
  registrarLicao,
  registrarProjeto,
  restaurar,
  salvar,
} from "@/features/memoria/servicos/memoria";
import { ErroDaFerramenta } from "@/features/conector/erros";
import {
  SO_LEITURA,
  autorDe,
  booleano,
  data,
  esquema,
  grava,
  inteiro,
  listaQueCabe,
  pagina,
  texto,
  umDe,
  type Ferramenta,
} from "@/features/conector/servicos/ferramentas/comum";

// As ferramentas da Memória (a base de conhecimento da operação, que veio do contexto do Sávio).
// Leitura pede a chave "memoria"; gravação pede "memoria_editar". A regra de negócio (versões, busca, barreira de
// segredo) é toda do serviço da Memória; aqui só se traduz argumento e resposta.

const campoSlug = { type: "string", description: 'Identificador do documento (ex.: "01-regras-de-copy"), como o índice e a busca devolvem.' };
const campoTipo = { type: "string", enum: [...TIPOS], description: "Tipo do documento: regra, fluxo, fato, projeto, licao, decisao ou playbook." };
const campoFrente = { type: "string", enum: [...FRENTES], description: "Frente do negócio: cod, info, x1 ou geral." };

const resumo = (d: DocResumo) => ({
  slug: d.slug,
  titulo: d.titulo,
  tipo: d.tipo,
  frente: d.frente,
  ...(d.mercado ? { mercado: d.mercado } : {}),
  versao: d.versao,
  atualizado_em: d.atualizadoEm,
  ...(d.precisaRevisao ? { precisa_revisao: true } : {}),
});

const gravado = (d: Doc, aviso: string) =>
  JSON.stringify({ ok: true, slug: d.slug, titulo: d.titulo, versao: d.versao, atualizado_em: d.atualizadoEm, aviso });

const naoEncontrado = (slug: string) =>
  new ErroDaFerramenta(`Não existe documento "${slug}" na Memória. Use memoria_buscar ou memoria_indice para achar o certo.`);

// ---- leitura ----

const memoriaIndice: Ferramenta = {
  chave: "memoria",
  definicao: {
    name: "memoria_indice",
    title: "Índice da memória",
    description:
      "Lista os documentos da memória do Hub (slug, título, tipo, frente, versão, data da última mudança e se precisa de revisão). Use para ter o mapa do que existe antes de procurar ou criar algo. Filtre por `tipo` e `frente`. Com `projetos: true`, devolve o índice de projetos (lotes de criativos) com status, data e mercado, do mais recente para o mais antigo.",
    inputSchema: esquema({
      tipo: campoTipo,
      frente: campoFrente,
      projetos: { type: "boolean", description: "true para o índice de projetos (lotes), com status, data e mercado." },
    }),
    annotations: { title: "Índice da memória", ...SO_LEITURA },
  },
  async executar(_ctx, args) {
    const frente = umDe(args, "frente", FRENTES);
    if (booleano(args, "projetos")) {
      // O índice gerado pela Memória (mais recentes primeiro).
      const projetos = (await indiceDeProjetos())
        .filter((p) => !frente || p.frente === frente)
        .map((p) => ({
          slug: p.slug,
          titulo: p.titulo,
          frente: p.frente,
          mercado: p.mercado,
          status: p.status,
          data: p.data,
          ...(p.precisaRevisao ? { precisa_revisao: true } : {}),
        }));
      return listaQueCabe(projetos, (itens, cortados) => ({
        projetos: itens,
        total: projetos.length,
        ...(cortados ? { aviso: `${cortados} projeto(s) mais antigos ficaram de fora por tamanho. Filtre por frente.` } : {}),
      }));
    }
    const docs = await listarIndice({ tipo: umDe(args, "tipo", TIPOS), frente });
    return listaQueCabe(docs.map(resumo), (itens, cortados) => ({
      documentos: itens,
      total: docs.length,
      ...(cortados ? { aviso: `${cortados} documento(s) ficaram de fora por tamanho. Filtre por tipo ou frente.` } : {}),
    }));
  },
};

const memoriaBuscar: Ferramenta = {
  chave: "memoria",
  definicao: {
    name: "memoria_buscar",
    title: "Buscar na memória",
    description:
      "Busca por palavras na memória do Hub e devolve os documentos mais relevantes com um trecho de cada. Use ANTES de afirmar qualquer fato, fluxo, regra ou dado do negócio, e antes de criar um documento novo (para não duplicar). Depois leia o documento inteiro com memoria_ler.",
    inputSchema: esquema(
      {
        consulta: { type: "string", description: "O que procurar, em palavras simples (ex.: \"hook de lipsync\", \"preço kit Chile\")." },
        tipo: campoTipo,
        frente: campoFrente,
        limite: {
          type: "integer",
          minimum: 1,
          maximum: LIMITE_BUSCA_MAX,
          default: LIMITE_BUSCA,
          description: `Quantos resultados (padrão ${LIMITE_BUSCA}, máximo ${LIMITE_BUSCA_MAX}).`,
        },
      },
      ["consulta"],
    ),
    annotations: { title: "Buscar na memória", ...SO_LEITURA },
  },
  async executar(_ctx, args) {
    const consulta = texto(args, "consulta", { obrigatorio: true, max: 500 });
    const resultados = await buscar(consulta, {
      tipo: umDe(args, "tipo", TIPOS),
      frente: umDe(args, "frente", FRENTES),
      limite: inteiro(args, "limite", { max: LIMITE_BUSCA_MAX, padrao: LIMITE_BUSCA }),
    });
    if (!resultados.length) {
      return JSON.stringify({ resultados: [], aviso: "Nada encontrado. Tente outras palavras ou veja o índice (memoria_indice). Não afirme o fato sem fonte." });
    }
    return listaQueCabe(resultados, (itens, cortados) => ({
      resultados: itens.map((r) => ({ ...resumo(r), trecho: r.trecho })),
      ...(cortados ? { aviso: `${cortados} resultado(s) ficaram de fora por tamanho. Peça menos com limite.` } : {}),
    }));
  },
};

const memoriaLer: Ferramenta = {
  chave: "memoria",
  definicao: {
    name: "memoria_ler",
    title: "Ler documento da memória",
    description:
      "Lê um documento inteiro da memória do Hub, com a versão atual (necessária para editar com memoria_salvar). Documento longo vem em páginas: leia todas com `pagina`. Passe `versao` para ler uma versão antiga (veja memoria_historico).",
    inputSchema: esquema(
      {
        slug: campoSlug,
        versao: { type: "integer", minimum: 1, description: "Versão antiga a ler. Sem ela, a atual." },
        pagina: { type: "integer", minimum: 1, default: 1, description: "Página do documento, quando ele é longo (padrão 1)." },
      },
      ["slug"],
    ),
    annotations: { title: "Ler documento da memória", ...SO_LEITURA },
  },
  async executar(_ctx, args) {
    const slug = texto(args, "slug", { obrigatorio: true, max: 200 });
    const versao = inteiro(args, "versao");
    const numero = inteiro(args, "pagina", { padrao: 1 })!;
    const doc = await ler(slug, versao);
    if (!doc) throw versao ? new ErroDaFerramenta(`O documento "${slug}" não tem a versão ${versao}. Veja memoria_historico.`) : naoEncontrado(slug);
    const cabecalho = [
      `# ${doc.titulo}`,
      `slug: ${doc.slug} · tipo: ${doc.tipo} · frente: ${doc.frente}${doc.mercado ? ` · mercado: ${doc.mercado}` : ""}`,
      `versão ${doc.versao} · atualizado em ${doc.atualizadoEm} por ${doc.autor}${doc.precisaRevisao ? " · PRECISA DE REVISÃO MANUAL" : ""}`,
      versao ? "(versão antiga: para voltar a ela, use memoria_restaurar)" : `Para editar: memoria_salvar com versao_esperada = ${doc.versao}, ou memoria_acrescentar.`,
      "",
      "",
    ].join("\n");
    return pagina(cabecalho + doc.conteudo, numero, (proxima) => `chame memoria_ler com slug "${slug}" e pagina ${proxima}.`);
  },
};

const memoriaHistorico: Ferramenta = {
  chave: "memoria",
  definicao: {
    name: "memoria_historico",
    title: "Histórico de um documento",
    description: "Lista as versões de um documento da memória (número, autor, nota e data), da mais nova para a mais antiga. Use para ver quem mudou o quê e para escolher uma versão a ler ou restaurar.",
    inputSchema: esquema({ slug: campoSlug }, ["slug"]),
    annotations: { title: "Histórico de um documento", ...SO_LEITURA },
  },
  async executar(_ctx, args) {
    const slug = texto(args, "slug", { obrigatorio: true, max: 200 });
    const versoes = await historico(slug);
    if (!versoes.length) throw naoEncontrado(slug);
    return listaQueCabe(versoes, (itens, cortados) => ({
      slug,
      versoes: itens.map((v) => ({ versao: v.versao, autor: v.autor, nota: v.nota, criado_em: v.criadoEm })),
      ...(cortados ? { aviso: `${cortados} versão(ões) mais antigas ficaram de fora por tamanho.` } : {}),
    }));
  },
};

const memoriaPendentes: Ferramenta = {
  chave: "memoria",
  definicao: {
    name: "memoria_pendentes",
    title: "Pendentes de revisão",
    description: "Lista os documentos marcados como \"precisa de revisão manual\" (fatos não confirmados). Use para saber o que ainda não é confiável e o que vale conferir com a equipe.",
    inputSchema: esquema({}),
    annotations: { title: "Pendentes de revisão", ...SO_LEITURA },
  },
  async executar() {
    const docs = await pendentesDeRevisao();
    return listaQueCabe(docs.map(resumo), (itens, cortados) => ({
      pendentes: itens,
      total: docs.length,
      ...(cortados ? { aviso: `${cortados} documento(s) ficaram de fora por tamanho.` } : {}),
    }));
  },
};

// ---- gravação ----

const memoriaSalvar: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "memoria_salvar",
    title: "Salvar documento da memória",
    description:
      "Cria um documento novo ou substitui o conteúdo de um existente na memória do Hub (a versão anterior fica no histórico). Para EDITAR, leia antes com memoria_ler e passe em `versao_esperada` a versão que você leu: se alguém mudou depois, a gravação é recusada e você relê. Para CRIAR, busque antes (memoria_buscar) e passe `versao_esperada: null` com titulo, tipo e frente. Prefira memoria_acrescentar quando só for somar informação. Fatos com data absoluta (AAAA-MM-DD); o que não foi confirmado vai com `precisa_revisao: true`. Nunca inclua chaves, tokens ou senhas: o texto é recusado.",
    inputSchema: esquema(
      {
        slug: { ...campoSlug, description: "Identificador do documento. Num documento novo, use minúsculas e hífens (ex.: \"vozes-clonadas\")." },
        conteudo: { type: "string", description: "O texto inteiro do documento, em Markdown." },
        versao_esperada: {
          type: ["integer", "null"],
          minimum: 1,
          description: "A versão que você leu (para editar), ou null para criar um documento novo.",
        },
        titulo: { type: "string", description: "Título (obrigatório num documento novo)." },
        tipo: campoTipo,
        frente: campoFrente,
        mercado: { type: "string", description: 'Mercado, quando o documento é de um só (ex.: "chile").' },
        precisa_revisao: { type: "boolean", description: "true quando há fato não confirmado (\"precisa de revisão manual\")." },
        nota: { type: "string", description: "Uma linha dizendo o que mudou (vai para o histórico)." },
      },
      ["slug", "conteudo", "versao_esperada"],
    ),
    annotations: { title: "Salvar documento da memória", ...grava(true) },
  },
  async executar(ctx, args) {
    if (!("versao_esperada" in args)) {
      throw new ErroDaFerramenta("Informe `versao_esperada`: a versão que você leu (memoria_ler) ou null para criar um documento novo.");
    }
    const bruta = args.versao_esperada;
    const versaoEsperada = bruta === null ? null : inteiro(args, "versao_esperada");
    if (versaoEsperada === undefined) throw new ErroDaFerramenta("`versao_esperada` precisa ser um número inteiro ou null.");
    const doc = await salvar(
      {
        slug: texto(args, "slug", { obrigatorio: true, max: 200 }),
        conteudo: texto(args, "conteudo", { obrigatorio: true }),
        versaoEsperada,
        titulo: texto(args, "titulo", { max: 300 }),
        tipo: umDe(args, "tipo", TIPOS),
        frente: umDe(args, "frente", FRENTES),
        mercado: texto(args, "mercado", { max: 100 }),
        precisaRevisao: booleano(args, "precisa_revisao"),
        nota: texto(args, "nota", { max: 500 }),
      },
      autorDe(ctx.usuario),
    );
    return gravado(doc, versaoEsperada === null ? "Documento criado." : "Documento atualizado; a versão anterior ficou no histórico.");
  },
};

const memoriaAcrescentar: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "memoria_acrescentar",
    title: "Acrescentar seção",
    description:
      "Acrescenta uma seção no fim de um documento da memória, sem mexer no resto. É o jeito certo de somar informação (regra da casa: acrescentar em vez de reescrever). Não precisa de versão. Fatos com data absoluta (AAAA-MM-DD). Nunca inclua chaves, tokens ou senhas.",
    inputSchema: esquema(
      {
        slug: campoSlug,
        titulo: { type: "string", description: "Título da seção (ex.: \"Teste de hook — 2026-10-15\")." },
        conteudo: { type: "string", description: "Texto da seção, em Markdown." },
        nota: { type: "string", description: "Uma linha dizendo o que mudou (vai para o histórico)." },
      },
      ["slug", "titulo", "conteudo"],
    ),
    annotations: { title: "Acrescentar seção", ...grava(false) },
  },
  async executar(ctx, args) {
    const doc = await acrescentarSecao(
      texto(args, "slug", { obrigatorio: true, max: 200 }),
      { titulo: texto(args, "titulo", { obrigatorio: true, max: 300 }), conteudo: texto(args, "conteudo", { obrigatorio: true }) },
      autorDe(ctx.usuario),
      texto(args, "nota", { max: 500 }),
    );
    return gravado(doc, "Seção acrescentada no fim do documento.");
  },
};

const memoriaRestaurar: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "memoria_restaurar",
    title: "Restaurar versão",
    description:
      "Volta um documento da memória para uma versão antiga. Nada é apagado: o conteúdo antigo vira uma versão NOVA, e a atual continua no histórico. Veja as versões com memoria_historico e confira com memoria_ler antes.",
    inputSchema: esquema({ slug: campoSlug, versao: { type: "integer", minimum: 1, description: "A versão a restaurar." } }, ["slug", "versao"]),
    annotations: { title: "Restaurar versão", ...grava(true) },
  },
  async executar(ctx, args) {
    const versao = inteiro(args, "versao");
    if (versao === undefined) throw new ErroDaFerramenta("Informe `versao`.");
    const doc = await restaurar(texto(args, "slug", { obrigatorio: true, max: 200 }), versao, autorDe(ctx.usuario));
    return gravado(doc, `O conteúdo da versão ${versao} virou a versão ${doc.versao}.`);
  },
};

const memoriaMarcarRevisado: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "memoria_marcar_revisado",
    title: "Marcar como revisado",
    description: "Tira a marca \"precisa de revisão manual\" de um documento. Use só quando a pessoa confirmou o conteúdo com você.",
    inputSchema: esquema({ slug: campoSlug }, ["slug"]),
    annotations: { title: "Marcar como revisado", ...grava(false, true) },
  },
  async executar(ctx, args) {
    const doc = await marcarRevisado(texto(args, "slug", { obrigatorio: true, max: 200 }), autorDe(ctx.usuario));
    return gravado(doc, "Documento marcado como revisado.");
  },
};

const projetoRegistrar: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "projeto_registrar",
    title: "Registrar projeto (lote)",
    description:
      "Registra um projeto (lote de criativos) na memória do Hub: o que foi feito, para qual produto e mercado, o status e a data. Use ao terminar um lote, junto com licao_registrar para o que se aprendeu. Busque antes (memoria_indice com projetos: true) para não duplicar.",
    inputSchema: esquema(
      {
        slug: { ...campoSlug, description: 'Identificador do projeto, em minúsculas e hífens (ex.: "lote-2026-10-15-kit-chile").' },
        titulo: { type: "string", description: "Nome do projeto/lote." },
        frente: campoFrente,
        mercado: { type: "string", description: 'Mercado (ex.: "chile", "brasil").' },
        status: { type: "string", description: "entregue, em produção, pausado, validado, vencedor…" },
        data: { type: "string", description: "Data absoluta do lote, AAAA-MM-DD." },
        conteudo: { type: "string", description: "O que foi feito: criativos, ângulos, ferramentas, onde estão os arquivos, resultados. Markdown." },
      },
      ["slug", "titulo", "frente", "status", "data", "conteudo"],
    ),
    annotations: { title: "Registrar projeto (lote)", ...grava(false) },
  },
  async executar(ctx, args) {
    const frente = umDe(args, "frente", FRENTES);
    if (!frente) throw new ErroDaFerramenta("Informe `frente`: cod, info, x1 ou geral.");
    const doc = await registrarProjeto(
      {
        slug: texto(args, "slug", { obrigatorio: true, max: 200 }),
        titulo: texto(args, "titulo", { obrigatorio: true, max: 300 }),
        frente,
        mercado: texto(args, "mercado", { max: 100 }) ?? null,
        status: texto(args, "status", { obrigatorio: true, max: 100 }),
        data: data(args, "data"),
        conteudo: texto(args, "conteudo", { obrigatorio: true }),
      },
      autorDe(ctx.usuario),
    );
    return gravado(doc, "Projeto registrado.");
  },
};

const licaoRegistrar: Ferramenta = {
  chave: "memoria_editar",
  definicao: {
    name: "licao_registrar",
    title: "Registrar lição",
    description:
      "Registra uma lição aprendida na memória do Hub: o que aconteceu e a regra que fica dali em diante. Use ao terminar um lote ou depois de um erro ou acerto que vale repetir. A data é absoluta (AAAA-MM-DD).",
    inputSchema: esquema(
      {
        titulo: { type: "string", description: "Resumo da lição em uma linha." },
        data: { type: "string", description: "Data absoluta, AAAA-MM-DD." },
        o_que_aconteceu: { type: "string", description: "O que aconteceu, com os fatos." },
        regra: { type: "string", description: "A regra que fica: o que fazer (ou não fazer) da próxima vez." },
        relacionado: { type: "string", description: "Slug de um documento relacionado (ex.: o projeto do lote)." },
      },
      ["titulo", "data", "o_que_aconteceu", "regra"],
    ),
    annotations: { title: "Registrar lição", ...grava(false) },
  },
  async executar(ctx, args) {
    const doc = await registrarLicao(
      {
        titulo: texto(args, "titulo", { obrigatorio: true, max: 300 }),
        data: data(args, "data"),
        oQueAconteceu: texto(args, "o_que_aconteceu", { obrigatorio: true }),
        regra: texto(args, "regra", { obrigatorio: true }),
        relacionado: texto(args, "relacionado", { max: 200 }),
      },
      autorDe(ctx.usuario),
    );
    return gravado(doc, "Lição registrada.");
  },
};

export const FERRAMENTAS_DA_MEMORIA: Ferramenta[] = [
  memoriaIndice,
  memoriaBuscar,
  memoriaLer,
  memoriaHistorico,
  memoriaPendentes,
  memoriaSalvar,
  memoriaAcrescentar,
  memoriaRestaurar,
  memoriaMarcarRevisado,
  projetoRegistrar,
  licaoRegistrar,
];
