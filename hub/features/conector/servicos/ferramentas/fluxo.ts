import "server-only";

import { SO_LEITURA, cortar, esquema, grava, listaQueCabe, type Ferramenta } from "@/features/conector/servicos/ferramentas/comum";
import { OPERATIONS, type BoardCard, type Operation } from "@/lib/board";
import { createCard, getBoard, moveCard, updateCard } from "@/lib/server/board";
import { InputError } from "@/lib/server/http";

// O Fluxo (quadro Kanban da produção) pelo conector. A lógica é a mesma das ferramentas pipeline_get e
// pipeline_save_card do chat interno (lib/server/chat/tools.ts): mude as duas juntas.

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

const fluxoVer: Ferramenta = {
  chave: "fluxo",
  definicao: {
    name: "fluxo_ver",
    title: "Ver o Fluxo",
    description:
      "Lê o Fluxo, o quadro Kanban da produção de criativos do Hub: as colunas (etapas) e os cards de cada uma, com operação, produto, descrição e os ids das gerações (arquivos) vinculadas. Use para saber em que pé está cada criativo antes de mexer em um card.",
    inputSchema: esquema({}),
    annotations: { title: "Ver o Fluxo", ...SO_LEITURA },
  },
  async executar() {
    const board = await getBoard();
    const colunas = board.columns.map((col) => ({
      id: col.id,
      titulo: col.title,
      cards: col.cardIds
        .map((id) => board.cards[id])
        .filter(Boolean)
        .map((c) => ({
          id: c.id,
          titulo: c.title,
          operacao: c.operation,
          produto: c.product,
          descricao: cortar(c.description, 400),
          geracoes: c.generationIds,
        })),
    }));
    // O quadro inteiro raramente passa do teto; se passar, cards somem do fim da última coluna para a primeira.
    const cards = colunas.flatMap((c) => c.cards.map((card) => ({ coluna: c, card })));
    return listaQueCabe(cards, (itens, cortados) => ({
      colunas: colunas.map((c) => ({ ...c, cards: itens.filter((i) => i.coluna === c).map((i) => i.card) })),
      total_cards: cards.length,
      ...(cortados ? { aviso: `${cortados} card(s) ficaram de fora por tamanho da resposta.` } : {}),
    }));
  },
};

const fluxoSalvarCard: Ferramenta = {
  chave: "fluxo",
  definicao: {
    name: "fluxo_salvar_card",
    title: "Salvar card do Fluxo",
    description:
      "Cria ou atualiza um card do Fluxo (quadro Kanban da produção). Sem `card_id`, cria um card novo (precisa de `titulo`). Com `card_id`, muda só os campos enviados. `coluna` aceita o id ou o nome da coluna e move o card de etapa. `adicionar_geracoes` vincula arquivos do Hub ao card (ids de biblioteca_listar ou do link_de_envio).",
    inputSchema: esquema({
      card_id: { type: "string", description: "Id do card a atualizar (de fluxo_ver). Sem ele, cria um novo." },
      titulo: { type: "string", description: "Título do card." },
      descricao: { type: "string", description: "Notas livres do card (substitui as atuais)." },
      operacao: { type: "string", enum: [...OPERATIONS, ""], description: 'Operação: "infoproduto", "cod" ou "" (nenhuma).' },
      produto: { type: "string", description: "Produto do criativo." },
      coluna: { type: "string", description: "Id ou nome da coluna (etapa) para onde o card vai." },
      adicionar_geracoes: { type: "array", items: { type: "string" }, description: "Ids de gerações (arquivos do Hub) para vincular ao card." },
    }),
    annotations: { title: "Salvar card do Fluxo", ...grava(false) },
  },
  // As validações do quadro (lib/server/board.ts) lançam InputError: o despachante devolve o texto ao modelo.
  async executar(_ctx, args) {
    const board = await getBoard();
    const colInput = str(args.coluna).trim().toLowerCase();
    const column = colInput ? board.columns.find((c) => c.id === colInput || c.title.toLowerCase() === colInput) : undefined;
    if (colInput && !column) throw new InputError(`Coluna não encontrada: ${str(args.coluna)}. Colunas: ${board.columns.map((c) => c.title).join(", ")}.`);
    const operation = args.operacao === "" ? "" : OPERATIONS.some((o) => o === args.operacao) ? (args.operacao as Operation) : undefined;
    const addIds = (Array.isArray(args.adicionar_geracoes) ? args.adicionar_geracoes : []).map(str);
    const fields = {
      ...(typeof args.titulo === "string" ? { title: args.titulo } : {}),
      ...(typeof args.descricao === "string" ? { description: args.descricao } : {}),
      ...(operation !== undefined ? { operation } : {}),
      ...(typeof args.produto === "string" ? { product: args.produto } : {}),
    };
    let card: BoardCard;
    if (args.card_id) {
      const current = board.cards[str(args.card_id)];
      if (!current) throw new InputError("Card não encontrado. Use fluxo_ver para achar o id certo.");
      card = await updateCard(current.id, { ...fields, ...(addIds.length ? { generationIds: [...new Set([...current.generationIds, ...addIds])] } : {}) });
      if (column) await moveCard(card.id, column.id);
    } else {
      if (!fields.title) throw new InputError("Informe o título do card.");
      card = await createCard({ ...fields, title: fields.title, columnId: column?.id, generationIds: addIds });
    }
    return JSON.stringify({ ok: true, criado: !args.card_id, card, coluna: column?.title });
  },
};

export const FERRAMENTAS_DO_FLUXO: Ferramenta[] = [fluxoVer, fluxoSalvarCard];
