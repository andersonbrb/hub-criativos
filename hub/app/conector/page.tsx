import type { Metadata } from "next";
import { headers } from "next/headers";

import { PageHeader } from "@/components/page-header";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { basePublicaDeCabecalhos, enderecoMcp } from "@/features/conector/servicos/config";
import { conexoesDaPessoa } from "@/features/conector/servicos/conexoes";
import { PainelDoConector } from "@/features/conector/tela/painel-do-conector";

export const metadata: Metadata = { title: "Conector do Claude Code · Hub de Criativos" };

export default async function ConectorPage() {
  const usuario = await exigirPagina("conector_claude");
  const endereco = enderecoMcp(basePublicaDeCabecalhos(await headers()));
  const conexoes = await conexoesDaPessoa(usuario.id, usuario.organizacao!.id);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        title="Conector do Claude Code"
        description="Ligue o seu Claude Code ao Hub: ele passa a usar a memória, a Biblioteca e o Fluxo com a sua conta, gastando a sua assinatura do Claude."
      />
      <PainelDoConector endereco={endereco} conexoesIniciais={conexoes} />
    </main>
  );
}
