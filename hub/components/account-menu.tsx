"use client";

import { useRef } from "react";
import { ChevronsUpDown, LogOut, Monitor, Moon, Search, Smartphone, Sun } from "lucide-react";

import { setTheme, useTheme } from "@/components/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROTULO_DO_PAPEL, type Usuario } from "@/features/acesso/contrato";
import { useLayoutMode } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const iniciais = (nome: string) =>
  nome
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

export function Avatar({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--brand-500),var(--cyan-500))] text-[0.6875rem] font-semibold text-white shadow-[0_0_0_2px_rgb(255_255_255/0.08),0_6px_16px_-6px_var(--glow)]",
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}

// Abre a busca rápida (Ctrl K), que mora no layout.
export const abrirBusca = () => window.dispatchEvent(new Event("hub:busca"));

// Sai da conta pelo mesmo formulário de sempre (funciona sem depender de resposta em JSON).
export function useSair() {
  const ref = useRef<HTMLFormElement>(null);
  const form = <form ref={ref} method="post" action="/api/acesso/sair" className="hidden" />;
  return { form, sair: () => ref.current?.submit() };
}

// Conta da pessoa: nome, papel e o menu com tema, versão celular/computador e sair.
// compact: só o avatar (barra do celular e menu recolhido).
export function AccountMenu({ usuario, compact = false, side = "top" }: { usuario: Usuario; compact?: boolean; side?: "top" | "bottom" | "right" }) {
  const theme = useTheme();
  const { isMobile, toggle } = useLayoutMode();
  const { form, sair } = useSair();

  return (
    <>
      {form}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <button type="button" aria-label="Sua conta" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Avatar nome={usuario.nome} />
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-2.5 rounded-[10px] p-2 text-left text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1"
            >
              <Avatar nome={usuario.nome} />
              <span className="grid min-w-0 flex-1 gap-0.5 group-data-[collapsible=icon]:hidden">
                <strong className="truncate text-[0.8125rem] font-medium text-white">{usuario.nome}</strong>
                <small className="truncate text-[0.6875rem] text-sidebar-foreground/70">
                  {ROTULO_DO_PAPEL[usuario.papel]}
                </small>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={compact ? "end" : "start"} sideOffset={8} className="w-64">
          <DropdownMenuLabel className="grid gap-0.5 px-2.5 py-2 font-sans tracking-normal normal-case">
            <span className="truncate text-sm font-semibold text-foreground">{usuario.nome}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{usuario.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={abrirBusca}>
            <Search />
            Buscar
            <DropdownMenuShortcut>Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle}>
            {isMobile ? <Monitor /> : <Smartphone />}
            {isMobile ? "Versão computador" : "Versão celular"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={sair}>
            <LogOut />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
