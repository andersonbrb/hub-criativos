import type { Metadata } from "next";

import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { pedidoParaTela } from "@/features/conector/servicos/pedidos";
import { ConectarClaude } from "@/features/conector/tela/conectar-claude";

// Consentimento do login do Claude: o /oauth2/authorize manda a pessoa para cá com ?pedido=<id>. Sem login, vai para
// /entrar e volta para cá com o mesmo pedido.
export const metadata: Metadata = { title: "Conectar o Claude · Hub de Criativos" };

export default async function ConectarClaudePage({ searchParams }: PageProps<"/conectar-claude">) {
  const usuario = await exigirPagina("conector_claude");
  const { pedido } = await searchParams;
  const id = typeof pedido === "string" ? pedido : "";
  const dados = await pedidoParaTela(id, usuario);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <ConectarClaude pedido={dados} voltarPara={`/conectar-claude?pedido=${encodeURIComponent(id)}`} />
    </main>
  );
}
