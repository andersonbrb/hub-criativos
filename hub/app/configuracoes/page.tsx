import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PaginaDeGrupo } from "@/components/grade-de-telas";
import { CONFIGURACOES, telasDaPessoa } from "@/components/nav";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export const metadata: Metadata = { title: "Configurações · Hub de Criativos" };

// Integrações, Conector do Claude, Equipe e Plataforma juntos (o menu tem um item só, "Configurações").
// Cada pessoa vê só as que pode abrir; cada tela confere de novo no servidor.
export default async function ConfiguracoesPage() {
  const usuario = await exigirPagina();
  const telas = telasDaPessoa(CONFIGURACOES, usuario, modoLocalSemBanco());
  if (telas.length === 0) redirect("/sem-acesso");
  return (
    <PaginaDeGrupo
      titulo="Configurações"
      descricao="Contas conectadas, a equipe e o resto do que se ajusta uma vez e depois quase não se mexe."
      cartoes={telas.map((t) => ({ href: t.href, nome: t.label, descricao: t.descricao, icone: <t.icon className="size-5" strokeWidth={1.6} /> }))}
    />
  );
}
