import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Estado vazio no estilo do ElevenLabs: ícone num quadrado, título e uma linha de ajuda.
export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center", className)}>
      <span className="hub-empty-icon mb-4">
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <h3 className="font-heading text-base">{title}</h3>
      {children && <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}
