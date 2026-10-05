"use client";

import { usePathname } from "next/navigation";

import { agents } from "@/lib/data";

const PAGES: Record<string, string> = {
  "/": "Pipeline",
  "/chat": "Chat principal",
  "/editor": "Editor",
  "/biblioteca": "Biblioteca",
  "/integracoes": "Integrações",
  "/estudios/geracao": "Estúdio · Geração",
  "/estudios/voz": "Estúdio · Voz",
  "/estudios/avatar": "Estúdio · Avatar",
  "/estudios/edicao": "Estúdio · Edição",
  "/estudios/montagem": "Estúdio · Montagem",
};

// Caminho do topo: a página em que você está (antes era um projeto de exemplo fixo).
export function Breadcrumb() {
  const pathname = usePathname();
  const agentId = pathname.startsWith("/agentes/") ? pathname.split("/")[2] : null;
  const page = agentId ? `Agente · ${agents.find((a) => a.id === agentId)?.name ?? agentId}` : PAGES[pathname];

  return (
    <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 truncate text-sm whitespace-nowrap text-muted-foreground">
      <span>Hub de Criativos</span>
      {page && (
        <>
          <span aria-hidden>/</span>
          <span className="font-medium text-foreground" aria-current="page">
            {page}
          </span>
        </>
      )}
    </nav>
  );
}
