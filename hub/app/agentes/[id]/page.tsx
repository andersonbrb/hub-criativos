import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ChatView } from "@/components/chat/chat-view";
import { getAgentProfile } from "@/lib/agent-profiles";
import { brainReady } from "@/lib/server/chat/claude-code";

// Conversa real com um agente (lib/agent-profiles.ts): mesmas ferramentas do chat principal,
// no Claude ou, com o Modo Black, na Venice. /agentes/<id>?c=<conversa> abre uma conversa.
export default async function AgentPage({ params, searchParams }: PageProps<"/agentes/[id]">) {
  await connection();
  const { id } = await params;
  const { c } = await searchParams;
  const agent = getAgentProfile(id);
  if (!agent) notFound();

  return (
    <main className="h-workspace">
      <ChatView key={agent.id} agentId={agent.id} initialId={typeof c === "string" ? c : null} initialDraft="" configured={brainReady()} />
    </main>
  );
}
