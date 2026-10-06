"use client";

import { useEffect, useRef, useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Check, Loader2, Ellipsis, Palette, Pencil, Plus, Trash2, X } from "lucide-react";

import { SortableCard, zoomed } from "@/components/pipeline/board-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COLUMN_COLORS, columnColorValue, type BoardCard, type BoardColumn } from "@/lib/board";
import type { Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

export const columnDndId = (id: string) => `column:${id}`;

// Cada coluna cresce com os cards (até a altura do quadro, depois rola), tingida com a cor da fase (--col).
const COLUMN_CLASS =
  "flex max-h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-t-4 border-t-[var(--col)] bg-[color-mix(in_oklch,var(--col)_7%,var(--card))] shadow-sm";

// Variável CSS com a cor da fase, herdada pelos cards da coluna.
export const columnStyle = (color: string | undefined, index: number) => ({ "--col": columnColorValue(color, index) }) as React.CSSProperties;

// Título editável no lugar: clique para renomear, Enter ou sair do campo salva, Esc cancela.
function ColumnTitle({
  title,
  editing,
  setEditing,
  onRename,
}: {
  title: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onRename: (title: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        className="flex min-w-0 items-center gap-2 truncate rounded px-1 text-left font-heading text-sm font-bold hover:bg-muted"
        title="Clique para renomear"
      >
        <span className="size-2.5 shrink-0 rounded-full bg-[var(--col)]" aria-hidden />
        <span className="truncate">{title}</span>
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
  };
  return (
    <Input
      autoFocus
      value={draft}
      aria-label="Nome da coluna"
      maxLength={80}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-7 min-w-0 flex-1 px-1.5 font-heading text-sm"
    />
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onAdd(title);
    setBusy(false);
    if (ok) {
      setDraft("");
      ref.current?.focus();
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus />
        Adicionar card
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        ref={ref}
        autoFocus
        value={draft}
        rows={2}
        maxLength={200}
        placeholder="Título do card…"
        aria-label="Título do novo card"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="min-h-14 resize-none bg-card text-sm"
      />
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={!draft.trim() || busy} onClick={submit}>
          {busy && <Loader2 className="animate-spin" />}
          Adicionar
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
    </div>
  );
}

export function SortableColumn({
  column,
  index,
  zoom,
  cards,
  generations,
  selectedId,
  onSelect,
  onRename,
  onColor,
  onDelete,
  onAddCard,
}: {
  column: BoardColumn;
  index: number;
  zoom: number;
  cards: BoardCard[];
  generations: Map<string, Generation>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (title: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
  onAddCard: (title: string) => Promise<boolean>;
}) {
  const current = COLUMN_COLORS.find((c) => c.value === columnColorValue(column.color, index))?.id;
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: columnDndId(column.id),
    data: { type: "column", columnId: column.id },
  });

  return (
    <section
      ref={setNodeRef}
      style={{ ...columnStyle(column.color, index), transform: zoomed(transform, zoom), transition }}
      className={cn(COLUMN_CLASS, isDragging && "opacity-40")}
      aria-label={`Coluna ${column.title}`}
    >
      <header
        ref={setActivatorNodeRef}
        {...attributes}
        aria-label={`Mover coluna ${column.title}`}
        onPointerDown={(e) => {
          // Campos e botões do cabeçalho não iniciam o arraste da coluna.
          if ((e.target as HTMLElement).closest("input, [data-no-dnd]")) return;
          listeners?.onPointerDown?.(e);
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
        }}
        className="flex h-12 shrink-0 cursor-grab items-center gap-1.5 border-b border-[color-mix(in_oklch,var(--col)_25%,transparent)] bg-[color-mix(in_oklch,var(--col)_14%,transparent)] px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ColumnTitle title={column.title} editing={editing} setEditing={setEditing} onRename={onRename} />
        {!editing && (
          <span className="rounded-full bg-[color-mix(in_oklch,var(--col)_28%,transparent)] px-2 font-mono text-[0.6875rem] font-bold text-foreground tabular-nums">
            {cards.length}
          </span>
        )}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Opções da coluna ${column.title}`} data-no-dnd>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Espera o menu fechar antes de focar o campo de nome. */}
            <DropdownMenuItem onSelect={() => setTimeout(() => setEditing(true), 0)}>
              <Pencil />
              Renomear
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette />
                Cor da fase
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {COLUMN_COLORS.map((c) => (
                  <DropdownMenuItem key={c.id} onSelect={() => onColor(c.id)}>
                    <span className="size-3 rounded-full" style={{ background: c.value }} aria-hidden />
                    {c.label}
                    {current === c.id && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Excluir coluna
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-2.5 pt-2.5 pb-1">
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              columnId={column.id}
              generations={generations}
              selected={card.id === selectedId}
              onSelect={onSelect}
              zoom={zoom}
            />
          ))}
          {cards.length === 0 && (
            <p className="rounded-lg border border-dashed border-[color-mix(in_oklch,var(--col)_35%,transparent)] px-3 py-6 text-center text-xs text-muted-foreground">
              Arraste um card para cá
            </p>
          )}
        </div>
      </SortableContext>

      <div className="shrink-0 p-2 pt-1">
        <AddCard onAdd={onAddCard} />
      </div>
    </section>
  );
}

// Prévia da coluna no overlay do arraste.
export function ColumnOverlay({ column, count, index }: { column: BoardColumn; count: number; index: number }) {
  return (
    <div style={columnStyle(column.color, index)} className={cn(COLUMN_CLASS, "rotate-1 cursor-grabbing shadow-xl ring-1 ring-foreground/20")}>
      <div className="flex h-12 items-center gap-2 bg-[color-mix(in_oklch,var(--col)_14%,transparent)] px-3">
        <span className="size-2.5 rounded-full bg-[var(--col)]" aria-hidden />
        <span className="truncate font-heading text-sm font-bold">{column.title}</span>
        <span className="rounded-full bg-[color-mix(in_oklch,var(--col)_28%,transparent)] px-2 font-mono text-[0.6875rem] font-bold tabular-nums">{count}</span>
      </div>
      <div className="min-h-24" />
    </div>
  );
}

// Coluna fantasma no fim do quadro para criar uma nova. `requestOpen` muda quando o botão da barra é clicado.
export function AddColumn({ onAdd, requestOpen }: { onAdd: (title: string) => Promise<boolean>; requestOpen: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [lastRequest, setLastRequest] = useState(requestOpen);

  if (requestOpen !== lastRequest) {
    setLastRequest(requestOpen);
    setOpen(true);
  }

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }, [open, requestOpen]);

  async function submit() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onAdd(title);
    setBusy(false);
    if (ok) {
      setDraft("");
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="w-72 shrink-0">
      {open ? (
        <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2">
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            placeholder="Nome da coluna…"
            aria-label="Nome da nova coluna"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            className="h-8 bg-card"
          />
          <div className="flex items-center gap-1">
            <Button size="sm" disabled={!draft.trim() || busy} onClick={submit}>
              {busy && <Loader2 className="animate-spin" />}
              Criar coluna
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 w-full items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="size-4" />
          Nova coluna
        </button>
      )}
    </div>
  );
}
