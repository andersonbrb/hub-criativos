"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Send } from "lucide-react";

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
import { podeUsar, telaInicial, type Usuario } from "@/features/acesso/contrato";
import { cn } from "@/lib/utils";

// Menu lateral no estilo do ElevenLabs: marca, as telas que a conta pode abrir (o servidor também confere), o convite
// da equipe no rodapé. A busca e a conta ficam na barra do topo.
export function AppSidebar({ usuario, semBanco = false }: { usuario: Usuario; semBanco?: boolean }) {
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const recolhido = state === "collapsed" && !isMobile;
  const grupos = menuDaPessoa(usuario, semBanco);
  const agentes = agentesDaPessoa(usuario);
  const convidar = !semBanco && podeUsar(usuario, "membros");

  // No celular o menu é uma gaveta: fecha ao trocar de tela.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("h-13 justify-center px-3 py-0", recolhido && "items-center px-0")}>
        <Link href={telaInicial(usuario) ?? "/"} className="hub-brand flex w-fit items-center rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          {recolhido ? <HubMark claro className="size-7" /> : <HubLogo className="[&_.hub-mark]:size-7 [&_.hub-wordmark]:text-[1.0625rem]" />}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-1 pt-1 pb-3">
        {grupos.map((g, i) => (
          <SidebarGroup key={g.titulo} className="py-1">
            {i > 0 && <SidebarGroupLabel>{g.titulo}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {g.itens.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.tool ? `${item.label} · ${item.tool}` : item.label}>
                      <Link href={item.href}>
                        <item.icon strokeWidth={1.6} />
                        <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.tool && (
                      <SidebarMenuBadge className="top-1/2! right-2 -translate-y-1/2 px-0 text-[0.6875rem] font-normal text-muted-foreground">{item.tool}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {agentes.length > 0 && (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel>Agentes</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {agentes.map((agent) => {
                  const href = `/agentes/${agent.id}`;
                  return (
                    <SidebarMenuItem key={agent.id}>
                      <SidebarMenuButton asChild isActive={pathname === href} tooltip={agent.name} className="group/agente">
                        <Link href={href}>
                          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-sidebar-border text-[0.5625rem] font-semibold tracking-tight text-sidebar-foreground/80 group-data-[active=true]/agente:border-primary/40 group-data-[active=true]/agente:text-primary">
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

      {convidar && (
        <SidebarFooter className="gap-2 px-3 pt-2 pb-3">
          {!recolhido && (
            <Link href="/membros" className="group/convite grid gap-1 rounded-xl border border-sidebar-border bg-background p-3 transition-colors hover:bg-sidebar-accent">
              <span className="mb-1 grid size-8 place-items-center rounded-full bg-sidebar-accent text-sidebar-foreground transition-colors group-hover/convite:bg-background">
                <Send className="size-4" />
              </span>
              <strong className="text-[0.8125rem] font-medium text-foreground">Convidar membros da equipe</strong>
              <span className="text-xs leading-snug text-muted-foreground">Traga sua equipe para produzir junto no hub.</span>
            </Link>
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
