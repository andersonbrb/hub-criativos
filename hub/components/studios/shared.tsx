"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Clapperboard, Download, Eraser, Eye, KeyRound, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  apiFetch,
  downloadName,
  estimateProgress,
  formatRemaining,
  generationTitle,
  mediaUrl,
  type Generation,
  type GenerationTool,
} from "@/lib/generations";
import type { Status } from "@/lib/data";
import { cn } from "@/lib/utils";

export function MissingKey({ envVar, where }: { envVar: string; where: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="grid gap-1">
        <p className="font-medium">Falta conectar a chave de API</p>
        <p className="text-muted-foreground">
          Crie uma chave em {where} e adicione no arquivo <code className="font-mono text-foreground">hub/.env.local</code>:
        </p>
        <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-xs">{envVar}=sua_chave_aqui</code>
        <p className="text-muted-foreground">Depois reinicie o servidor (npm run dev).</p>
      </div>
    </div>
  );
}

export function Field({ label, id, hint, children }: { label: string; id?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider text-foreground/85 uppercase">
          <span className="size-1.5 shrink-0 rounded-full bg-rec/80" aria-hidden />
          {label}
        </label>
        {hint && <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  left,
  right,
  format = (v: number) => `${Math.round(v * 100)}%`,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  left?: string;
  right?: string;
  format?: (v: number) => string;
}) {
  return (
    <Field label={label} hint={format(value)}>
      <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
      {(left || right) && (
        <div className="flex justify-between text-[0.6875rem] text-muted-foreground">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </Field>
  );
}

// Lista de gerações de uma ferramenta, com atualização automática enquanto houver jobs rodando.
export function useGenerations(tool: GenerationTool, poll?: (g: Generation) => Promise<Generation | null>) {
  const [items, setItems] = useState<Generation[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ generations: Generation[] }>(`/api/generations?tool=${tool}`);
      setItems(data.generations);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui carregar o histórico.");
    } finally {
      setLoaded(true);
    }
  }, [tool]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do servidor
    refresh();
  }, [refresh]);

  const pending = items.filter((g) => g.status === "pending" || g.status === "running");
  const pendingKey = pending.map((g) => g.id).join(",");

  useEffect(() => {
    if (!poll || !pendingKey) return;
    const timer = setInterval(async () => {
      const ids = pendingKey.split(",");
      const updates = await Promise.all(
        ids.map((id) => {
          const g = items.find((x) => x.id === id);
          return g ? poll(g).catch(() => null) : null;
        }),
      );
      const changed = updates.filter((u): u is Generation => Boolean(u));
      if (changed.length) {
        setItems((prev) => prev.map((g) => changed.find((c) => c.id === g.id) ?? g));
        for (const c of changed) {
          if (c.status === "done") toast.success("Geração pronta");
          if (c.status === "failed") toast.error(c.error ?? "A geração falhou");
        }
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [poll, pendingKey, items]);

  const add = (g: Generation) => setItems((prev) => [g, ...prev]);
  const remove = async (id: string) => {
    await apiFetch(`/api/generations/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((g) => g.id !== id));
  };
  // Apaga o histórico da ferramenta, menos o que está gerando e o que está salvo na Biblioteca.
  const clear = async () => {
    const { removed } = await apiFetch<{ removed: string[] }>(`/api/generations?tool=${tool}`, { method: "DELETE" });
    setItems((prev) => prev.filter((g) => !removed.includes(g.id)));
    return removed.length;
  };

  return { items, loaded, add, remove, clear, refresh };
}

// Barra fina com % e tempo restante, estimados pelo tempo médio de cada tipo de geração (lib/generations.ts).
// Sem previsão para o tipo, não mostra nada (fica só o "Gerando…").
export function GenerationProgress({ g, className }: { g: Generation; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = estimateProgress(g, now);
  if (!p) return null;
  return (
    <div className={cn("flex w-full flex-col gap-1", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label="Progresso estimado">
      <div className="h-1 w-full overflow-hidden bg-muted-foreground/20">
        <div className="h-full bg-rec transition-[width] duration-1000 ease-linear" style={{ width: `${p.pct}%` }} />
      </div>
      <div className="flex justify-between font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
        <span>{p.pct}%</span>
        <span>{p.late ? "quase lá…" : `${formatRemaining(p.remaining)} restantes`}</span>
      </div>
    </div>
  );
}

const statusMap: Record<Generation["status"], Status> = { pending: "idle", running: "run", done: "ok", failed: "warn" };
const statusLabel: Record<Generation["status"], string> = { pending: "Na fila", running: "Gerando", done: "Pronto", failed: "Falhou" };

export function GenerationCard({
  g,
  onDelete,
  onSavedChange,
  title,
  meta,
  className,
}: {
  g: Generation;
  onDelete: (id: string) => void;
  // Avisa quem lista (ex.: a Biblioteca tira o card ao desmarcar).
  onSavedChange?: (g: Generation) => void;
  title?: string;
  meta?: string;
  className?: string;
}) {
  const url = mediaUrl(g);
  const busy = g.status === "pending" || g.status === "running";
  const [saved, setSaved] = useState(Boolean(g.saved));
  const [saving, setSaving] = useState(false);
  // Renomear: o nome novo vale na hora (o card pode estar numa lista que só recarrega depois).
  const [renamed, setRenamed] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const shownTitle = renamed ?? generationTitle(g, title);
  const named = { ...g, name: renamed ?? g.name };

  async function commitName() {
    const value = editing?.replace(/\s+/g, " ").trim() ?? "";
    setEditing(null);
    if (value === shownTitle) return;
    try {
      const { generation } = await apiFetch<{ generation: Generation }>(`/api/generations/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      setRenamed(generationTitle(generation, title));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui renomear.");
    }
  }

  async function toggleSaved() {
    setSaving(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>(`/api/generations/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved: !saved }),
      });
      setSaved(Boolean(generation.saved));
      onSavedChange?.(generation);
      toast.success(generation.saved ? "Salvo na Biblioteca" : "Removido da Biblioteca");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border bg-card", className)}>
      {g.kind !== "audio" && (
        <div className="relative flex aspect-[9/16] max-h-80 items-center justify-center bg-muted">
          {g.status === "done" && url ? (
            g.kind === "video" ? (
              <video src={url} controls playsInline className="size-full object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- mídia local gerada
              <img src={url} alt={g.prompt} className="size-full object-contain" />
            )
          ) : busy ? (
            <div className="flex w-full flex-col items-center gap-3 px-5">
              <TextShimmer className="text-center text-sm" duration={1.6}>
                {g.status === "pending" ? "Na fila…" : "Gerando…"}
              </TextShimmer>
              <GenerationProgress g={g} />
            </div>
          ) : (
            <p className="px-4 text-center text-xs text-destructive">{g.error ?? "Falhou"}</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          {editing !== null ? (
            <input
              autoFocus
              value={editing}
              maxLength={100}
              aria-label="Novo nome"
              placeholder="Vazio = nome automático"
              onChange={(e) => setEditing(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
              }}
              className="min-w-0 flex-1 border border-rec bg-background px-1.5 py-0.5 text-sm outline-none"
            />
          ) : (
            <p className="line-clamp-2 text-sm" title={g.prompt} onDoubleClick={() => setEditing(shownTitle)}>
              {shownTitle}
            </p>
          )}
          <StatusBadge status={statusMap[g.status]} label={statusLabel[g.status]} />
        </div>
        {g.kind === "audio" && busy && <GenerationProgress g={g} />}
        {g.kind === "audio" && g.status === "done" && url && <audio src={url} controls className="h-9 w-full" />}
        {g.kind === "audio" && g.status === "failed" && <p className="text-xs text-destructive">{g.error}</p>}
        {g.kind === "video" && g.status === "done" && url && (
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="xs" asChild>
              <a href={`/ver/${g.id}`} target="_blank" rel="noreferrer">
                <Eye />
                Visualizar
              </a>
            </Button>
            <Button variant="outline" size="xs" asChild>
              <a href={`/editor?gen=${g.id}`}>
                <Clapperboard />
                Editor
              </a>
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{meta}</span>
          <span className="flex shrink-0 gap-1">
            {url && g.status === "done" && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={saved ? "Tirar da Biblioteca" : "Salvar na Biblioteca"}
                title={saved ? "Tirar da Biblioteca" : "Salvar na Biblioteca"}
                aria-pressed={saved}
                disabled={saving}
                onClick={toggleSaved}
                className={cn(saved && "text-rec")}
              >
                {saved ? <BookmarkCheck /> : <Bookmark />}
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="Renomear" title="Renomear" onClick={() => setEditing(shownTitle)}>
              <Pencil />
            </Button>
            {url && g.status === "done" && (
              <Button variant="ghost" size="icon-xs" asChild aria-label="Baixar">
                <a href={url} download={downloadName(named)}>
                  <Download />
                </a>
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="Apagar" onClick={() => onDelete(g.id)}>
              <Trash2 />
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

// Cabeçalho da aba de histórico: contagem + "Limpar" (com confirmação).
export function HistoryActions({ count, onClear }: { count: number; onClear: () => Promise<number> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const n = await onClear();
      toast.success(n ? `${n} ${n === 1 ? "item apagado" : "itens apagados"}` : "Nada para limpar");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui limpar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="text-xs text-muted-foreground tabular-nums">{count} itens</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="xs" disabled={count === 0} className="text-muted-foreground">
            <Eraser />
            Limpar
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Limpar o histórico?</DialogTitle>
            <DialogDescription>
              Apaga as gerações prontas e as que falharam, junto com os arquivos. O que ainda está gerando e o que você salvou na
              Biblioteca continua.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirm} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Limpar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HistoryPanel({
  title = "Histórico",
  count,
  loaded,
  empty,
  children,
  className,
  bare = false,
}: {
  title?: string;
  count: number;
  loaded: boolean;
  empty: string;
  children: React.ReactNode;
  className?: string;
  // Sem o Card (título e contagem ficam no cabeçalho da aba do Workspace).
  bare?: boolean;
}) {
  if (bare) {
    return !loaded ? (
      <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
    ) : count === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
    ) : (
      <div className={className}>{children}</div>
    );
  }
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-4 py-3!">
        <CardTitle className="font-heading">{title}</CardTitle>
        <CardAction className="text-xs text-muted-foreground">{count} itens</CardAction>
      </CardHeader>
      <CardContent className={cn("p-4", className)}>
        {!loaded ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : count === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
