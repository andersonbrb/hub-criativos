"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Cable,
  Film,
  Languages,
  LayoutGrid,
  Library,
  MessageSquare,
  Mic,
  Plug,
  Scissors,
  Sparkles,
  UserRound,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { podeUsar, telaInicial, type Chave, type Usuario } from "@/features/acesso/contrato";
import { LogoHub } from "@/components/logo-hub";
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

type Item = { href: string; label: string; icon: LucideIcon; chave: Chave; tool?: string };

const production: Item[] = [
  { href: "/chat", label: "Chat principal (Produção)", icon: MessageSquare, chave: "chat" },
  { href: "/criativo-automatico", label: "Criativo automático", icon: WandSparkles, chave: "criativo-automatico" },
  { href: "/", label: "Fluxo", icon: LayoutGrid, chave: "fluxo" },
  { href: "/editor", label: "Editor", icon: Film, chave: "editor" },
  { href: "/biblioteca", label: "Biblioteca", icon: Library, chave: "biblioteca" },
];

const studios: Item[] = [
  { href: "/estudios/geracao", label: "Geração", tool: "FLORA", icon: Sparkles, chave: "estudios" },
  { href: "/estudios/voz", label: "Voz", tool: "ElevenLabs", icon: Mic, chave: "estudios" },
  { href: "/estudios/avatar", label: "Avatar", tool: "HeyGen", icon: UserRound, chave: "estudios" },
  { href: "/estudios/traducao", label: "Tradução", tool: "HeyGen", icon: Languages, chave: "estudios" },
  { href: "/estudios/edicao", label: "Edição", tool: "Local", icon: Scissors, chave: "estudios" },
];

const memory: Item[] = [
  { href: "/memoria", label: "Memória", icon: BookOpen, chave: "memoria" },
  { href: "/conector", label: "Conector do Claude", icon: Cable, chave: "conector_claude" },
];

const admin: Item[] = [
  { href: "/integracoes", label: "Integrações", icon: Plug, chave: "integracoes" },
  { href: "/membros", label: "Membros", icon: Users, chave: "membros" },
];

// Telas que só existem com o banco (no PC sem banco ficam fora do menu).
const SO_COM_BANCO = new Set<string>(["/memoria", "/conector", "/membros"]);

// Menu lateral: cada pessoa só vê as telas que a conta dela pode abrir (a página também confere no servidor).
export function AppSidebar({ usuario, semBanco = false }: { usuario: Usuario; semBanco?: boolean }) {
  const pathname = usePathname();
  const liberados = (itens: Item[]) => itens.filter((i) => podeUsar(usuario, i.chave) && !(semBanco && SO_COM_BANCO.has(i.href)));

  const grupo = (titulo: string, itens: Item[]) => {
    const visiveis = liberados(itens);
    if (!visiveis.length) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{titulo}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {visiveis.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.tool ? `${item.label} · ${item.tool}` : item.label}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.tool && <SidebarMenuBadge className="font-mono text-[0.625rem] text-muted-foreground">{item.tool}</SidebarMenuBadge>}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={telaInicial(usuario) ?? "/"}>
                {/* size-8! vence o tamanho que o menu força nos ícones; a cor fixa não muda ao passar o mouse. */}
                <LogoHub className="size-8! text-sidebar-foreground" />
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
        {grupo("Produção", production)}
        {grupo("Estúdios", studios)}
        {grupo("Memória", memory)}
        {grupo("Administração", admin)}

        {podeUsar(usuario, "chat") && (
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
                          <span className="flex size-4 items-center justify-center font-mono text-[0.625rem] font-semibold">{agent.short}</span>
                          <span>{agent.name}</span>
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
    </Sidebar>
  );
}
