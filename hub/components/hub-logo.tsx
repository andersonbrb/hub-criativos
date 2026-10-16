import { LogoHub } from "@/components/logo-hub";
import { cn } from "@/lib/utils";

// Marca do hub: o cata-vento escolhido pelo dono (components/logo-hub.tsx), com o centro sempre azul.
// Por padrão vai sobre fundo escuro (menu lateral e login): barras brancas e azul vivo. claro = barras na cor do texto.
export function HubMark({ className, claro = false }: { className?: string; claro?: boolean }) {
  return <LogoHub sobreEscuro={!claro} className={cn("hub-mark", claro ? "text-foreground" : "text-white", className)} />;
}

// Logo completo: marca + "Hub de Criativos". inverse = sobre fundo escuro (menu lateral, login).
export function HubLogo({ inverse = false, large = false, className }: { inverse?: boolean; large?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 leading-none whitespace-nowrap", className)}>
      <HubMark claro={!inverse} className={large ? "size-9" : "size-8"} />
      <span className={cn("hub-wordmark inline-flex items-baseline gap-1.5", large ? "text-[1.375rem]" : "text-[1.1875rem]")}>
        <strong className={cn("font-heading font-bold tracking-[-0.04em]", inverse ? "text-white" : "text-foreground")}>Hub</strong>
        <span className={cn("font-light tracking-[-0.03em]", inverse ? "text-[#b7c6ef]" : "text-muted-foreground")}>de Criativos</span>
      </span>
    </span>
  );
}
