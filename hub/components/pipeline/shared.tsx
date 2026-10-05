"use client";

import { useState } from "react";
import { AlertTriangle, AudioLines, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { operationLabel, type Operation } from "@/lib/board";
import { mediaUrl, type Generation, type GenerationTool } from "@/lib/generations";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Partial<Record<GenerationTool, string>> = {
  elevenlabs: "ElevenLabs",
  heygen: "HeyGen",
  higgsfield: "Higgsfield",
  flora: "FLORA",
  upload: "Upload",
  editor: "Editor",
  montagem: "Montagem",
};

export const toolLabel = (tool: GenerationTool) => TOOL_LABELS[tool] ?? tool;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function OperationBadge({ operation, className }: { operation: Operation; className?: string }) {
  if (!operation) return null;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-4.5 px-1.5 text-[10px]",
        operation === "infoproduto" ? "bg-track-avatar/15 text-track-avatar" : "bg-track-broll/15 text-track-broll",
        className,
      )}
    >
      {operationLabel[operation]}
    </Badge>
  );
}

// Miniatura de uma geração: vídeo (só o primeiro quadro), imagem ou ícone de áudio.
export function GenerationThumb({ g, className }: { g: Generation; className?: string }) {
  const url = mediaUrl(g);
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted", className);
  if (g.status === "pending" || g.status === "running") {
    return (
      <span className={box} title="Gerando">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      </span>
    );
  }
  if (g.status === "failed" || !url) {
    return (
      <span className={box} title={g.error ?? "Falhou"}>
        <AlertTriangle className="size-3.5 text-warn" />
      </span>
    );
  }
  if (g.kind === "audio") {
    return (
      <span className={box} title={g.prompt}>
        <AudioLines className="size-3.5 text-track-voz" />
      </span>
    );
  }
  return (
    <span className={box} title={g.prompt}>
      {g.kind === "video" ? (
        <video src={url} preload="metadata" muted playsInline className="pointer-events-none size-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- mídia local gerada
        <img src={url} alt="" loading="lazy" draggable={false} className="pointer-events-none size-full object-cover" />
      )}
    </span>
  );
}

// Confirmação simples para ações destrutivas.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
