import type Anthropic from "@anthropic-ai/sdk";

import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { exigirDriveParaVideo } from "@/features/drive/servicos/videos";
import { concluirEntrega, devolverEntrega, reservarEntrega, type Entrega } from "@/features/skala/servicos/entregas";
import { montarPrimeiraMensagem, type PrimeiraMensagem } from "@/features/skala/servicos/primeira-mensagem";
import type { ChatEvent } from "@/lib/chat";
import { ehVideo, MAX_FILE_BYTES, prepararAnexo } from "@/lib/server/chat/anexos";
import { ATTACHMENTS_NOTE } from "@/lib/server/chat/display";
import { runClaudeCodeTurn, usesApiBrain } from "@/lib/server/chat/claude-code";
import { runChatTurn } from "@/lib/server/chat/run";
import { runVeniceTurn } from "@/lib/server/chat/venice";
import { endTurn, startTurn } from "@/lib/server/chat/running";
import { getChat, listChats, newChat, saveChat, summary } from "@/lib/server/chat/store";
import { ATUALIZACAO_DAS_CONVERSAS, buildSystemPrompt, MARCA_ATUALIZACAO, PEDIDO_DO_USUARIO } from "@/lib/server/chat/system";
import { ferramentasDaPessoa } from "@/lib/server/chat/tools";
import { hasKey } from "@/lib/server/env";
import { getAgentProfile } from "@/lib/agent-profiles";
import { languageNote } from "@/lib/languages";
import { agentReferenceBlocks } from "@/lib/server/agent-settings";
import { InputError, route } from "@/lib/server/http";

// ?agent=<id>: só as conversas desse agente; sem ele: só as do chat principal.
export const GET = route(async (request: Request) => {
  const agent = new URL(request.url).searchParams.get("agent");
  return Response.json({ chats: await listChats(getAgentProfile(agent)?.id ?? null) });
}, { chave: ["chat", "criativo-automatico"] });

// FormData: text, chatId? (sem ele cria uma conversa nova), agentId? (conversa nova com um agente), files (0 ou mais arquivos de qualquer tipo).
// skala=<token>: a primeira mensagem da conversa que nasce do botão "Gerar ganchos" do Skala (features/skala). O texto e
// os anexos vêm da entrega, não do formulário.
// Responde em NDJSON: uma linha por ChatEvent, até "done".
// mode=black: o mesmo agente, com as mesmas ferramentas, rodando no modelo sem censura da Venice (lib/server/chat/venice.ts).
// Modo normal: Claude Code local com a assinatura (lib/server/chat/claude-code.ts), sem custo por token.
// Sem Claude Code na máquina (o hub da nuvem), a API da Anthropic com a chave de Integrações (lib/server/chat/run.ts).
export const POST = route(async (request: Request) => {
  // HUB_CHAT=off: chat e agentes desligados (ex.: no Railway, onde não há Claude Code logado).
  if (process.env.HUB_CHAT?.trim() === "off") {
    return Response.json({ error: "O chat está desligado neste servidor. Use o chat no hub do seu computador." }, { status: 403 });
  }
  // Quem manda a mensagem: as ferramentas conferem a chave dela a cada chamada (lib/server/chat/tools.ts) e a
  // conversa nova só leva as ferramentas e a Memória que ela pode usar.
  const usuario = await exigirUsuario();
  const form = await request.formData();
  const black = form.get("mode") === "black";
  const useApi = usesApiBrain();
  if (black && !(await hasKey("venice"))) {
    return Response.json({ error: "Falta a chave da Venice para o Modo Black. Um admin cola em Integrações → Venice." }, { status: 400 });
  }
  if (!black && useApi && !(await hasKey("anthropic"))) {
    return Response.json({ error: "Falta a chave da API do Claude. Um admin cola em Integrações → Claude." }, { status: 400 });
  }
  // Entrega do Skala: reservada aqui (uso único), na organização aberta (a tela já abriu na da entrega). A mídia é baixada
  // do CDN antes de a conversa nascer; se algo falhar até a conversa ser gravada, o link volta a valer. O prompt da
  // conversa nova sai antes da reserva: depois dela, só a gravação da conversa ainda pode falhar.
  const tokenDoSkala = form.get("skala");
  let entrega: Entrega | null = null;
  let doSkala: PrimeiraMensagem | null = null;
  let sistemaDoSkala: string | null = null;
  if (typeof tokenDoSkala === "string" && tokenDoSkala) {
    sistemaDoSkala = await buildSystemPrompt(undefined, usuario);
    entrega = await reservarEntrega(tokenDoSkala, usuario.id, await organizacaoAtual());
    if (!entrega) throw new InputError("Este link do Skala já foi usado ou venceu. Volte ao Skala e clique de novo em Gerar ganchos.");
    try {
      doSkala = await montarPrimeiraMensagem(entrega);
    } catch (err) {
      await devolverEntrega(entrega.id);
      throw err;
    }
  }
  const text = doSkala?.texto ?? String(form.get("text") ?? "").trim();
  const files = [...form.getAll("files"), ...form.getAll("images")].filter((f): f is File => f instanceof File && f.size > 0);
  if (!text && !files.length) return Response.json({ error: "Escreva uma mensagem." }, { status: 400 });
  if (files.some((f) => f.size > MAX_FILE_BYTES)) return Response.json({ error: "Cada arquivo pode ter até 500 MB." }, { status: 400 });

  // A entrega do Skala sempre começa uma conversa nova no chat principal.
  const chatId = doSkala ? "" : String(form.get("chatId") ?? "");
  let chat = chatId ? await getChat(chatId) : null;
  if (chatId && !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  const shown = text || (files.length === 1 ? `(arquivo anexado: ${files[0].name})` : `(${files.length} arquivos anexados)`);
  // Criativo automático: o título vem do "O que anunciar" do formulário, não do cabeçalho do bloco.
  const titleFrom = entrega
    ? `Ganchos: ${entrega.criativos.map((c) => c.nome).join(", ")}`
    : /O que anunciar: (.+)/.exec(text.startsWith("[CRIATIVO AUTOMÁTICO]") ? text : "")?.[1].trim() || shown;
  if (!chat) {
    // agentId (só na criação): conversa com um agente; o prompt dele fica congelado na conversa.
    const agentId = doSkala ? undefined : getAgentProfile(String(form.get("agentId") ?? ""))?.id;
    chat = newChat(titleFrom.replace(/\s+/g, " ").slice(0, 60), sistemaDoSkala ?? (await buildSystemPrompt(agentId, usuario)), ferramentasDaPessoa(usuario), agentId);
  } else {
    if (chat.messages.length === 0 && !chat.titleRenamedAt) {
      // Conversa criada pelo botão "Nova conversa": ganha o título da primeira mensagem.
      chat.title = titleFrom.replace(/\s+/g, " ").slice(0, 60);
    }
    // Conversa de antes de 27/10/2026: recebe as regras e as ferramentas novas (pedido do dono). Só acrescenta, no fim.
    if (!chat.system.includes(MARCA_ATUALIZACAO) && !chat.system.includes(PEDIDO_DO_USUARIO)) chat.system += ATUALIZACAO_DAS_CONVERSAS;
    if (chat.toolNames) {
      const novas = ferramentasDaPessoa(usuario, ["heygen_create_avatar", "memoria_salvar", "servico_ferramentas", "servico_chamar", "servico_importar_arquivo"]).filter((n) => !chat!.toolNames!.includes(n));
      if (novas.length) chat.toolNames = [...chat.toolNames, ...novas];
    }
  }

  // Regra do dono: vídeo só com o Google Drive conectado (ele vai para lá logo depois). Confere antes de gravar qualquer anexo.
  if (files.some(ehVideo)) await exigirDriveParaVideo();
  const prepared = [...(doSkala?.anexos ?? []), ...(await Promise.all(files.map(prepararAnexo)))];
  const notes = prepared.map((p) => p.note).filter(Boolean);
  // 1ª mensagem de uma conversa de agente: imagens/PDFs de referência configurados em "Editar agente"
  // (só referências "@file:", hidratadas no envio; não entram em chat.attachments, então não viram chips do usuário).
  const references = chat.agentId && chat.messages.length === 0 ? await agentReferenceBlocks(chat.agentId) : [];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...references,
    ...prepared.flatMap((p) => p.blocks),
    // Idioma do criativo escolhido no chat (lib/languages.ts): nota escondida da bolha, lida pelo agente.
    { type: "text", text: `${shown}${notes.length ? `${ATTACHMENTS_NOTE}${notes.join("; ")}]` : ""}${languageNote(form.get("lang"))}` },
  ];
  const attachments = prepared.map((p) => p.attachment);
  if (attachments.length) chat.attachments = { ...chat.attachments, [chat.messages.length]: attachments };
  chat.messages.push({ role: "user", content });
  try {
    await saveChat(chat);
  } catch (err) {
    if (entrega) await devolverEntrega(entrega.id);
    throw err;
  }
  // Reabrir o link do Skala leva a esta conversa.
  if (entrega) await concluirEntrega(entrega.id, chat.id);

  const current = chat;
  // Só o botão Parar (/api/chat/stop) encerra o turno. Trocar de conversa ou recarregar a página
  // não interrompe: o agente termina e a resposta fica salva na conversa.
  const turn = startTurn(current.id);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {} // o navegador já fechou a conexão
      };
      try {
        emit({ type: "chat", chat: summary(current) });
        emit({ type: "user", item: { kind: "user", text: shown, attachments } });
        if (black) await runVeniceTurn(current, emit, turn.signal, usuario);
        else if (useApi) await runChatTurn(current, emit, turn.signal, usuario);
        else await runClaudeCodeTurn(current, emit, turn.signal, new URL(request.url).origin, usuario);
        emit({ type: "chat", chat: summary(current) });
        emit({ type: "done" });
      } finally {
        endTurn(current.id, turn);
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}, { chave: ["chat", "criativo-automatico"] });
