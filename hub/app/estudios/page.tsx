import type { Metadata } from "next";

import { PaginaDeGrupo } from "@/components/grade-de-telas";
import { ESTUDIOS } from "@/components/nav";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export const metadata: Metadata = { title: "Estúdios · Hub de Criativos" };

// Os estúdios juntos (o menu tem um item só, "Estúdios"). Cada cartão abre o estúdio.
export default async function EstudiosPage() {
  await exigirPagina("estudios");
  return (
    <PaginaDeGrupo
      titulo="Estúdios"
      descricao="Gere cada peça do criativo à mão, sem passar pelo chat. O que sai daqui fica salvo no hub e pode ir para a Biblioteca."
      cartoes={ESTUDIOS.map((e) => ({ href: e.href, nome: e.label, descricao: e.descricao, marca: e.tool, icone: <e.icon className="size-5" strokeWidth={1.6} /> }))}
    />
  );
}
