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

import { podeUsar, type Chave, type Usuario } from "@/features/acesso/contrato";
import { agents } from "@/lib/data";

// Telas do hub, na ordem do menu. Uma lista só para o menu lateral e a busca rápida (Ctrl K).

export type ItemDoMenu = { href: string; label: string; icon: LucideIcon; chave: Chave; tool?: string };
export type GrupoDoMenu = { titulo: string; itens: ItemDoMenu[] };

export const MENU: GrupoDoMenu[] = [
  {
    titulo: "Produção",
    itens: [
      { href: "/chat", label: "Chat principal (Produção)", icon: MessageSquare, chave: "chat" },
      { href: "/criativo-automatico", label: "Criativo automático", icon: WandSparkles, chave: "criativo-automatico" },
      { href: "/", label: "Fluxo", icon: LayoutGrid, chave: "fluxo" },
      { href: "/editor", label: "Editor", icon: Film, chave: "editor" },
      { href: "/biblioteca", label: "Biblioteca", icon: Library, chave: "biblioteca" },
    ],
  },
  {
    titulo: "Estúdios",
    itens: [
      { href: "/estudios/geracao", label: "Geração", tool: "FLORA", icon: Sparkles, chave: "estudios" },
      { href: "/estudios/voz", label: "Voz", tool: "ElevenLabs", icon: Mic, chave: "estudios" },
      { href: "/estudios/avatar", label: "Avatar", tool: "HeyGen", icon: UserRound, chave: "estudios" },
      { href: "/estudios/traducao", label: "Tradução", tool: "HeyGen", icon: Languages, chave: "estudios" },
      { href: "/estudios/edicao", label: "Edição", tool: "Local", icon: Scissors, chave: "estudios" },
    ],
  },
  {
    titulo: "Memória",
    itens: [
      { href: "/memoria", label: "Memória", icon: BookOpen, chave: "memoria" },
      { href: "/conector", label: "Conector do Claude", icon: Cable, chave: "conector_claude" },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { href: "/integracoes", label: "Integrações", icon: Plug, chave: "integracoes" },
      { href: "/membros", label: "Membros", icon: Users, chave: "membros" },
    ],
  },
];

// Telas que só existem com o banco (no PC sem banco ficam fora do menu).
const SO_COM_BANCO = new Set<string>(["/memoria", "/conector", "/membros"]);

// Cada pessoa só vê as telas que a conta dela pode abrir (a página também confere no servidor).
export function menuDaPessoa(usuario: Usuario, semBanco: boolean): GrupoDoMenu[] {
  return MENU.map((g) => ({
    titulo: g.titulo,
    itens: g.itens.filter((i) => podeUsar(usuario, i.chave) && !(semBanco && SO_COM_BANCO.has(i.href))),
  })).filter((g) => g.itens.length > 0);
}

export const agentesDaPessoa = (usuario: Usuario) => (podeUsar(usuario, "chat") ? agents : []);

