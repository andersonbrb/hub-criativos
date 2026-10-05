"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Columns3, Loader2, Maximize, PanelRight, Plus, SquareKanban, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

import { CardFace } from "@/components/pipeline/board-card";
import { AddColumn, columnDndId, ColumnOverlay, columnStyle, SortableColumn } from "@/components/pipeline/board-column";
import { CardDetails, CardDetailsEmpty } from "@/components/pipeline/card-details";
import { ConfirmDialog } from "@/components/pipeline/shared";
import { Workspace, WorkspacePanel, type WorkspacePreset } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OPERATIONS, operationLabel, type Board, type BoardCard, type BoardColumn, type Operation } from "@/lib/board";
import { apiFetch, type Generation } from "@/lib/generations";

type CardPatch = Partial<Pick<BoardCard, "title" | "description" | "operation" | "product" | "generationIds">>;
type Active = { type: "card" | "column"; id: string };

// O quadro ocupa a tela; os detalhes ficam fechados e abrem sozinhos ao clicar num card.
const PRESETS: WorkspacePreset[] = [
  { id: "padrao", label: "Padrão", layout: { quadro: 100, detalhes: "collapsed" } },
  { id: "card", label: "Com detalhes", layout: { quadro: 72, detalhes: 28 } },
  { id: "detalhes", label: "Foco no card", layout: { quadro: 50, detalhes: 50 } },
];

// Zoom do quadro (CSS zoom), salvo no navegador. Chave v2: o padrão mudou para 60%.
const ZOOM_KEY = "hub:pipeline:zoom:v2";
const ZOOM_DEFAULT = 0.6;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
// Largura de uma coluna (w-72) + espaço entre colunas (gap-3), em px sem zoom.
const COLUMN_STEP = 288 + 12;

const LABEL = "text-[11px] font-medium tracking-wider text-muted-foreground uppercase";

const columnOf = (board: Board, cardId: string) => board.columns.find((c) => c.cardIds.includes(cardId));

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

function NewCardDialog({
  open,
  onOpenChange,
  columns,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: BoardColumn[];
  onCreate: (input: { columnId: string; title: string; operation: Operation; product: string }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState("");
  const [operation, setOperation] = useState<Operation>("");
  const [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false);
  const column = columns.some((c) => c.id === columnId) ? columnId : (columns[0]?.id ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await onCreate({ columnId: column, title: title.trim(), operation, product: product.trim() });
    setBusy(false);
    if (ok) {
      setTitle("");
      setProduct("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="font-heading">Novo card</DialogTitle>
            <DialogDescription>Um card por criativo. Os detalhes podem ser completados depois.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-card-title" className={LABEL}>
              Título
            </label>
            <Input
              id="new-card-title"
              autoFocus
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Gancho 'médico revela' – sérum"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL} id="new-card-column">
                Coluna
              </span>
              <Select value={column} onValueChange={setColumnId}>
                <SelectTrigger className="w-full" aria-labelledby="new-card-column">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL} id="new-card-operation">
                Operação
              </span>
              <Select value={operation || "none"} onValueChange={(v) => setOperation((v === "none" ? "" : v) as Operation)}>
                <SelectTrigger className="w-full" aria-labelledby="new-card-operation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {OPERATIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o === "cod" ? "Dropshipping COD" : operationLabel[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-card-product" className={LABEL}>
              Produto
            </label>
            <Input id="new-card-product" value={product} maxLength={200} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />}
              Criar card
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PipelineView({ initialBoard, initialGenerations }: { initialBoard: Board; initialGenerations: Generation[] }) {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [generations, setGenerations] = useState<Generation[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [addColumnRequest, setAddColumnRequest] = useState(0);
  const [deletingColumn, setDeletingColumn] = useState<BoardColumn | null>(null);

  const [zoom, setZoomState] = useState(ZOOM_DEFAULT);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const setZoom = useCallback((next: number | ((z: number) => number)) => {
    setZoomState((z) => {
      const value = clampZoom(typeof next === "function" ? next(z) : next);
      try {
        localStorage.setItem(ZOOM_KEY, String(value));
      } catch {}
      return value;
    });
  }, []);

  // Lê o zoom salvo depois de montar (no servidor não há localStorage).
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(ZOOM_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência salva só no navegador
      if (saved) setZoomState(clampZoom(saved));
    } catch {}
  }, []);

  // Ctrl + rolagem (ou pinça no touchpad) dá zoom no quadro. Precisa de listener não passivo para impedir o zoom da página.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // Ajusta o zoom para todas as colunas caberem na largura visível.
  function fitZoom() {
    const width = scrollerRef.current?.clientWidth ?? 0;
    if (!width) return;
    const content = (board.columns.length + 1) * COLUMN_STEP + 24;
    setZoom(Math.min(1, width / content));
  }

  const dragging = useRef(false);
  const snapshot = useRef<Board | null>(null);
  const origin = useRef<{ columnId: string; index: number } | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMoved = useRef(false);

  const generationsById = useMemo(() => new Map(generations.map((g) => [g.id, g])), [generations]);
  const selected = selectedId ? board.cards[selectedId] : undefined;
  const selectedColumn = selected ? columnOf(board, selected.id) : undefined;

  const refetch = useCallback(async () => {
    try {
      const [b, g] = await Promise.all([
        apiFetch<{ board: Board }>("/api/board"),
        apiFetch<{ generations: Generation[] }>("/api/generations"),
      ]);
      if (!dragging.current) setBoard(b.board);
      setGenerations(g.generations);
    } catch (err) {
      toast.error(errorMessage(err, "Não consegui carregar o quadro."));
    }
  }, []);

  // O agente do chat também mexe no quadro: recarrega ao voltar para a janela.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMoved.current = false;
    });
  }, [board]);

  // Falhou no servidor: avisa e volta ao estado real.
  const fail = useCallback(
    (err: unknown, fallback: string) => {
      toast.error(errorMessage(err, fallback));
      refetch();
    },
    [refetch],
  );

  // --- cards ---

  async function createCard(input: { columnId: string; title: string; operation?: Operation; product?: string }) {
    try {
      const { card } = await apiFetch<{ card: BoardCard }>("/api/board/cards", json("POST", input));
      setBoard((prev) => ({
        cards: { ...prev.cards, [card.id]: card },
        columns: prev.columns.map((c) => (c.id === input.columnId ? { ...c, cardIds: [...c.cardIds, card.id] } : c)),
      }));
      return card;
    } catch (err) {
      fail(err, "Não consegui criar o card.");
      return null;
    }
  }

  function updateCard(id: string, patch: CardPatch) {
    setBoard((prev) =>
      prev.cards[id] ? { ...prev, cards: { ...prev.cards, [id]: { ...prev.cards[id], ...patch, updatedAt: new Date().toISOString() } } } : prev,
    );
    apiFetch(`/api/board/cards/${id}`, json("PATCH", patch)).catch((err) => fail(err, "Não consegui salvar o card."));
  }

  function moveCard(id: string, columnId: string, index?: number) {
    setBoard((prev) => {
      const columns = prev.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((x) => x !== id) }));
      const target = columns.find((c) => c.id === columnId);
      if (!target) return prev;
      target.cardIds.splice(index ?? target.cardIds.length, 0, id);
      return { ...prev, columns };
    });
    apiFetch(`/api/board/cards/${id}`, json("PATCH", { columnId, index })).catch((err) => fail(err, "Não consegui mover o card."));
  }

  async function deleteCard(id: string) {
    setSelectedId((s) => (s === id ? null : s));
    setBoard((prev) => {
      const cards = { ...prev.cards };
      delete cards[id];
      return { cards, columns: prev.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((x) => x !== id) })) };
    });
    try {
      await apiFetch(`/api/board/cards/${id}`, { method: "DELETE" });
      toast.success("Card excluído");
    } catch (err) {
      fail(err, "Não consegui excluir o card.");
    }
  }

  // --- colunas ---

  async function createColumn(title: string) {
    try {
      const { column } = await apiFetch<{ column: BoardColumn }>("/api/board/columns", json("POST", { title }));
      setBoard((prev) => ({ ...prev, columns: [...prev.columns, column] }));
      return true;
    } catch (err) {
      fail(err, "Não consegui criar a coluna.");
      return false;
    }
  }

  function setColumnColor(id: string, color: string) {
    setBoard((prev) => ({ ...prev, columns: prev.columns.map((c) => (c.id === id ? { ...c, color } : c)) }));
    apiFetch(`/api/board/columns/${id}`, json("PATCH", { color })).catch((err) => fail(err, "Não consegui mudar a cor da coluna."));
  }

  function renameColumn(id: string, title: string) {
    setBoard((prev) => ({ ...prev, columns: prev.columns.map((c) => (c.id === id ? { ...c, title } : c)) }));
    apiFetch(`/api/board/columns/${id}`, json("PATCH", { title })).catch((err) => fail(err, "Não consegui renomear a coluna."));
  }

  function askDeleteColumn(column: BoardColumn) {
    if (column.cardIds.length) {
      toast.error(`"${column.title}" ainda tem ${column.cardIds.length} card(s). Mova ou exclua antes de excluir a coluna.`);
      return;
    }
    if (board.columns.length === 1) {
      toast.error("O quadro precisa de pelo menos uma coluna.");
      return;
    }
    setDeletingColumn(column);
  }

  async function deleteColumn(id: string) {
    setBoard((prev) => ({ ...prev, columns: prev.columns.filter((c) => c.id !== id) }));
    try {
      await apiFetch(`/api/board/columns/${id}`, { method: "DELETE" });
    } catch (err) {
      fail(err, "Não consegui excluir a coluna.");
    }
  }

  function reorderColumns(columns: BoardColumn[]) {
    setBoard((prev) => ({ ...prev, columns }));
    apiFetch("/api/board", json("PATCH", { columnIds: columns.map((c) => c.id) })).catch((err) =>
      fail(err, "Não consegui reordenar as colunas."),
    );
  }

  // --- arrastar e soltar ---

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter fica livre para selecionar o card; Espaço pega e solta.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  // Colunas só colidem com colunas; cards procuram o card mais próximo dentro da coluna sob o ponteiro.
  const collisionDetection: CollisionDetection = (args) => {
    if (args.active.data.current?.type === "column") {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === "column") });
    }
    const pointer = pointerWithin(args);
    const hits = pointer.length ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, "id");
    if (overId != null) {
      const over = args.droppableContainers.find((c) => c.id === overId);
      if (over?.data.current?.type === "column") {
        const ids = board.columns.find((c) => c.id === over.data.current?.columnId)?.cardIds ?? [];
        const inside = args.droppableContainers.filter((c) => ids.includes(String(c.id)));
        if (inside.length) overId = closestCenter({ ...args, droppableContainers: inside })[0]?.id ?? overId;
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }
    // Logo após trocar de coluna o layout ainda está mudando: mantém o alvo anterior para não oscilar.
    if (recentlyMoved.current) lastOverId.current = args.active.id;
    return lastOverId.current ? [{ id: lastOverId.current }] : [];
  };

  function onDragStart({ active }: DragStartEvent) {
    const type = active.data.current?.type as Active["type"];
    dragging.current = true;
    snapshot.current = board;
    if (type === "card") {
      const id = String(active.id);
      const col = columnOf(board, id);
      origin.current = col ? { columnId: col.id, index: col.cardIds.indexOf(id) } : null;
      setActive({ type, id });
    } else {
      setActive({ type: "column", id: String(active.data.current?.columnId) });
    }
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || active.data.current?.type !== "card") return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const overIsColumn = over.data.current?.type === "column";
    setBoard((prev) => {
      const from = columnOf(prev, activeId);
      const to = overIsColumn ? prev.columns.find((c) => c.id === over.data.current?.columnId) : columnOf(prev, overId);
      if (!from || !to || from.id === to.id) return prev;
      let index = to.cardIds.length;
      if (!overIsColumn) {
        const overIndex = to.cardIds.indexOf(overId);
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        index = overIndex + (below ? 1 : 0);
      }
      recentlyMoved.current = true;
      return {
        ...prev,
        columns: prev.columns.map((c) => {
          if (c.id === from.id) return { ...c, cardIds: c.cardIds.filter((x) => x !== activeId) };
          if (c.id === to.id) return { ...c, cardIds: [...c.cardIds.slice(0, index), activeId, ...c.cardIds.slice(index)] };
          return c;
        }),
      };
    });
  }

  function endDrag() {
    dragging.current = false;
    setActive(null);
    lastOverId.current = null;
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const type = active.data.current?.type;
    endDrag();
    if (!over) {
      if (snapshot.current) setBoard(snapshot.current);
      return;
    }

    if (type === "column") {
      const from = board.columns.findIndex((c) => columnDndId(c.id) === active.id);
      const to = board.columns.findIndex((c) => columnDndId(c.id) === over.id);
      if (from >= 0 && to >= 0 && from !== to) reorderColumns(arrayMove(board.columns, from, to));
      return;
    }

    const id = String(active.id);
    const col = columnOf(board, id);
    if (!col) return;
    let cardIds = col.cardIds;
    if (over.data.current?.type === "card" && col.cardIds.includes(String(over.id)) && over.id !== active.id) {
      cardIds = arrayMove(col.cardIds, col.cardIds.indexOf(id), col.cardIds.indexOf(String(over.id)));
      setBoard((prev) => ({ ...prev, columns: prev.columns.map((c) => (c.id === col.id ? { ...c, cardIds } : c)) }));
    }
    const index = cardIds.indexOf(id);
    if (origin.current?.columnId === col.id && origin.current.index === index) return;
    apiFetch(`/api/board/cards/${id}`, json("PATCH", { columnId: col.id, index })).catch((err) => fail(err, "Não consegui mover o card."));
  }

  function onDragCancel() {
    endDrag();
    if (snapshot.current) setBoard(snapshot.current);
  }

  const cardTitle = (id: UniqueIdentifier) => board.cards[String(id)]?.title ?? "card";
  const columnTitle = (id: UniqueIdentifier | undefined) =>
    board.columns.find((c) => columnDndId(c.id) === id || c.cardIds.includes(String(id)))?.title ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      active.data.current?.type === "column" ? `Coluna ${columnTitle(active.id)} pega.` : `Card ${cardTitle(active.id)} pego.`,
    onDragOver: ({ active, over }) =>
      over ? `${active.data.current?.type === "column" ? "Coluna" : "Card"} sobre ${columnTitle(over.id) || "o quadro"}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${active.data.current?.type === "column" ? "Coluna" : "Card"} solto em ${columnTitle(over.id) || "o quadro"}.` : "Solto fora do quadro.",
    onDragCancel: () => "Arraste cancelado.",
  };

  const activeCard = active?.type === "card" ? board.cards[active.id] : undefined;
  const activeColumn = active?.type === "column" ? board.columns.find((c) => c.id === active.id) : undefined;
  const activeCardColumnIndex = activeCard ? board.columns.findIndex((c) => c.cardIds.includes(activeCard.id)) : -1;
  const totalCards = Object.keys(board.cards).length;

  return (
    <>
      <Workspace
        id="pipeline"
        presets={PRESETS}
        className="h-full"
        toolbar={
          <>
            <h1 className="font-heading text-base font-bold">Fluxo</h1>
            <span className="hidden font-mono text-xs text-muted-foreground tabular-nums sm:inline">
              {totalCards} {totalCards === 1 ? "card" : "cards"}
            </span>
            <span className="flex-1" />
            <Button size="sm" onClick={() => setNewCardOpen(true)}>
              <Plus />
              Novo card
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddColumnRequest((n) => n + 1)}>
              <Columns3 />
              Nova coluna
            </Button>
          </>
        }
      >
        <WorkspacePanel
          id="quadro"
          title="Quadro"
          icon={<SquareKanban className="size-3.5 text-muted-foreground" aria-hidden />}
          defaultSize={100}
          fill
          minSize={30}
          collapsible={false}
          bodyClassName="overflow-hidden"
          actions={
            <div className="flex items-center gap-0.5 rounded-md border bg-card px-0.5" role="group" aria-label="Zoom do quadro">
              <Button variant="ghost" size="icon-xs" aria-label="Diminuir zoom" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => z - 0.1)}>
                <ZoomOut />
              </Button>
              <button
                type="button"
                onClick={() => setZoom(ZOOM_DEFAULT)}
                title={`Voltar para ${Math.round(ZOOM_DEFAULT * 100)}%`}
                className="min-w-11 rounded px-1 text-center font-mono text-[11px] font-semibold tabular-nums hover:bg-muted"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button variant="ghost" size="icon-xs" aria-label="Aumentar zoom" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => z + 0.1)}>
                <ZoomIn />
              </Button>
              <Button variant="ghost" size="xs" onClick={fitZoom} title="Ajustar para todas as colunas caberem na tela">
                <Maximize />
                Ajustar
              </Button>
            </div>
          }
        >
          <DndContext
            id="pipeline-board"
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: "Para pegar, pressione Espaço. Use as setas para mover e Espaço de novo para soltar. Esc cancela.",
              },
            }}
          >
            {/* Rolagem fora, zoom dentro: a altura da área com zoom é compensada (100% / zoom) para o limite de
                altura das colunas ser o do quadro em qualquer zoom. */}
            <div ref={scrollerRef} className="h-full min-h-[60svh] overflow-auto md:min-h-0">
              <div className="flex w-max items-start gap-3 p-3" style={{ zoom, height: `${100 / zoom}%` }}>
              <SortableContext items={board.columns.map((c) => columnDndId(c.id))} strategy={horizontalListSortingStrategy}>
                {board.columns.map((column, index) => (
                  <SortableColumn
                    key={column.id}
                    column={column}
                    index={index}
                    zoom={zoom}
                    onColor={(color) => setColumnColor(column.id, color)}
                    cards={column.cardIds.map((id) => board.cards[id]).filter(Boolean)}
                    generations={generationsById}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onRename={(title) => renameColumn(column.id, title)}
                    onDelete={() => askDeleteColumn(column)}
                    onAddCard={async (title) => Boolean(await createCard({ columnId: column.id, title }))}
                  />
                ))}
              </SortableContext>
              <AddColumn onAdd={createColumn} requestOpen={addColumnRequest} />
              </div>
            </div>
            {/* O overlay fica fora da área com zoom: aplica o mesmo zoom e a cor da coluna de origem. */}
            <DragOverlay>
              {activeCard ? (
                <div style={{ zoom, ...columnStyle(board.columns[activeCardColumnIndex]?.color, Math.max(0, activeCardColumnIndex)) }}>
                  <CardFace card={activeCard} generations={generationsById} selected={activeCard.id === selectedId} overlay />
                </div>
              ) : activeColumn ? (
                <div style={{ zoom }} className="h-full">
                  <ColumnOverlay column={activeColumn} count={activeColumn.cardIds.length} index={board.columns.indexOf(activeColumn)} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </WorkspacePanel>

        <WorkspacePanel
          id="detalhes"
          title="Detalhes do card"
          icon={<PanelRight className="size-3.5 text-muted-foreground" aria-hidden />}
          defaultSize={28}
          minSize={20}
          defaultCollapsed
          revealKey={selectedId}
        >
          {selected && selectedColumn ? (
            <CardDetails
              key={selected.id}
              card={selected}
              columns={board.columns}
              columnId={selectedColumn.id}
              generations={generations}
              generationsById={generationsById}
              onUpdate={(patch) => updateCard(selected.id, patch)}
              onMove={(columnId) => moveCard(selected.id, columnId)}
              onDelete={() => deleteCard(selected.id)}
            />
          ) : (
            <CardDetailsEmpty />
          )}
        </WorkspacePanel>
      </Workspace>

      <NewCardDialog
        open={newCardOpen}
        onOpenChange={setNewCardOpen}
        columns={board.columns}
        onCreate={async (input) => {
          const card = await createCard(input);
          if (card) setSelectedId(card.id);
          return Boolean(card);
        }}
      />
      <ConfirmDialog
        open={Boolean(deletingColumn)}
        onOpenChange={(open) => !open && setDeletingColumn(null)}
        title="Excluir coluna?"
        description={deletingColumn ? `A coluna "${deletingColumn.title}" está vazia e será removida do quadro.` : ""}
        confirmLabel="Excluir coluna"
        onConfirm={() => (deletingColumn ? deleteColumn(deletingColumn.id) : undefined)}
      />
    </>
  );
}
