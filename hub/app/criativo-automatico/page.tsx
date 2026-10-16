import { connection } from "next/server";

import { AutoCreative } from "@/components/auto-creative";
import { brainReady } from "@/lib/server/chat/claude-code";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

// Criativo automático: formulário simples para leigos + conversa com o agente "auto" (lib/agent-profiles.ts),
// que produz o criativo inteiro até o vídeo final. /criativo-automatico?c=<conversa> reabre uma produção.
export default async function AutoCreativePage({ searchParams }: PageProps<"/criativo-automatico">) {
  await exigirPagina("criativo-automatico");
  await connection();
  const { c } = await searchParams;
  return (
    <main className="h-workspace">
      <AutoCreative initialId={typeof c === "string" ? c : null} configured={await brainReady()} />
    </main>
  );
}
