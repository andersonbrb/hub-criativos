import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { TelaDaPlataforma } from "@/features/acesso/tela/plataforma";

export const metadata: Metadata = { title: "Plataforma · Hub de Criativos" };

// Todas as organizações do hub. Só quem opera a plataforma (DONOS_DA_PLATAFORMA); as rotas conferem de novo.
export default async function PlataformaPage() {
  const eu = await exigirPagina();
  if (!eu.operaPlataforma) redirect("/sem-acesso");
  return <TelaDaPlataforma />;
}
