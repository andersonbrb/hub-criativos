import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ChatView } from "@/components/chat/chat-view";
import { getBoard } from "@/lib/server/board";
import { brainReady } from "@/lib/server/chat/claude-code";
import { podeUsar } from "@/features/acesso/contrato";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { exigirPagina, tokenDaSessao } from "@/features/acesso/servicos/sessao";
import { trocarOrganizacaoDaSessao } from "@/features/acesso/servicos/sessoes";
import { situacaoDaEntrega } from "@/features/skala/servicos/entregas";

// /chat?c=<conversa> abre uma conversa; /chat?card=<id> começa uma conversa nova já apontando para um card do quadro.
// /chat?skala=<token>: o link do botão "Gerar ganchos" do Skala (features/skala). A tela manda sozinha a primeira
// mensagem, com o criativo; reabrir o link leva à conversa que nasceu dele.
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { c, card, skala } = await searchParams;
  if (typeof skala === "string") {
    const aberto = await abrirEntregaDoSkala(skala);
    if (aberto.aviso) {
      await exigirPagina("chat");
      await connection();
      return (
        <main className="h-workspace">
          <ChatView initialId={null} initialDraft="" configured={await brainReady()} aviso={aberto.aviso} />
        </main>
      );
    }
    return (
      <main className="h-workspace">
        <ChatView initialId={null} initialDraft="" configured={await brainReady()} skala={aberto.skala} />
      </main>
    );
  }
  await exigirPagina("chat");
  await connection(); // lê a chave a cada acesso, não no build
  let initialDraft = "";
  if (typeof card === "string") {
    const found = (await getBoard()).cards[card];
    if (found) initialDraft = `Sobre o card “${found.title}” do Fluxo (card_id ${found.id}): `;
  }
  return (
    <main className="h-workspace">
      <ChatView initialId={typeof c === "string" ? c : null} initialDraft={initialDraft} configured={await brainReady()} />
    </main>
  );
}

const AVISO_VENCIDO = "Este link do Skala venceu ou não vale mais. Volte ao Skala e clique de novo em Gerar ganchos.";

// Decide o que o link do Skala faz para quem abriu: sem login, o exigirPagina leva ao /entrar e volta para cá.
async function abrirEntregaDoSkala(token: string): Promise<{ aviso: string; skala?: never } | { aviso?: never; skala: { token: string; titulo: string } }> {
  const usuario = await exigirPagina();
  await connection();
  if (modoLocalSemBanco()) return { aviso: "A conexão com o Skala só funciona no hub da nuvem, com login." };
  const situacao = await situacaoDaEntrega(token);
  if (situacao.estado === "invalida") return { aviso: AVISO_VENCIDO };
  const { entrega } = situacao;
  // O criativo é de uma organização (a do Skala). Com outra aberta, a sessão troca, se a pessoa participa dela, e a
  // página abre de novo já nela. As outras abas recarregam sozinhas na próxima ação (409).
  if (usuario.organizacao?.id !== entrega.organizacaoId) {
    const trocou = await trocarOrganizacaoDaSessao(await tokenDaSessao(), usuario.id, entrega.organizacaoId);
    if (!trocou) return { aviso: "Este criativo do Skala é de uma organização da qual sua conta não participa no hub. Peça um convite a quem cuida da equipe." };
    redirect(`/chat?skala=${encodeURIComponent(token)}`);
  }
  if (!podeUsar(usuario, "chat")) redirect("/sem-acesso?chave=chat");
  if (situacao.estado === "usada") {
    // Quem abriu antes volta para a conversa; outra pessoa vê o aviso (o link é de uso único).
    if (entrega.usadoPor === usuario.id && entrega.chatId) redirect(`/chat?c=${encodeURIComponent(entrega.chatId)}`);
    if (entrega.usadoPor === usuario.id) redirect("/chat");
    return { aviso: "Este link do Skala já foi aberto por outra pessoa. Clique de novo em Gerar ganchos no Skala para começar uma conversa sua." };
  }
  const nomes = entrega.criativos.map((cr) => cr.nome).join(", ");
  return { skala: { token, titulo: nomes } };
}
