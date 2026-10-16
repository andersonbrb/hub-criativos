"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";

import { AccountMenu, abrirBusca } from "@/components/account-menu";
import { HubLogo, HubMark } from "@/components/hub-logo";
import { agentesDaPessoa, menuDaPessoa } from "@/components/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { telaInicial, type Usuario } from "@/features/acesso/contrato";
import { cn } from "@/lib/utils";

// Destaque do item ativo: mede o botão ativo dentro da lista e desliza até ele (com mola), como no Ownly e na Cifra.
// Escreve direto no elemento do destaque (sem estado), e marca a lista com data-destaque enquanto ele está visível.
function useDestaque(chave: string) {
  const lista = useRef<HTMLDivElement>(null);
  const destaque = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = lista.current;
    const ind = destaque.current;
    if (!el || !ind) return;
    const medir = () => {
      const ativo = el.querySelector<HTMLElement>('[data-sidebar="menu-button"][data-active="true"]');
      if (!ativo) {
        ind.style.opacity = "0";
        delete el.dataset.destaque;
        return;
      }
      const caixa = el.getBoundingClientRect();
      const r = ativo.getBoundingClientRect();
      const lateral = el.closest('[data-slot="sidebar-inner"], [data-mobile="true"]')?.getBoundingClientRect().left ?? caixa.left;
      // Na primeira vez aparece já no lugar, sem deslizar a partir do topo.
      const primeira = !el.dataset.destaque;
      if (primeira) ind.style.transition = "none";
      ind.style.transform = `translate(${r.left - caixa.left}px, ${r.top - caixa.top + el.scrollTop}px)`;
      ind.style.width = `${r.width}px`;
      ind.style.height = `${r.height}px`;
      ind.style.setProperty("--tick-left", `${lateral - r.left}px`);
      ind.style.opacity = "1";
      el.dataset.destaque = "on";
      if (primeira) {
        void ind.offsetWidth;
        ind.style.transition = "";
      }
    };
    medir();
    // A largura muda ao recolher/abrir o menu: mede de novo enquanto anima.
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    el.querySelectorAll('[data-sidebar="menu-button"]').forEach((b) => obs.observe(b));
    return () => obs.disconnect();
  }, [chave]);
  return { lista, destaque };
}

// Menu lateral: marca, busca rápida, as telas que a conta pode abrir (o servidor também confere) e a conta.
export function AppSidebar({ usuario, semBanco = false }: { usuario: Usuario; semBanco?: boolean }) {
  const pathname = usePathname();
  const { state, isMobile, toggleSidebar, setOpenMobile } = useSidebar();
  const recolhido = state === "collapsed" && !isMobile;
  const { lista, destaque } = useDestaque(`${pathname}|${state}|${isMobile}`);
  const grupos = menuDaPessoa(usuario, semBanco);
  const agentes = agentesDaPessoa(usuario);

  // No celular o menu é uma gaveta: fecha ao trocar de tela.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  // Com o destaque deslizante na tela, o item ativo não pinta o próprio fundo.
  const botaoDoMenu = "data-[active=true]:text-white in-data-[destaque=on]:data-[active=true]:bg-transparent";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4 pb-1">
        <div className={cn("flex items-center justify-between gap-1", recolhido && "flex-col justify-center gap-2")}>
          <Link href={telaInicial(usuario) ?? "/"} className={cn("hub-brand flex min-w-0 items-center rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", recolhido ? "px-0" : "px-1.5")}>
            {recolhido ? <HubMark /> : <HubLogo inverse />}
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={isMobile ? () => setOpenMobile(false) : toggleSidebar}
                aria-label={isMobile ? "Fechar menu" : recolhido ? "Abrir menu" : "Recolher menu"}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-white"
              >
                {isMobile ? <X className="size-[18px]" /> : recolhido ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" hidden={isMobile}>
              {recolhido ? "Abrir menu" : "Recolher menu"} <span className="font-mono opacity-60">Ctrl B</span>
            </TooltipContent>
          </Tooltip>
        </div>

        <button
          type="button"
          onClick={abrirBusca}
          aria-label="Buscar telas e ações (Ctrl K)"
          className={cn(
            "flex h-9 w-full items-center gap-2.5 rounded-[10px] border border-sidebar-border bg-white/[0.03] pr-1.5 pl-3 text-[0.8125rem] text-sidebar-foreground transition-[border-color,background-color,color,box-shadow] duration-200 hover:border-[rgb(164_151_255/0.5)] hover:bg-white/[0.05] hover:text-white hover:shadow-[0_0_0_3px_rgb(124_107_255/0.14)]",
            recolhido && "justify-center px-0",
          )}
        >
          <Search className="size-[15px] shrink-0" />
          {!recolhido && (
            <>
              <span className="flex-1 text-left">Buscar</span>
              <kbd className="hub-kbd border-sidebar-border bg-white/[0.05] text-sidebar-foreground">Ctrl K</kbd>
            </>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent ref={lista} className="relative px-1 pb-4 [mask-image:linear-gradient(to_bottom,#000_calc(100%-32px),transparent)]">
        <span ref={destaque} aria-hidden className="hub-nav-indicator top-0 left-0" style={{ opacity: 0 }} />

        {grupos.map((g) => (
          <SidebarGroup key={g.titulo} className="py-1.5">
            <SidebarGroupLabel>{g.titulo}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.itens.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.tool ? `${item.label} · ${item.tool}` : item.label} className={botaoDoMenu}>
                      <Link href={item.href}>
                        <item.icon strokeWidth={1.75} />
                        <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.tool && (
                      <SidebarMenuBadge className="top-1/2! right-2 z-[2] h-[1.125rem] -translate-y-1/2 rounded-full border border-sidebar-border px-1.5 font-mono text-[0.625rem] font-normal text-sidebar-foreground/60">
                        {item.tool}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {agentes.length > 0 && (
          <SidebarGroup className="py-1.5">
            <SidebarGroupLabel>Agentes</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {agentes.map((agent) => {
                  const href = `/agentes/${agent.id}`;
                  return (
                    <SidebarMenuItem key={agent.id}>
                      <SidebarMenuButton asChild isActive={pathname === href} tooltip={agent.name} className={cn(botaoDoMenu, "group/agente")}>
                        <Link href={href}>
                          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-sidebar-border bg-white/[0.04] font-mono text-[0.5625rem] font-semibold tracking-tight text-sidebar-foreground transition-colors group-data-[active=true]/agente:border-[rgb(164_151_255/0.45)] group-data-[active=true]/agente:text-[var(--brand-300)]">
                            {agent.short}
                          </span>
                          <span className="group-data-[collapsible=icon]:hidden">{agent.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-1.5 px-3 pt-0 pb-3">
        <div className="mx-1 mb-1 h-px bg-sidebar-border" />
        {!recolhido && <span className="px-2.5 font-mono text-[0.65625rem] tracking-[0.14em] text-sidebar-foreground/50 uppercase">Conta</span>}
        <AccountMenu usuario={usuario} side={isMobile ? "top" : "right"} />
      </SidebarFooter>
    </Sidebar>
  );
}
