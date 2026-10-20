import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PipelineView } from "@/components/pipeline/pipeline-view";
import { getBoard } from "@/lib/server/board";
import { listGenerations } from "@/lib/server/store";
import { podeUsar, telaInicial } from "@/features/acesso/contrato";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { Apresentacao } from "@/features/publico/tela/apresentacao";

export default async function PipelinePage() {
  // "/" abre sem login (proxy.ts): quem não entrou vê a apresentação do hub, porque o Google recusa uma página
  // inicial que seja só a tela de login.
  const usuario = await usuarioDaSessao();
  if (!usuario) return <Apresentacao />;
  // "/" é para onde o login manda por padrão: quem não tem o Fluxo vai para a primeira tela que pode abrir.
  if (!podeUsar(usuario, "fluxo")) redirect(telaInicial(usuario) ?? "/sem-acesso?chave=fluxo");
  await connection(); // quadro lido do disco a cada acesso, não no build
  const [board, generations] = await Promise.all([getBoard(), listGenerations()]);
  return (
    <main className="h-workspace">
      <PipelineView initialBoard={board} initialGenerations={generations} />
    </main>
  );
}
