"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FolderOpen, PanelLeft, Search, Send } from "lucide-react";

import { AccountMenu, abrirBusca } from "@/components/account-menu";
import { caminhoDaPagina } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { podeUsar, type Usuario } from "@/features/acesso/contrato";

// Barra do topo, como a do ElevenLabs: abrir/recolher o menu e o nome da página à esquerda, a busca no meio e, à
// direita, o atalho para o chat ("Perguntar"), a Biblioteca e a conta.
export function Topbar({ usuario }: { usuario: Usuario }) {
  const { isMobile, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const pagina = caminhoDaPagina(pathname);
  const chat = podeUsar(usuario, "chat");
  const biblioteca = podeUsar(usuario, "biblioteca");

  return (
    <header className="sticky top-0 z-20 grid h-13 shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-b bg-background/95 px-3 backdrop-blur md:grid-cols-[1fr_minmax(0,24rem)_1fr] md:px-4">
      {/* Fio de luz azul sob a barra (toque futurista discreto). */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-[linear-gradient(90deg,transparent,var(--brand-500)_35%,var(--cyan-400)_55%,transparent_85%)] opacity-50" />
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={isMobile ? "Abrir menu" : "Abrir ou recolher o menu"} className="shrink-0 text-muted-foreground">
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Menu <span className="opacity-60">Ctrl B</span>
          </TooltipContent>
        </Tooltip>
        {/* Numa tela de grupo (um agente, um estúdio, Integrações...), o grupo vem antes e leva de volta à página dele. */}
        <span className="flex min-w-0 items-center gap-1.5 text-[0.875rem] font-medium">
          {pagina?.grupo && (
            <>
              <Link href={pagina.grupo.href} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
                {pagina.grupo.label}
              </Link>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            </>
          )}
          <span className="truncate">{pagina?.nome ?? "Hub de Criativos"}</span>
        </span>
      </div>

      <button
        type="button"
        onClick={abrirBusca}
        className="hidden h-8 w-full items-center gap-2 rounded-lg border bg-background px-2.5 text-[0.8125rem] text-muted-foreground transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-muted hover:shadow-[0_0_16px_-6px_var(--brand-500)] md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Pesquise tudo…</span>
        <kbd className="hub-kbd">Ctrl</kbd>
        <kbd className="hub-kbd">K</kbd>
      </button>

      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="icon-sm" onClick={abrirBusca} aria-label="Pesquisar" className="text-muted-foreground md:hidden">
          <Search />
        </Button>
        {chat && (
          <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/chat">
              <Send className="text-primary" />
              Perguntar
            </Link>
          </Button>
        )}
        {biblioteca && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" asChild className="hidden sm:inline-flex">
                <Link href="/biblioteca" aria-label="Biblioteca">
                  <FolderOpen />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Biblioteca</TooltipContent>
          </Tooltip>
        )}
        <AccountMenu usuario={usuario} />
      </div>
    </header>
  );
}
