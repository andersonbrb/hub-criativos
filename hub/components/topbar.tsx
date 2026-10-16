"use client";

import { Menu, Search } from "lucide-react";

import { AccountMenu, abrirBusca } from "@/components/account-menu";
import { HubLogo } from "@/components/hub-logo";
import { useSidebar } from "@/components/ui/sidebar";
import type { Usuario } from "@/features/acesso/contrato";

// Barra do topo só na versão celular (no computador o menu lateral faz tudo): abre o menu, mostra a marca,
// a busca e a conta.
export function Topbar({ usuario }: { usuario: Usuario }) {
  const { isMobile, setOpenMobile } = useSidebar();
  if (!isMobile) return null;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/75 px-2.5 backdrop-blur-xl backdrop-saturate-150">
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="Abrir menu"
        className="grid size-10 shrink-0 place-items-center rounded-xl text-foreground/80 transition-colors hover:bg-foreground/[0.06]"
      >
        <Menu className="size-5" />
      </button>
      <span className="min-w-0 flex-1 truncate">
        <HubLogo className="[&_.hub-wordmark]:text-[1.0625rem]" />
      </span>
      <button
        type="button"
        onClick={abrirBusca}
        aria-label="Buscar"
        className="grid size-10 shrink-0 place-items-center rounded-xl text-foreground/80 transition-colors hover:bg-foreground/[0.06]"
      >
        <Search className="size-[1.1875rem]" />
      </button>
      <span className="pr-1">
        <AccountMenu usuario={usuario} compact side="bottom" />
      </span>
    </header>
  );
}
