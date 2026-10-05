import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { COLUMN_COLORS, DEFAULT_COLUMNS, defaultColumnColor, OPERATIONS, slugify, type Board, type BoardCard, type BoardColumn, type Operation } from "@/lib/board";
import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// Quadro Kanban do Pipeline salvo em hub/.data/board.json. Usado pela interface e pelo agente do chat.

const BOARD_FILE = path.join(DATA_DIR, "board.json");

let queue: Promise<unknown> = Promise.resolve();

function defaultBoard(): Board {
  return {
    columns: DEFAULT_COLUMNS.map((title, i) => ({ id: slugify(title), title, cardIds: [], color: defaultColumnColor(i) })),
    cards: {},
  };
}

// Garante que cada card está em exatamente uma coluna (corrige edições manuais do JSON).
function normalize(board: Board): Board {
  const cards = board.cards ?? {};
  if (!Array.isArray(board.columns) || !board.columns.length) board.columns = defaultBoard().columns;
  const seen = new Set<string>();
  board.columns.forEach((col, i) => {
    // Colunas criadas antes das cores ganham a cor padrão da posição (fica salva na próxima escrita).
    if (!COLUMN_COLORS.some((c) => c.id === col.color)) col.color = defaultColumnColor(i);
  });
  for (const col of board.columns) {
    col.cardIds = (col.cardIds ?? []).filter((id) => {
      if (!cards[id] || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  for (const id of Object.keys(cards)) if (!seen.has(id)) board.columns[0].cardIds.push(id);
  return { columns: board.columns, cards };
}

async function load(): Promise<Board> {
  try {
    return normalize(JSON.parse(await readFile(BOARD_FILE, "utf8")) as Board);
  } catch {
    return defaultBoard();
  }
}

async function save(board: Board) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${BOARD_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(board, null, 2));
  await rename(tmp, BOARD_FILE);
}

// Serializa as escritas para não perder atualizações concorrentes (interface + agente).
function withBoard<T>(fn: (board: Board) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const board = await load();
    const result = await fn(board);
    await save(board);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

// --- validação ---

function text(value: unknown, field: string, { required = false, max = 20000 } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw new InputError(`Informe ${field}.`);
    return "";
  }
  if (typeof value !== "string") throw new InputError(`${field} precisa ser texto.`);
  const v = value.trim();
  if (required && !v) throw new InputError(`Informe ${field}.`);
  if (v.length > max) throw new InputError(`${field} muito longo (máx. ${max} caracteres).`);
  return v;
}

function operation(value: unknown): Operation {
  if (value === undefined || value === null || value === "") return "";
  if (!OPERATIONS.includes(value as Operation)) throw new InputError('Operação inválida: use "infoproduto", "cod" ou vazio.');
  return value as Operation;
}

function generationIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new InputError("generationIds precisa ser uma lista de ids.");
  return [...new Set(value as string[])];
}

function findColumn(board: Board, id: string): BoardColumn {
  const col = board.columns.find((c) => c.id === id);
  if (!col) throw new InputError(`Coluna não encontrada: ${id}`);
  return col;
}

function findCard(board: Board, id: string): BoardCard {
  const card = board.cards[id];
  if (!card) throw new InputError(`Card não encontrado: ${id}`);
  return card;
}

// --- operações ---

export async function getBoard(): Promise<Board> {
  await queue;
  return load();
}

export async function createCard(input: {
  columnId?: string;
  title: string;
  description?: string;
  operation?: Operation;
  product?: string;
  generationIds?: string[];
}): Promise<BoardCard> {
  return withBoard((board) => {
    const col = input.columnId ? findColumn(board, input.columnId) : board.columns[0];
    const now = new Date().toISOString();
    const card: BoardCard = {
      id: randomUUID(),
      title: text(input.title, "o título do card", { required: true, max: 200 }),
      description: text(input.description, "a descrição"),
      operation: operation(input.operation),
      product: text(input.product, "o produto", { max: 200 }),
      generationIds: generationIds(input.generationIds),
      createdAt: now,
      updatedAt: now,
    };
    board.cards[card.id] = card;
    col.cardIds.push(card.id);
    return card;
  });
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<BoardCard, "title" | "description" | "operation" | "product" | "generationIds">>,
): Promise<BoardCard> {
  return withBoard((board) => {
    const card = findCard(board, id);
    if (patch.title !== undefined) card.title = text(patch.title, "o título do card", { required: true, max: 200 });
    if (patch.description !== undefined) card.description = text(patch.description, "a descrição");
    if (patch.operation !== undefined) card.operation = operation(patch.operation);
    if (patch.product !== undefined) card.product = text(patch.product, "o produto", { max: 200 });
    if (patch.generationIds !== undefined) card.generationIds = generationIds(patch.generationIds);
    card.updatedAt = new Date().toISOString();
    return card;
  });
}

// Sem index, o card vai para o fim da coluna.
export async function moveCard(id: string, columnId: string, index?: number): Promise<Board> {
  return withBoard((board) => {
    const card = findCard(board, id);
    const target = findColumn(board, columnId);
    if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index) || index < 0)) {
      throw new InputError("index precisa ser um inteiro maior ou igual a 0.");
    }
    for (const col of board.columns) col.cardIds = col.cardIds.filter((c) => c !== id);
    const at = index === undefined ? target.cardIds.length : Math.min(index, target.cardIds.length);
    target.cardIds.splice(at, 0, id);
    card.updatedAt = new Date().toISOString();
    return board;
  });
}

export async function deleteCard(id: string): Promise<void> {
  return withBoard((board) => {
    findCard(board, id);
    delete board.cards[id];
    for (const col of board.columns) col.cardIds = col.cardIds.filter((c) => c !== id);
  });
}

export async function createColumn(title: string): Promise<BoardColumn> {
  return withBoard((board) => {
    const name = text(title, "o nome da coluna", { required: true, max: 80 });
    const base = slugify(name) || "coluna";
    let id = base;
    for (let n = 2; board.columns.some((c) => c.id === id); n++) id = `${base}-${n}`;
    const col: BoardColumn = { id, title: name, cardIds: [], color: defaultColumnColor(board.columns.length) };
    board.columns.push(col);
    return col;
  });
}

export async function updateColumn(id: string, patch: { title?: string; color?: string }): Promise<BoardColumn> {
  return withBoard((board) => {
    const col = findColumn(board, id);
    if (patch.title !== undefined) col.title = text(patch.title, "o nome da coluna", { required: true, max: 80 });
    if (patch.color !== undefined) {
      if (!COLUMN_COLORS.some((c) => c.id === patch.color)) throw new InputError(`Cor inválida. Use: ${COLUMN_COLORS.map((c) => c.id).join(", ")}.`);
      col.color = patch.color;
    }
    return col;
  });
}

// Recusa excluir coluna com cards, para nada sumir sem querer.
export async function deleteColumn(id: string): Promise<void> {
  return withBoard((board) => {
    const col = findColumn(board, id);
    if (col.cardIds.length) throw new InputError(`A coluna "${col.title}" ainda tem ${col.cardIds.length} card(s). Mova ou exclua antes.`);
    if (board.columns.length === 1) throw new InputError("O quadro precisa de pelo menos uma coluna.");
    board.columns = board.columns.filter((c) => c.id !== id);
  });
}

export async function reorderColumns(columnIds: string[]): Promise<Board> {
  return withBoard((board) => {
    if (!Array.isArray(columnIds)) throw new InputError("columnIds precisa ser uma lista.");
    const ids = new Set(columnIds);
    if (ids.size !== columnIds.length || columnIds.length !== board.columns.length || board.columns.some((c) => !ids.has(c.id))) {
      throw new InputError("columnIds precisa conter todas as colunas do quadro, cada uma uma vez.");
    }
    board.columns = columnIds.map((id) => findColumn(board, id));
    return board;
  });
}

// Corpo JSON dos route handlers do quadro; JSON inválido vira 400.
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => {
    throw new InputError("Corpo da requisição precisa ser JSON.");
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Corpo da requisição precisa ser um objeto JSON.");
  return body as Record<string, unknown>;
}
