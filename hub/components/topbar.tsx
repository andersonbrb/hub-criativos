import { LogOut, Upload } from "lucide-react";

import { Breadcrumb } from "@/components/breadcrumb";
import { LayoutModeToggle } from "@/components/layout-mode-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { ToastButton } from "@/components/toast-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ROTULO_DO_PAPEL, type Usuario } from "@/features/acesso/contrato";

export function Topbar({ usuario }: { usuario: Usuario }) {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 flex-nowrap items-center gap-2 overflow-hidden border-b bg-background/90 px-3 backdrop-blur sm:gap-3 md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-4!" />
      <Breadcrumb />
      <div className="flex-1" />
      <LayoutModeToggle />
      <ThemeToggle />
      <ToastButton size="sm" className="bg-rec text-white hover:bg-rec/85" message="Exportação enfileirada: 6 variações, 9:16, 1080×1920">
        <Upload />
        <span className="hidden sm:inline [html[data-mobile-frame]_&]:hidden">Exportar</span>
      </ToastButton>
      <Separator orientation="vertical" className="h-4!" />
      <span className="hidden max-w-40 truncate text-sm md:inline [html[data-mobile-frame]_&]:hidden" title={`${usuario.email} · ${ROTULO_DO_PAPEL[usuario.papel]}`}>
        {usuario.nome}
      </span>
      {/* Formulário puro: sai sem depender de JavaScript e cai direto na tela de entrar. */}
      <form method="post" action="/api/acesso/sair">
        <Button type="submit" size="sm" variant="ghost" title="Sair da conta">
          <LogOut />
          <span className="hidden sm:inline [html[data-mobile-frame]_&]:hidden">Sair</span>
        </Button>
      </form>
    </header>
  );
}
