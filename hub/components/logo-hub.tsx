import { cn } from "@/lib/utils";

// Logo do hub (cata-vento): quatro barras girando em volta do centro azul. As barras seguem a cor do texto; o centro é
// sempre o azul Klein aprovado pelo dono (mais vivo no tema escuro), mesmo que a cor de destaque do hub mude.
// sobreEscuro = fundo escuro em qualquer tema (o menu lateral): usa sempre o azul vivo.
// O ícone da aba e o do celular são o mesmo desenho (app/icon.svg, public/favicon.ico e app/apple-icon.png).
export function LogoHub({ className, sobreEscuro = false }: { className?: string; sobreEscuro?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden focusable="false" className={cn("size-8 shrink-0", className)}>
      <path d="M0 0h40v16H0zM48 0h16v40H48zM24 48h40v16H24zM0 24h16v40H0z" fill="currentColor" />
      <rect x="24" y="24" width="16" height="16" className={sobreEscuro ? "fill-[#427bff]" : "fill-[#0337dc] dark:fill-[#427bff]"} />
    </svg>
  );
}
