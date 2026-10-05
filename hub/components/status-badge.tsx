import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/data";

const styles: Record<Status, { label: string; className: string }> = {
  ok: { label: "Pronto", className: "bg-ok/15 text-ok" },
  run: { label: "Rodando", className: "bg-rec/15 text-rec" },
  idle: { label: "Na fila", className: "bg-muted text-muted-foreground" },
  warn: { label: "Atenção", className: "bg-warn/15 text-warn" },
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        status === "ok" && "bg-ok",
        status === "run" && "bg-rec animate-pulse motion-reduce:animate-none",
        status === "idle" && "bg-muted-foreground/50",
        status === "warn" && "bg-warn",
        className,
      )}
    />
  );
}

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const s = styles[status];
  return (
    <Badge variant="secondary" className={s.className}>
      {status === "run" && <StatusDot status="run" />}
      {label ?? s.label}
    </Badge>
  );
}
