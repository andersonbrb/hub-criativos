"use client";

import { useRef } from "react";
import { LogOut, Moon, Search, Sun } from "lucide-react";

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
    <span aria-hidden className={cn("inline-grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[0.6875rem] font-semibold text-white", className)}>
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

// Conta da pessoa, no canto da barra do topo (como no ElevenLabs): nome, e-mail e o menu com busca, tema e sair.
// A versão celular ou computador não é escolha: segue a largura da tela (hooks/use-mobile.ts).
export function AccountMenu({ usuario, side = "bottom" }: { usuario: Usuario; side?: "top" | "bottom" | "right" }) {
  const theme = useTheme();
  const { form, sair } = useSair();

  return (
    <>
      {form}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Sua conta"
            className="rounded-full bg-[linear-gradient(135deg,var(--brand-500),var(--cyan-400))] p-[1.5px] transition-shadow outline-none hover:shadow-[0_0_14px_-3px_var(--brand-500)] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:shadow-[0_0_14px_-3px_var(--brand-500)]"
          >
            <Avatar nome={usuario.nome} className="size-7 ring-2 ring-background" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="end" sideOffset={8} className="w-64">
          <DropdownMenuLabel className="grid gap-0.5 px-2.5 py-2">
            <span className="truncate text-sm font-semibold text-foreground">{usuario.nome}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{usuario.email}</span>
            <span className="text-xs font-normal text-muted-foreground">{ROTULO_DO_PAPEL[usuario.papel]}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={abrirBusca}>
            <Search />
            Pesquisar
            <DropdownMenuShortcut>Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={sair}>
            <LogOut />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
