"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, Languages, LayoutGrid, Library, MessageSquare, Mic, Palette, Plug, Scissors, Sparkles, UserRound } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { agents } from "@/lib/data";

const production = [
  { href: "/chat", label: "Chat principal", icon: MessageSquare },
  { href: "/", label: "Fluxo", icon: LayoutGrid },
  { href: "/editor", label: "Editor", icon: Film },
  { href: "/biblioteca", label: "Biblioteca", icon: Library },
  { href: "/integracoes", label: "Integrações", icon: Plug },
  { href: "/design", label: "Aparência", icon: Palette },
];

const studios = [
  { href: "/estudios/geracao", label: "Geração", tool: "FLORA", icon: Sparkles },
  { href: "/estudios/voz", label: "Voz", tool: "ElevenLabs", icon: Mic },
  { href: "/estudios/avatar", label: "Avatar", tool: "HeyGen", icon: UserRound },
  { href: "/estudios/traducao", label: "Tradução", tool: "HeyGen", icon: Languages },
  { href: "/estudios/edicao", label: "Edição", tool: "Higgsfield", icon: Scissors },
  { href: "/estudios/montagem", label: "Montagem", tool: "Local", icon: Clapperboard },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex size-8 items-center justify-center rounded-md bg-rec text-white">
                  <Clapperboard className="size-4" />
                </div>
                <div className="grid leading-tight">
                  <span className="font-heading text-base font-bold">Hub de Criativos</span>
                  <span className="text-xs text-muted-foreground">Produção de anúncios</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Produção</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {production.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Estúdios</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {studios.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={`${item.label} · ${item.tool}`}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="font-mono text-[10px] text-muted-foreground">{item.tool}</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Agentes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {agents.map((agent) => {
                const href = `/agentes/${agent.id}`;
                return (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton asChild isActive={pathname === href} tooltip={agent.name}>
                      <Link href={href}>
                        <span className="flex size-4 items-center justify-center font-mono text-[10px] font-semibold">
                          {agent.short}
                        </span>
                        <span>{agent.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
