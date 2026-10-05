import { connection } from "next/server";

import { ChatView } from "@/components/chat/chat-view";
import { getBoard } from "@/lib/server/board";
import { brainReady } from "@/lib/server/chat/claude-code";

// /chat?c=<conversa> abre uma conversa; /chat?card=<id> começa uma conversa nova já apontando para um card do quadro.
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  await connection(); // lê a chave a cada acesso, não no build
  const { c, card } = await searchParams;
  let initialDraft = "";
  if (typeof card === "string") {
    const found = (await getBoard()).cards[card];
    if (found) initialDraft = `Sobre o card “${found.title}” do Fluxo (card_id ${found.id}): `;
  }
  return (
    <main className="h-workspace">
      <ChatView initialId={typeof c === "string" ? c : null} initialDraft={initialDraft} configured={brainReady()} />
    </main>
  );
}
