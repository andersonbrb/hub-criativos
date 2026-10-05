// Tipos do quadro Kanban do Pipeline, compartilhados entre servidor, interface e ferramentas do agente.

export type Operation = "infoproduto" | "cod" | "";

export type BoardCard = {
  id: string;
  title: string;
  description: string; // notas livres
  operation: Operation;
  product: string;
  generationIds: string[]; // gerações do hub (lib/generations.ts) vinculadas ao card
  createdAt: string;
  updatedAt: string;
};

// color: id de COLUMN_COLORS (cor da fase no quadro). Colunas antigas sem cor recebem a padrão da posição.
export type BoardColumn = { id: string; title: string; cardIds: string[]; color?: string };

export const COLUMN_COLORS = [
  { id: "violeta", label: "Violeta", value: "oklch(0.65 0.18 295)" },
  { id: "azul", label: "Azul", value: "oklch(0.64 0.16 255)" },
  { id: "ambar", label: "Âmbar", value: "oklch(0.76 0.15 78)" },
  { id: "ciano", label: "Ciano", value: "oklch(0.7 0.12 210)" },
  { id: "laranja", label: "Laranja", value: "oklch(0.7 0.17 48)" },
  { id: "verde", label: "Verde", value: "oklch(0.68 0.15 158)" },
  { id: "rosa", label: "Rosa", value: "oklch(0.66 0.2 0)" },
  { id: "grafite", label: "Grafite", value: "oklch(0.62 0.03 265)" },
] as const;

export const defaultColumnColor = (index: number) => COLUMN_COLORS[index % COLUMN_COLORS.length].id;

export const columnColorValue = (color: string | undefined, index: number) =>
  (COLUMN_COLORS.find((c) => c.id === color) ?? COLUMN_COLORS.find((c) => c.id === defaultColumnColor(index))!).value;

export type Board = { columns: BoardColumn[]; cards: Record<string, BoardCard> };

export const OPERATIONS: Operation[] = ["infoproduto", "cod"];

export const operationLabel: Record<Operation, string> = {
  infoproduto: "Infoproduto",
  cod: "COD",
  "": "Nenhuma",
};

export const DEFAULT_COLUMNS = ["Ideias", "Roteiro / Copy", "Produção", "Edição", "Revisão", "Pronto para subir"];

export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
