import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PipelineView } from "@/components/pipeline/pipeline-view";
import { getBoard } from "@/lib/server/board";
import { listGenerations } from "@/lib/server/store";
import { podeUsar, telaInicial } from "@/features/acesso/contrato";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export default async function PipelinePage() {
  // "/" é para onde o login manda por padrão: quem não tem o Fluxo vai para a primeira tela que pode abrir.
  const usuario = await exigirPagina();
  if (!podeUsar(usuario, "fluxo")) redirect(telaInicial(usuario) ?? "/sem-acesso?chave=fluxo");
  await connection(); // quadro lido do disco a cada acesso, não no build
  const [board, generations] = await Promise.all([getBoard(), listGenerations()]);
  return (
    <main className="h-workspace">
      <PipelineView initialBoard={board} initialGenerations={generations} />
    </main>
  );
}
