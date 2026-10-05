"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Link2, MessageSquare, MousePointerClick, Search, Trash2, Unlink } from "lucide-react";

import { ConfirmDialog, formatDate, GenerationThumb, toolLabel } from "@/components/pipeline/shared";
import { GenerationCard } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OPERATIONS, operationLabel, type BoardCard, type BoardColumn, type Operation } from "@/lib/board";
import type { Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

type CardPatch = Partial<Pick<BoardCard, "title" | "description" | "operation" | "product" | "generationIds">>;

const LABEL = "text-[11px] font-medium tracking-wider text-muted-foreground uppercase";
const NONE = "none"; // o Select do Radix não aceita valor vazio

const operationOptions: { value: string; label: string }[] = [
  { value: NONE, label: "Nenhuma" },
  ...OPERATIONS.map((o) => ({ value: o, label: o === "cod" ? "Dropshipping COD" : operationLabel[o] })),
];

// Rascunho local que salva ao sair do campo e acompanha mudanças externas (ex.: agente do chat) quando não está em edição.
function useDraft(value: string, onSave: (v: string) => void, { required = false } = {}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const [editing, setEditing] = useState(false);
  if (value !== prev) {
    setPrev(value);
    if (!editing) setDraft(value);
  }
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onFocus: () => setEditing(true),
    onBlur: () => {
      setEditing(false);
      const next = draft.trim();
      if (required && !next) return setDraft(value);
      if (next !== value) onSave(next);
    },
  };
}

function LinkGenerationsDialog({
  open,
  onOpenChange,
  generations,
  linked,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generations: Generation[];
  linked: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? generations.filter((g) => `${g.prompt} ${g.tool} ${g.kind}`.toLowerCase().includes(q)) : generations;
  }, [generations, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading">Vincular geração</DialogTitle>
          <DialogDescription>Clique para vincular ou desvincular. As gerações continuam no hub.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por prompt, ferramenta ou tipo…"
            aria-label="Buscar gerações"
            className="pl-8"
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {generations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nada gerado no hub ainda.</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma geração encontrada.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((g) => {
                const on = linked.includes(g.id);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onToggle(g.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors hover:border-foreground/30",
                        on ? "border-rec/60 bg-rec/5" : "border-transparent",
                      )}
                    >
                      <GenerationThumb g={g} className="h-14 w-8" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="line-clamp-2 text-sm">{g.prompt || "(sem prompt)"}</span>
                        <span className="text-xs text-muted-foreground">
                          {toolLabel(g.tool)} · {g.kind === "video" ? "vídeo" : g.kind === "image" ? "imagem" : "áudio"} · {formatDate(g.createdAt)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          on ? "border-rec bg-rec text-white" : "text-transparent",
                        )}
                        aria-hidden
                      >
                        <Check className="size-3" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CardDetails({
  card,
  columns,
  columnId,
  generations,
  generationsById,
  onUpdate,
  onMove,
  onDelete,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  columnId: string;
  generations: Generation[];
  generationsById: Map<string, Generation>;
  onUpdate: (patch: CardPatch) => void;
  onMove: (columnId: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const title = useDraft(card.title, (v) => onUpdate({ title: v }), { required: true });
  const product = useDraft(card.product, (v) => onUpdate({ product: v }));
  const description = useDraft(card.description, (v) => onUpdate({ description: v }));

  const toggleLink = (id: string) =>
    onUpdate({
      generationIds: card.generationIds.includes(id) ? card.generationIds.filter((g) => g !== id) : [...card.generationIds, id],
    });
  const unlink = (id: string) => onUpdate({ generationIds: card.generationIds.filter((g) => g !== id) });

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="card-title" className={LABEL}>
          Título
        </label>
        <Input id="card-title" {...title} maxLength={200} className="h-9 font-heading text-base font-medium md:text-base" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className={LABEL} id="card-column-label">
            Coluna
          </span>
          <Select value={columnId} onValueChange={onMove}>
            <SelectTrigger className="w-full" aria-labelledby="card-column-label">
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
          <span className={LABEL} id="card-operation-label">
            Operação
          </span>
          <Select value={card.operation || NONE} onValueChange={(v) => onUpdate({ operation: (v === NONE ? "" : v) as Operation })}>
            <SelectTrigger className="w-full" aria-labelledby="card-operation-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operationOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="card-product" className={LABEL}>
          Produto
        </label>
        <Input id="card-product" {...product} maxLength={200} placeholder="Ex.: Sérum facial, Curso de inglês…" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="card-description" className={LABEL}>
          Descrição
        </label>
        <Textarea
          id="card-description"
          {...description}
          rows={6}
          placeholder="Ângulo, gancho, roteiro, referências, links…"
          className="min-h-28 text-sm"
        />
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className={LABEL}>
            Gerações vinculadas <span className="font-mono tabular-nums">· {card.generationIds.length}</span>
          </h3>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 />
            Vincular geração
          </Button>
        </div>
        {card.generationIds.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
            Nenhuma geração vinculada. Vincule áudios, vídeos e imagens do hub a este criativo.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {card.generationIds.map((id) => {
              const g = generationsById.get(id);
              if (!g) {
                return (
                  <div key={id} className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    Geração não encontrada (apagada do hub?).
                    <Button variant="ghost" size="xs" onClick={() => unlink(id)}>
                      <Unlink />
                      Desvincular
                    </Button>
                  </div>
                );
              }
              return <GenerationCard key={id} g={g} onDelete={unlink} meta={`${toolLabel(g.tool)} · ${formatDate(g.createdAt)}`} />;
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button asChild>
          <Link href={`/chat?card=${card.id}`}>
            <MessageSquare />
            Trabalhar no chat
          </Link>
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 />
          Excluir card
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Criado em {formatDate(card.createdAt)} · atualizado em {formatDate(card.updatedAt)}
      </p>

      <LinkGenerationsDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        generations={generations}
        linked={card.generationIds}
        onToggle={toggleLink}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Excluir card?"
        description={`"${card.title}" será removido do quadro. As gerações vinculadas continuam no hub.`}
        confirmLabel="Excluir card"
        onConfirm={onDelete}
      />
    </div>
  );
}

export function CardDetailsEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MousePointerClick className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-heading text-base font-medium">Nenhum card selecionado</p>
      <p className="max-w-[32ch] text-sm text-muted-foreground">
        Clique em um card do quadro para ver e editar os detalhes, vincular gerações ou levar o criativo para o chat.
      </p>
    </div>
  );
}
