import {
  BookOpen,
  Bot,
  Building2,
  Cable,
  Camera,
  Code,
  FileCode,
  Film,
  KeyRound,
  Languages,
  LayoutGrid,
  Library,
  MessageSquare,
  Mic,
  Palette,
  Plug,
  Scissors,
  Sparkles,
  UserRound,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { ehAdmin, podeUsar, type Chave, type Usuario } from "@/features/acesso/contrato";
import { agents } from "@/lib/data";

// Telas do hub. Uma lista só para o menu lateral, as páginas que agrupam telas (Agentes, Estúdios), a busca rápida
// (Ctrl K) e o nome da página na barra do topo.

// soOperador: a tela não depende de chave da organização, só de operar a plataforma (tela Plataforma).
// soAdmin: só o dono ou um admin da organização abre (Chaves de API), como no Skala.
// descricao: uma linha no cartão da página que agrupa a tela.
export type ItemDoMenu = {
  href: string;
  label: string;
  icon: LucideIcon;
  chave: Chave;
  tool?: string;
  soOperador?: boolean;
  soAdmin?: boolean;
  descricao?: string;
};

// Estúdios: um item só no menu, que abre /estudios com os cinco.
export const ESTUDIOS: ItemDoMenu[] = [
  { href: "/estudios/geracao", label: "Geração", tool: "FLORA", icon: Sparkles, chave: "estudios", descricao: "Imagem e vídeo com IA, a partir de um texto ou de uma foto." },
  { href: "/estudios/voz", label: "Voz", tool: "ElevenLabs", icon: Mic, chave: "estudios", descricao: "Narração do roteiro com as vozes da sua conta." },
  { href: "/estudios/avatar", label: "Avatar", tool: "HeyGen", icon: UserRound, chave: "estudios", descricao: "Uma pessoa falando o roteiro, com a boca sincronizada." },
  { href: "/estudios/traducao", label: "Tradução", tool: "HeyGen", icon: Languages, chave: "estudios", descricao: "O mesmo vídeo em outro idioma, com a voz da pessoa." },
  { href: "/estudios/edicao", label: "Edição", tool: "No hub", icon: Scissors, chave: "estudios", descricao: "Edição final: cortes, cenas extras e legenda, sem gastar créditos." },
];

// API do hub (como a seção API do Skala): um item só no menu, que abre /api-do-hub com as duas telas. A documentação
// é para quem liga contas (Integrações); as chaves, só para dono e admin.
export const API: ItemDoMenu[] = [
  { href: "/documentacao-da-api", label: "Documentação da API", icon: FileCode, chave: "integracoes", descricao: "O que outro sistema faz pela API do hub, como mandar a chave e um exemplo de cada chamada." },
  { href: "/chaves-de-api", label: "Chaves de API", icon: KeyRound, chave: "integracoes", soAdmin: true, descricao: "Crie a chave que outro sistema (o Skala) usa para falar com o hub, veja o último uso e revogue." },
];

// Itens do menu lateral, na ordem. `telas`: o item abre uma página que agrupa estas telas (e fica marcado nelas).
export type ItemDaBarra = ItemDoMenu & { telas?: ItemDoMenu[] };

export const BARRA: ItemDaBarra[] = [
  { href: "/chat", label: "Chat", icon: MessageSquare, chave: "chat" },
  { href: "/agentes", label: "Agentes", icon: Bot, chave: "chat" },
  { href: "/criativo-automatico", label: "Criativo automático", icon: WandSparkles, chave: "criativo-automatico" },
  { href: "/", label: "Fluxo", icon: LayoutGrid, chave: "fluxo" },
  { href: "/biblioteca", label: "Biblioteca", icon: Library, chave: "biblioteca" },
  { href: "/estudios", label: "Estúdios", icon: Palette, chave: "estudios", telas: ESTUDIOS },
  { href: "/editor", label: "Editor", icon: Film, chave: "editor" },
  // Pedido do dono (29/10/2026): o projeto do Instagram veio inteiro para o hub, com item próprio no menu.
  { href: "/instagram", label: "Instagram", icon: Camera, chave: "instagram" },
  { href: "/memoria", label: "Memória", icon: BookOpen, chave: "memoria" },
];

// Ficam no pé do menu, separados das telas do dia a dia. Cada um abre a própria tela (não há mais página de
// Configurações: /configuracoes só redireciona).
export const RODAPE: ItemDaBarra[] = [
  { href: "/integracoes", label: "Integrações", icon: Plug, chave: "integracoes" },
  { href: "/conector", label: "Conector do Claude", icon: Cable, chave: "conector_claude" },
  { href: "/api-do-hub", label: "API", icon: Code, chave: "integracoes", telas: API },
];

// Equipe e Plataforma não entram no menu lateral: abrem pelo menu da organização, no pé dele
// (features/acesso/tela/seletor-de-organizacao.tsx). Ficam aqui para a busca rápida e o nome da página no topo.
const DA_ORGANIZACAO: ItemDaBarra[] = [
  { href: "/membros", label: "Equipe", icon: Users, chave: "membros" },
  { href: "/plataforma", label: "Plataforma", icon: Building2, chave: "membros", soOperador: true },
];

// Telas que só existem com o banco (no PC sem banco ficam fora do menu).
const SO_COM_BANCO = new Set<string>(["/memoria", "/conector", "/membros", "/plataforma", "/api-do-hub", "/documentacao-da-api", "/chaves-de-api", "/instagram"]);

const podeAbrir = (usuario: Usuario, semBanco: boolean) => (i: ItemDoMenu) =>
  (i.soOperador ? usuario.operaPlataforma : podeUsar(usuario, i.chave) && (!i.soAdmin || ehAdmin(usuario))) && !(semBanco && SO_COM_BANCO.has(i.href));

// Telas de um grupo que a pessoa pode abrir (a página também confere no servidor).
export const telasDaPessoa = (telas: ItemDoMenu[], usuario: Usuario, semBanco: boolean) => telas.filter(podeAbrir(usuario, semBanco));

// Menu lateral da pessoa. Item que agrupa telas aparece se ela abre pelo menos uma delas.
export function menuDaPessoa(usuario: Usuario, semBanco: boolean): { itens: ItemDaBarra[]; rodape: ItemDaBarra[] } {
  const pode = podeAbrir(usuario, semBanco);
  const visivel = (i: ItemDaBarra) => (i.telas ? i.telas.some(pode) : pode(i));
  return { itens: BARRA.filter(visivel), rodape: RODAPE.filter(visivel) };
}

export const agentesDaPessoa = (usuario: Usuario) => (podeUsar(usuario, "chat") ? agents : []);

// Todas as telas que a pessoa abre, com o grupo de cada uma (busca rápida).
export function todasAsTelas(usuario: Usuario, semBanco: boolean): (ItemDoMenu & { grupo?: string })[] {
  const { itens, rodape } = menuDaPessoa(usuario, semBanco);
  return [
    ...[...itens, ...rodape].flatMap((i) => [
      i,
      ...(i.telas ? telasDaPessoa(i.telas, usuario, semBanco).map((t) => ({ ...t, grupo: i.label })) : []),
    ]),
    ...telasDaPessoa(DA_ORGANIZACAO, usuario, semBanco).map((t) => ({ ...t, grupo: "Organização" })),
  ];
}

const dentro = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

// O item do menu fica marcado na própria página e nas telas que ele agrupa (/agentes/copy marca "Agentes").
export const itemAtivo = (item: ItemDaBarra, pathname: string) => dentro(pathname, item.href) || Boolean(item.telas?.some((t) => dentro(pathname, t.href)));

// Página aberta, para a barra do topo: o nome e, nas telas de um grupo, o grupo (link de volta para a página dele).
export function caminhoDaPagina(pathname: string): { nome: string; grupo?: { href: string; label: string } } | null {
  if (pathname.startsWith("/agentes/")) {
    const id = pathname.split("/")[2];
    return { nome: agents.find((a) => a.id === id)?.name ?? "Agente", grupo: { href: "/agentes", label: "Agentes" } };
  }
  // Documento da Memória: no celular a barra do topo é o único lugar que diz em que tela a pessoa está.
  if (pathname.startsWith("/memoria/")) return { nome: "Documento", grupo: { href: "/memoria", label: "Memória" } };
  // As abas da seção Instagram (o item do menu marca todas elas).
  if (pathname.startsWith("/instagram/")) {
    const abas: Record<string, string> = { producao: "Produção", conteudos: "Revisão", calendario: "Calendário", referencias: "Referências", mercados: "Mercados", configuracoes: "Configurações" };
    return { nome: abas[pathname.split("/")[2]] ?? "Instagram", grupo: { href: "/instagram", label: "Instagram" } };
  }
  for (const item of [...BARRA, ...RODAPE, ...DA_ORGANIZACAO]) {
    if (item.href === pathname) return { nome: item.label };
    const tela = item.telas?.find((t) => dentro(pathname, t.href));
    if (tela) return { nome: tela.label, grupo: { href: item.href, label: item.label } };
  }
  const extras: Record<string, string> = {
    "/sem-acesso": "Sem acesso",
    "/conectar-claude": "Conectar o Claude",
    "/privacidade": "Política de Privacidade",
  };
  return extras[pathname] ? { nome: extras[pathname] } : null;
}
