"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { HubLogo, HubMark } from "@/components/hub-logo";
import { itemAtivo, menuDaPessoa, type ItemDaBarra } from "@/components/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { telaInicial, type Usuario } from "@/features/acesso/contrato";
import { SeletorDeOrganizacao } from "@/features/acesso/tela/seletor-de-organizacao";
import { cn } from "@/lib/utils";

// Menu lateral no estilo do ElevenLabs: marca, as telas que a conta pode abrir (o servidor também confere) e a
// organização no rodapé. A busca e a conta ficam na barra do topo. Agentes e Estúdios são um item só cada, que abre a
// página com todas as telas do grupo (components/nav.ts). Equipe e Plataforma abrem pelo menu da organização.
export function AppSidebar({ usuario, semBanco = false }: { usuario: Usuario; semBanco?: boolean }) {
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const recolhido = state === "collapsed" && !isMobile;
  const { itens, rodape } = menuDaPessoa(usuario, semBanco);

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
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {itens.map((item) => (
                <ItemDaBarraLateral key={item.href} item={item} ativo={itemAtivo(item, pathname)} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Integrações e Conector do Claude: no pé do menu, longe das telas do dia a dia. */}
        {rodape.length > 0 && (
          <SidebarGroup className="mt-auto py-1">
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {rodape.map((item) => (
                  <ItemDaBarraLateral key={item.href} item={item} ativo={itemAtivo(item, pathname)} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Organização aberta e troca (sem banco não há organizações: só a do PC). */}
      {!semBanco && (
        <SidebarFooter className="gap-2 px-3 pt-2 pb-3">
          <SeletorDeOrganizacao usuario={usuario} recolhido={recolhido} lado={isMobile ? "bottom" : "right"} />
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

function ItemDaBarraLateral({ item, ativo }: { item: ItemDaBarra; ativo: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={ativo} tooltip={item.label}>
        <Link href={item.href}>
          <item.icon strokeWidth={1.6} />
          <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
