import type { Metadata } from "next";

import { PaginaDeGrupo } from "@/components/grade-de-telas";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { getAgentProfile } from "@/lib/agent-profiles";
import { agents } from "@/lib/data";

export const metadata: Metadata = { title: "Agentes · Hub de Criativos" };

// Todos os agentes juntos (o menu tem um item só, "Agentes"). Cada cartão abre a conversa do agente em /agentes/<id>.
export default async function AgentesPage() {
  await exigirPagina("chat");
  const cartoes = agents.map((a) => {
    const perfil = getAgentProfile(a.id);
    return {
      href: `/agentes/${a.id}`,
      nome: perfil?.name ?? a.name,
      descricao: perfil?.role ?? a.role,
      icone: <span className="text-[0.75rem] font-semibold tracking-tight">{a.short}</span>,
    };
  });
  return (
    <PaginaDeGrupo
      titulo="Agentes"
      descricao="Cada agente cuida de uma etapa do criativo. Abra um para conversar: as conversas de cada agente ficam na tela dele."
      cartoes={cartoes}
    />
  );
}
