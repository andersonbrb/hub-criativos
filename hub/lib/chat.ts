// Tipos do chat principal compartilhados entre servidor e cliente.

import type { Generation } from "@/lib/generations";

// costUsd: estimativa do gasto com o Claude nesta conversa (as ferramentas cobram à parte).
// agentId: conversa com um agente específico (lib/agent-profiles.ts); ausente = chat principal.
export type ChatSummary = { id: string; title: string; createdAt: string; updatedAt: string; costUsd: number; agentId?: string };

// O que a interface desenha. Montado a partir das mensagens salvas (GET) ou dos eventos ao vivo (POST).
export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "text" | "file";
export type Attachment = { name: string; url: string; kind: AttachmentKind; generationId?: string };

export type ChatItem =
  | { kind: "user"; text: string; attachments: Attachment[] }
  | { kind: "assistant"; text: string }
  | { kind: "status"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      detail: string;
      done: boolean;
      error: boolean;
      summary: string;
      generations: Generation[];
    };

// Eventos do stream NDJSON de POST /api/chat, uma linha JSON por evento.
// "text" e "status" chegam em pedaços: o cliente junta no último item do mesmo tipo.
export type ChatEvent =
  | { type: "chat"; chat: ChatSummary }
  | { type: "user"; item: Extract<ChatItem, { kind: "user" }> }
  | { type: "text"; delta: string }
  | { type: "status"; delta: string }
  | { type: "tool"; item: Extract<ChatItem, { kind: "tool" }> }
  | { type: "tool_done"; id: string; error: boolean; summary: string; generations: Generation[] }
  | { type: "error"; message: string }
  | { type: "done" };

export const TOOL_LABELS: Record<string, string> = {
  hub_list_generations: "Consultando o histórico do hub",
  hub_check_generations: "Verificando gerações",
  hub_view_image: "Olhando a imagem",
  elevenlabs_list_voices: "Listando vozes do ElevenLabs",
  elevenlabs_tts: "Gerando narração no ElevenLabs",
  heygen_list_avatars: "Listando avatares do HeyGen",
  heygen_list_voices: "Listando vozes do HeyGen",
  heygen_create_video: "Criando vídeo de avatar no HeyGen",
  flora_list_models: "Listando modelos do FLORA",
  flora_quote: "Orçando no FLORA",
  flora_generate: "Gerando no FLORA",
  higgsfield_list_edits: "Listando edições do Higgsfield",
  higgsfield_edit: "Editando vídeo no Higgsfield",
  hub_montage: "Edição final",
  hub_beat_edit: "Edição na batida",
  hub_transcribe: "Transcrevendo e identificando o idioma",
  hub_view_video: "Assistindo ao vídeo",
  hub_save_analysis: "Salvando a decupagem",
  hub_contact_sheet: "Montando folha de contato",
  flora_projects: "Projeto do FLORA",
  flora_project_media: "Buscando mídia no projeto do FLORA",
  hub_list_chats: "Consultando conversas dos agentes",
  hub_read_chat: "Lendo outra conversa",
  editor_open: "Abrindo no editor",
  editor_render: "Exportando vídeo do editor",
  pipeline_get: "Lendo o quadro do Fluxo",
  pipeline_save_card: "Atualizando o quadro",
  web_search: "Pesquisando na web",
  web_fetch: "Lendo página",
};

export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;
