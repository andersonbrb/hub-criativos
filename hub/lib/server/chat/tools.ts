import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getAgentProfile } from "@/lib/agent-profiles";
import { FLORA_FAMILIES, MARKETS } from "@/lib/flora-models";
import type { Generation } from "@/lib/generations";
import { OPERATIONS, type Operation } from "@/lib/board";
import { DEFAULT_STYLE, placeCaptions, placeClips, type CaptionStyle } from "@/lib/editor";
import { EDIT_TOOLS } from "@/lib/higgsfield-edits";
import { quoteFlora, refreshGeneration, runAvatar, runEdit, runFlora, runTts } from "@/lib/server/actions";
import { imageRef } from "@/lib/server/chat/images";
import { listFullChats, type Chat } from "@/lib/server/chat/store";
import { createCard, getBoard, moveCard, updateCard } from "@/lib/server/board";
import { autoCaptions, joinProject, openProject, renderProject, saveProject } from "@/lib/server/editor";
import { InputError } from "@/lib/server/http";
import { runMontage } from "@/lib/server/montage";
import { timeline, type Engine } from "@/lib/server/transcription";
import { runTranslation } from "@/lib/server/video-translation";
import { addReferences, drawReferences, kbFiles, kbRead, kbSearch, listNiches, readNiche, saveNiche } from "@/lib/server/ad-writer";
import {
  contactSheet,
  FRAME_SIZES,
  frameAt,
  getAnalysis,
  importFloraMedia,
  patchAnalysis,
  pickTimes,
  readyMedia,
  thumbOf,
  transcriptOf,
  videoInfo,
} from "@/lib/server/video";
import { listVoices as listElevenVoices } from "@/lib/server/providers/elevenlabs";
import { createProject, listProjects } from "@/lib/server/providers/flora";
import { listLooks, listVoices as listHeyVoices } from "@/lib/server/providers/heygen";
import { getGeneration, listGenerations } from "@/lib/server/store";

// Ferramentas do chat principal: as mesmas ações dos estúdios, mais leitura do histórico do hub.
// A ordem e o texto das definições precisam ser estáveis (fazem parte do prefixo cacheado).

type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>[number];

export type ToolOutcome = {
  content: string | ToolResultContent[];
  summary: string;
  generations?: Generation[];
};

type Input = Record<string, unknown>;
// chat: a conversa que chamou a ferramenta (projeto do FLORA dela, leitura das outras conversas).
type Ctx = { signal: AbortSignal; chat?: Chat };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const json = (v: unknown) => JSON.stringify(v, null, 1);
const strParams = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Input).map(([k, x]) => [k, str(x)]));

// Visão compacta de uma geração para o modelo (prompts longos cortados).
function brief(g: Generation) {
  const params = Object.fromEntries(
    Object.entries(g.params).map(([k, v]) => [k, typeof v === "string" ? cut(v, 200) : v]),
  );
  return {
    id: g.id,
    tool: g.tool,
    kind: g.kind,
    status: g.status,
    prompt: cut(g.prompt, 400),
    ...(g.error ? { error: g.error } : {}),
    params,
    created_at: g.createdAt,
  };
}

// 00:02.5 (minutos:segundos com décimo), para quadros e cortes.
const ts = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
};

// Texto de uma conversa para outro agente ler: pedidos e respostas, sem imagens nem raciocínio.
function chatText(chat: Chat): string {
  const parts: string[] = [];
  for (const m of chat.messages) {
    const who = m.role === "user" ? "USUÁRIO" : "AGENTE";
    if (typeof m.content === "string") {
      parts.push(`${who}: ${m.content}`);
      continue;
    }
    const texts = m.content.flatMap((b) => (b.type === "text" ? [b.text] : b.type === "tool_use" ? [`[usou ${b.name}]`] : []));
    if (texts.length) parts.push(`${who}: ${texts.join("\n")}`);
  }
  return parts.join("\n\n");
}

const agentName = (c: Chat) => (c.agentId ? (getAgentProfile(c.agentId)?.name ?? c.agentId) : "Chat principal");

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

// Enum de hub_list_generations. Mudar a lista invalida o cache só no modo HUB_BRAIN=api (Claude Code e Venice relistam a cada turno).
const GEN_TOOLS = ["elevenlabs", "heygen", "heygen-traducao", "flora", "higgsfield", "upload", "editor", "montagem"];

const definitions: Anthropic.Beta.BetaTool[] = [
  {
    name: "hub_list_generations",
    description:
      "Lista o que já foi produzido no hub (narrações, avatares, frames, vídeos, edições, b-rolls importados do FLORA e arquivos anexados pelo usuário), do mais recente ao mais antigo, com a decupagem salva de cada um (quando houver). Use para saber o contexto do trabalho, achar o id de uma geração e procurar b-roll que já existe (search) antes de gerar outro.",
    input_schema: objectSchema({
      search: { type: "string", description: "Palavras para procurar no prompt, nos parâmetros e na decupagem salva (ex.: cozinha, mãos, produto na mesa)." },
      tool: { type: "string", enum: GEN_TOOLS, description: "Filtrar por ferramenta. upload = arquivos anexados no chat. heygen-traducao = vídeos traduzidos." },
      kind: { type: "string", enum: ["audio", "video", "image"] },
      status: { type: "string", enum: ["pending", "running", "done", "failed"] },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Padrão 20." },
    }),
  },
  {
    name: "hub_check_generations",
    description:
      "Atualiza o status de gerações assíncronas (FLORA, HeyGen, Higgsfield) e baixa o resultado quando ficam prontas. Com wait_seconds, espera até todas terminarem ou o tempo acabar; use quando o próximo passo depende do resultado (ex.: frame aprovado antes do vídeo).",
    input_schema: objectSchema(
      {
        ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        wait_seconds: { type: "integer", minimum: 0, maximum: 240, description: "Padrão 0 (só consulta)." },
      },
      ["ids"],
    ),
  },
  {
    name: "hub_view_image",
    description:
      "Mostra para você uma imagem do hub (frame gerado ou imagem anexada) para avaliar qualidade, fidelidade ao produto ou escrever o prompt do próximo passo.",
    input_schema: objectSchema({ generation_id: { type: "string" } }, ["generation_id"]),
  },
  {
    name: "elevenlabs_list_voices",
    description: "Lista as vozes da conta ElevenLabs (id, nome, categoria, descrição).",
    input_schema: objectSchema({ search: { type: "string", description: "Filtro opcional por nome ou descrição." } }),
  },
  {
    name: "elevenlabs_tts",
    description:
      "Gera uma narração (texto para fala) no ElevenLabs. Síncrono: devolve a geração pronta, que pode ir para o lipsync do HeyGen. Até 5.000 caracteres. Cobra créditos do ElevenLabs por caractere.",
    input_schema: objectSchema(
      {
        text: { type: "string" },
        voice_id: { type: "string", description: "Id vindo de elevenlabs_list_voices." },
        voice_name: { type: "string" },
        model_id: {
          type: "string",
          enum: ["eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"],
          description:
            "eleven_v4: melhor qualidade. eleven_v4_turbo: quase igual e mais rápido. eleven_v3: expressivo, aceita tags como [risos]. eleven_multilingual_v2 (padrão): mais estável em textos longos. eleven_flash_v2_5: mais barato.",
        },
        stability: { type: "number", minimum: 0, maximum: 1, description: "Padrão 0.5." },
        similarity: { type: "number", minimum: 0, maximum: 1, description: "Padrão 0.75." },
        style: { type: "number", minimum: 0, maximum: 1, description: "Padrão 0." },
        speed: { type: "number", minimum: 0.7, maximum: 1.2, description: "Padrão 1." },
      },
      ["text", "voice_id"],
    ),
  },
  {
    name: "heygen_list_avatars",
    description: "Lista avatares (looks) do HeyGen. private = avatares da conta do usuário; public = biblioteca do HeyGen.",
    input_schema: objectSchema({
      ownership: { type: "string", enum: ["private", "public"], description: "Padrão private." },
      search: { type: "string" },
    }),
  },
  {
    name: "heygen_list_voices",
    description: "Lista vozes do HeyGen (as da conta primeiro). Filtre pelo idioma em inglês, ex.: Spanish, Portuguese, Romanian.",
    input_schema: objectSchema({ language: { type: "string" } }),
  },
  {
    name: "heygen_create_video",
    description:
      "Cria um vídeo de avatar falando no HeyGen. Dois modos: lipsync com uma narração do hub (audio_generation_id) ou roteiro com voz do HeyGen (script + voice_id). Assíncrono: devolve a geração 'running'; acompanhe com hub_check_generations. Cobra créditos do HeyGen.",
    input_schema: objectSchema(
      {
        look_id: { type: "string", description: "Id vindo de heygen_list_avatars." },
        look_name: { type: "string" },
        audio_generation_id: { type: "string", description: "Narração do ElevenLabs gerada no hub." },
        script: { type: "string" },
        voice_id: { type: "string", description: "Id vindo de heygen_list_voices (só no modo roteiro)." },
        voice_name: { type: "string" },
        aspect_ratio: { type: "string", enum: ["9:16", "1:1", "16:9", "4:5"], description: "Padrão 9:16." },
        resolution: { type: "string", enum: ["720p", "1080p"], description: "Padrão 1080p." },
      },
      ["look_id"],
    ),
  },
  {
    name: "flora_list_models",
    description:
      "Lista os modelos do FLORA configurados no hub (imagem e vídeo), com parâmetros aceitos, custo base e mercados das regras COD.",
    input_schema: objectSchema({}),
  },
  {
    name: "flora_quote",
    description: "Estima o custo em dólar de uma geração no FLORA sem cobrar.",
    input_schema: objectSchema(
      {
        family: { type: "string", description: "Id da família vindo de flora_list_models." },
        params: { type: "object", additionalProperties: { type: "string" } },
        count: { type: "integer", minimum: 1, maximum: 4 },
        reference_generation_id: { type: "string" },
      },
      ["family"],
    ),
  },
  {
    name: "flora_generate",
    description:
      "Gera imagem (frame) ou vídeo no FLORA. Com reference_generation_id (imagem do hub, ex.: foto do produto anexada ou frame aprovado) usa o modelo a partir de imagem. operation=cod aplica as regras do playbook de dropshipping COD (idioma do mercado travado, sem crianças, sem texto na tela). Assíncrono: devolve gerações 'running'; acompanhe com hub_check_generations. Cobra em dólar no FLORA.",
    input_schema: objectSchema(
      {
        family: { type: "string", description: "Id da família vindo de flora_list_models." },
        prompt: { type: "string" },
        params: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Parâmetros da família, ex.: {\"aspect_ratio\": \"9:16\", \"duration\": \"5\"}. Ausentes usam o padrão.",
        },
        count: { type: "integer", minimum: 1, maximum: 4, description: "Variações (padrão 1)." },
        reference_generation_id: { type: "string" },
        operation: { type: "string", enum: ["none", "cod"], description: "Padrão none." },
        market: {
          type: "string",
          enum: MARKETS.map((m) => m.id),
          description: "Mercado e idioma da fala (vídeo). Com operation=cod aplica as regras do COD; sem COD só fixa o idioma da fala. br=português BR, pt=Portugal, es=espanhol neutro, fr=francês, us=inglês EUA.",
        },
        label: {
          type: "string",
          description: "Nome curto do que está sendo gerado, para o canvas do FLORA ficar organizado (ex.: \"B-roll 03 · xícara às 16h\", \"Frame produto · cozinha\"). O hub acrescenta o tipo e o número da variação.",
        },
      },
      ["family", "prompt"],
    ),
  },
  {
    name: "higgsfield_list_edits",
    description: "Lista as ferramentas de edição de vídeo do Higgsfield disponíveis no hub e seus parâmetros.",
    input_schema: objectSchema({}),
  },
  {
    name: "higgsfield_edit",
    description:
      "Edita um vídeo do hub no Higgsfield (editar com prompt, reenquadrar, upscale, remover fundo, deflicker, FPS, dublagem). Assíncrono: acompanhe com hub_check_generations. Cobra créditos do Higgsfield.",
    input_schema: objectSchema(
      {
        tool: { type: "string", enum: EDIT_TOOLS.map((t) => t.id) },
        source_generation_id: { type: "string", description: "Vídeo pronto do hub." },
        prompt: { type: "string", description: "Obrigatório na ferramenta prompt-edit." },
        params: { type: "object", additionalProperties: { type: "string" } },
      },
      ["tool", "source_generation_id"],
    ),
  },
  {
    name: "hub_montage",
    description:
      "Montagem automática do infoproduto (playbook infoproduto-edicao-video): corta os silêncios do vídeo do avatar, transcreve com Whisper, queima legenda Montserrat MAIÚSCULA e coloca os b-rolls (1º aos 6s, a cada 7s, 2,8s com dissolve). Roda local, sem custo. Assíncrono (1 a 3 min): acompanhe com hub_check_generations.",
    input_schema: objectSchema(
      {
        avatar_generation_id: { type: "string", description: "Vídeo pronto do avatar falando (HeyGen)." },
        broll_generation_ids: { type: "array", items: { type: "string" }, maxItems: 12, description: "Vídeos prontos de b-roll, na ordem em que entram." },
        lang: { type: "string", enum: ["es", "pt", "fr", "en"], description: "Idioma da fala. Padrão es." },
        name: { type: "string", description: "Nome do projeto, ex.: AD01." },
      },
      ["avatar_generation_id"],
    ),
  },
  {
    name: "editor_open",
    description:
      "Abre um vídeo do hub no editor de vídeo (ou retoma o projeto que já existe para ele) e, se pedido, gera as legendas automaticamente (transcrição ElevenLabs) e aplica um estilo. Use quando o usuário quiser legendar, cortar ou ajustar um vídeo; depois ele pode corrigir tudo à mão no editor. Devolve o projeto com as legendas no tempo da timeline.",
    input_schema: objectSchema(
      {
        generation_id: { type: "string", description: "Vídeo pronto do hub." },
        auto_captions: { type: "boolean", description: "Gerar legendas pela fala. Padrão false." },
        words_per_caption: { type: "integer", minimum: 1, maximum: 6, description: "Padrão 3." },
        style: {
          type: "object",
          additionalProperties: false,
          properties: {
            font: { type: "string", enum: ["Arial Black", "Impact", "Segoe UI Black", "Verdana"] },
            size: { type: "number", minimum: 40, maximum: 180 },
            position: { type: "number", minimum: 8, maximum: 92, description: "Centro da legenda em % da altura, a partir do topo. Padrão 70." },
            color: { type: "string", description: "#RRGGBB" },
            highlight: { type: "string", description: "#RRGGBB das palavras entre *asteriscos*." },
            box: { type: "boolean" },
            uppercase: { type: "boolean" },
            pop: { type: "boolean" },
          },
        },
        captions: {
          type: "array",
          description: "Opcional: substitui o texto das legendas, na mesma ordem em que foram devolvidas (use *palavra* para destacar).",
          items: { type: "string" },
        },
      },
      ["generation_id"],
    ),
  },
  {
    name: "editor_render",
    description:
      "Exporta o projeto do editor para MP4 (cortes + legendas gravadas no vídeo) com ffmpeg, local e sem custo. Assíncrono: acompanhe com hub_check_generations. O vídeo exportado aparece no chat com os botões Visualizar e Editor.",
    input_schema: objectSchema({ project_id: { type: "string" } }, ["project_id"]),
  },
  {
    name: "pipeline_get",
    description: "Lê o quadro Kanban do pipeline: colunas (etapas) e cards de criativos com operação, produto, descrição e gerações vinculadas.",
    input_schema: objectSchema({}),
  },
  {
    name: "pipeline_save_card",
    description:
      "Cria ou atualiza um card do quadro Kanban. Sem card_id cria um novo. column pode ser o id ou o nome da coluna (mover de etapa). add_generation_ids vincula gerações do hub ao card.",
    input_schema: objectSchema({
      card_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      operation: { type: "string", enum: ["infoproduto", "cod", ""] },
      product: { type: "string" },
      column: { type: "string" },
      add_generation_ids: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "hub_transcribe",
    description:
      "Transcreve um vídeo ou áudio do hub (inclusive o anexado no chat) e identifica o idioma falado. Devolve o idioma (código ISO e nome), a confiança da detecção, a duração, o texto completo e a transcrição com tempo [mm:ss] por frase. Motor: Whisper local (padrão, grátis) com ElevenLabs Scribe (cobra créditos) só se o local falhar; o resultado fica em cache e qualquer agente reaproveita sem custo. Pode levar de segundos a alguns minutos.",
    input_schema: objectSchema(
      {
        generation_id: { type: "string", description: "Vídeo ou áudio pronto do hub (ex.: o id do anexo na nota de anexos)." },
        engine: { type: "string", enum: ["auto", "elevenlabs", "local"], description: "Padrão auto (Whisper local, com reserva no ElevenLabs). elevenlabs só se o usuário pedir mais precisão." },
      },
      ["generation_id"],
    ),
  },
  {
    name: "hub_view_video",
    description:
      "Assiste a um vídeo do hub (anexado no chat, gerado ou importado do FLORA). Devolve a ficha técnica (duração, tamanho, fps), os cortes de cena, a fala transcrita com tempo [mm:ss] (Whisper local, grátis, em cache) e quadros-chave como imagens: abertura e primeiros 3s (gancho), um por corte e o resto espalhado. Se o vídeo já tiver decupagem salva (hub_save_analysis), ela vem junto: use-a e peça quadros só se faltar algo. Custo: só os tokens das imagens. Comece com poucos quadros e use start/end para olhar um trecho de perto.",
    input_schema: objectSchema(
      {
        generation_id: { type: "string" },
        max_frames: { type: "integer", minimum: 0, maximum: 24, description: "Padrão 8. 0 = só ficha, cortes e fala." },
        start: { type: "number", minimum: 0, description: "Início do trecho em segundos (opcional)." },
        end: { type: "number", minimum: 0, description: "Fim do trecho em segundos (opcional)." },
        frame_size: { type: "string", enum: ["small", "medium", "large"], description: "Padrão medium. large só para ler texto pequeno na tela." },
        transcribe: { type: "boolean", description: "Padrão true." },
      },
      ["generation_id"],
    ),
  },
  {
    name: "hub_save_analysis",
    description:
      "Salva a decupagem ou descrição de um vídeo ou imagem do hub para TODOS os agentes reaproveitarem: ela volta em hub_view_video e entra na busca de hub_list_generations. Criativo validado: trechos com tempo, fala, texto na tela, visual, função (gancho, problema, mecanismo, prova, CTA) e por que funciona. B-roll: 1 ou 2 linhas do que aparece (cena, ação, produto, enquadramento, clima) para ser achado pela busca depois. Substitui a anterior.",
    input_schema: objectSchema({ generation_id: { type: "string" }, analysis: { type: "string" } }, ["generation_id", "analysis"]),
  },
  {
    name: "hub_contact_sheet",
    description:
      "Monta UMA imagem com um quadro de cada geração (o meio do vídeo, ou a própria imagem), numeradas. Serve para comparar vários b-rolls ou frames de uma vez gastando como uma imagem só. Use para escolher b-rolls existentes antes de gerar novos.",
    input_schema: objectSchema({ generation_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 16 } }, ["generation_ids"]),
  },
  {
    name: "flora_projects",
    description:
      "Projeto do FLORA onde ESTA conversa gera. Antes da primeira geração no FLORA de uma conversa, pergunte ao usuário se quer criar um projeto novo (e com que nome) ou usar um existente; se ele quiser escolher, mostre a lista (action=list). Depois registre: action=link com project_id, ou action=create com name. list mostra os projetos, o atual da conversa e em quais conversas cada um já foi usado.",
    input_schema: objectSchema(
      {
        action: { type: "string", enum: ["list", "link", "create"] },
        project_id: { type: "string", description: "Para link." },
        name: { type: "string", description: "Para create (ou para achar o projeto pelo nome no link)." },
      },
      ["action"],
    ),
  },
  {
    name: "flora_project_media",
    description:
      "Lista a mídia que já existe num projeto do FLORA (padrão: o projeto da conversa) e traz para o hub o que ainda não está aqui. Só baixa os arquivos, sem custo no FLORA. Devolve os generation_ids e uma folha de contato numerada. A API do FLORA não devolve o prompt: decida pelo visual e pela decupagem salva, quando houver. Use antes de gerar b-roll novo.",
    input_schema: objectSchema({
      project_id: { type: "string", description: "Outro projeto (id de flora_projects list). Padrão: o da conversa." },
      kind: { type: "string", enum: ["video", "image"], description: "Padrão video." },
      limit: { type: "integer", minimum: 1, maximum: 40, description: "Padrão 16." },
    }),
  },
  {
    name: "hub_list_chats",
    description:
      "Lista as conversas do hub (chat principal e agentes: Estrategista, Copy, VSL, Voz, Avatar UGC, B-rolls, Estáticos, Transcrição), com título, agente, data e projeto do FLORA. Use para achar o trabalho de outro agente (ângulos do Estrategista, copy aprovada, roteiro, decupagem) e ler com hub_read_chat.",
    input_schema: objectSchema({
      agent: { type: "string", description: "Id do agente (estrategista, copy, vsl, voz, avatar, b-rolls, estaticos, transcricao) ou principal." },
      search: { type: "string", description: "Palavras no título ou no texto da conversa." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Padrão 15." },
    }),
  },
  {
    name: "hub_read_chat",
    description:
      "Lê o texto de outra conversa do hub: pedidos do usuário e respostas do agente, sem imagens. Vem do fim para o começo até max_chars. Leia só o necessário.",
    input_schema: objectSchema(
      {
        chat_id: { type: "string" },
        max_chars: { type: "integer", minimum: 1000, maximum: 40000, description: "Padrão 12000." },
      },
      ["chat_id"],
    ),
  },
  {
    name: "heygen_translate_video",
    description:
      "Traduz um vídeo do hub para outros idiomas no HeyGen (Video Translate: voz da pessoa clonada + lipsync), pelo MCP do HeyGen com os créditos do plano. Um idioma = uma geração 'running' (tool heygen-traducao); acompanhe com hub_check_generations. Cobra créditos premium do HeyGen por minuto e por idioma: confirme idiomas e trecho com o usuário antes. Se o HeyGen não estiver conectado, peça para o usuário clicar em \"Conectar HeyGen\" no estúdio de Tradução.",
    input_schema: objectSchema(
      {
        video_generation_id: { type: "string", description: "Vídeo pronto do hub (gerado, editado ou anexado)." },
        output_languages: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "Nomes do HeyGen, ex.: Spanish (Latin America), Spanish (Mexico), Portuguese (Brazil), English (United States), Romanian (Romania).",
        },
        mode: { type: "string", enum: ["speed", "precision"], description: "speed (padrão): mais rápido. precision: lipsync melhor." },
        translate_audio_only: { type: "boolean", description: "Só dubla o áudio, sem lipsync. Padrão false." },
        input_language: { type: "string", description: "Idioma original (nome do HeyGen). Vazio = detectar." },
        speaker_num: { type: "integer", minimum: 1, maximum: 10, description: "Quantas pessoas falam. Vazio = automático." },
        enable_dynamic_duration: { type: "boolean", description: "Padrão true." },
        disable_music_track: { type: "boolean", description: "Remove a música de fundo." },
        enable_speech_enhancement: { type: "boolean", description: "Melhora a voz." },
        keep_the_same_format: { type: "boolean", description: "Mantém resolução e bitrate do original." },
        start_time: { type: "number", minimum: 0, description: "Traduzir só a partir deste segundo." },
        end_time: { type: "number", minimum: 0, description: "Traduzir só até este segundo." },
        brand_glossary_id: { type: "string" },
        audio_generation_id: { type: "string", description: "Áudio do hub para usar como dublagem no lugar da voz clonada." },
        title: { type: "string" },
      },
      ["video_generation_id", "output_languages"],
    ),
  },
  {
    name: "editor_join",
    description:
      "Junta vídeos do hub em sequência num projeto novo do editor (ex.: gancho + body, variações de gancho com o mesmo body), com corte opcional de cada trecho. Local, com ffmpeg, sem custo: é ASSIM que se juntam vídeos no hub (não existe sandbox do Higgsfield aqui). Com render=true já exporta o MP4 (acompanhe com hub_check_generations); senão devolve o projeto para legendar com editor_open/ajustar e exportar com editor_render. Para N ganchos com o mesmo body, chame uma vez por gancho.",
    input_schema: objectSchema(
      {
        clips: {
          type: "array",
          minItems: 2,
          maxItems: 20,
          description: "Na ordem em que entram.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              generation_id: { type: "string", description: "Vídeo pronto do hub." },
              in: { type: "number", minimum: 0, description: "Início do trecho em segundos. Padrão 0." },
              out: { type: "number", minimum: 0, description: "Fim do trecho em segundos. Padrão: até o fim." },
            },
            required: ["generation_id"],
          },
        },
        title: { type: "string", description: "Nome do projeto, ex.: AD01 gancho 2." },
        render: { type: "boolean", description: "Exportar o MP4 já. Padrão false." },
      },
      ["clips"],
    ),
  },
  {
    name: "ad_writer",
    description:
      "Método ad-writer-light (squad de copy de direct response): base de conhecimento + pool de anúncios campeões por nicho. files/read/search: consultar agentes, tasks (revise-hook, revise-body, inject-loops...), data (hook-patterns, emotional-triggers, sexy-canvas-kb, viral-headline-formulas...) e checklists; leia só o trecho necessário (offset). niches/niche_read/niche_save: referências (reference-ads.md) e análises do nicho (pattern-analysis.yaml, synthesis-brief.md, sexy-canvas-analysis.yaml, sexy-synthesis-brief.md, sub-personas.yaml, notes.md), compartilhadas entre Estrategista e Copy; análise salva antes de mudar as referências aparece como VELHA. add_refs: acrescenta anúncios campeões ao pool. draw: sorteio real de referências (nunca escolha de cabeça).",
    input_schema: objectSchema(
      {
        action: { type: "string", enum: ["files", "read", "search", "niches", "niche_read", "niche_save", "add_refs", "draw"] },
        path: { type: "string", description: "read: caminho da base, ex.: tasks/revise-hook.md." },
        offset: { type: "integer", minimum: 0, description: "read: a partir de qual caractere (use next_offset). Padrão 0." },
        max_chars: { type: "integer", minimum: 1000, maximum: 25000, description: "read: padrão 25000." },
        query: { type: "string", description: "search: palavras (todas na mesma linha)." },
        niche: { type: "string", description: "Nicho, ex.: garrafa-termica-cl, emagrecimento-infoproduto." },
        file: { type: "string", description: "niche_read/niche_save: nome do arquivo do nicho." },
        content: { type: "string", description: "niche_save: conteúdo completo do arquivo." },
        ads: { type: "array", items: { type: "string" }, maxItems: 50, description: "add_refs: um anúncio por item (texto falado completo)." },
        count: { type: "integer", minimum: 1, maximum: 30, description: "draw: quantas referências sortear. Padrão 3." },
      },
      ["action"],
    ),
  },
];

const handlers: Record<string, (input: Input, ctx: Ctx) => Promise<ToolOutcome>> = {
  async hub_list_generations(input) {
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
    const all = await listGenerations(GEN_TOOLS.includes(str(input.tool)) ? (str(input.tool) as Generation["tool"]) : undefined);
    const filtered = all.filter((g) => (!input.kind || g.kind === input.kind) && (!input.status || g.status === input.status));
    const notes = new Map(await Promise.all(filtered.map(async (g) => [g.id, (await getAnalysis(g.id)).notes ?? ""] as const)));
    const words = str(input.search).toLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.length
      ? filtered.filter((g) => {
          const hay = `${g.prompt} ${JSON.stringify(g.params)} ${notes.get(g.id)}`.toLowerCase();
          return words.some((w) => hay.includes(w));
        })
      : filtered;
    const items = matches.slice(0, limit).map((g) => ({ ...brief(g), ...(notes.get(g.id) ? { decupagem: cut(notes.get(g.id)!, 300) } : {}) }));
    return { content: json({ total: matches.length, items }), summary: `${items.length} gerações` };
  },

  async hub_check_generations(input, { signal }) {
    const ids = (Array.isArray(input.ids) ? input.ids : []).map(str).slice(0, 20);
    const deadline = Date.now() + Math.min(240, Math.max(0, Number(input.wait_seconds) || 0)) * 1000;
    let gens: Generation[] = [];
    for (;;) {
      gens = [];
      for (const id of ids) {
        const g = await getGeneration(id);
        if (g) gens.push(await refreshGeneration(g).catch(() => g));
      }
      const pending = gens.some((g) => g.status === "pending" || g.status === "running");
      if (!pending || Date.now() >= deadline || signal.aborted) break;
      await sleep(8000, signal);
    }
    const missing = ids.filter((id) => !gens.some((g) => g.id === id));
    const done = gens.filter((g) => g.status === "done").length;
    return {
      content: json({ items: gens.map(brief), ...(missing.length ? { not_found: missing } : {}) }),
      summary: `${done}/${ids.length} prontas`,
      generations: gens,
    };
  },

  async hub_view_image(input) {
    const g = await getGeneration(str(input.generation_id));
    if (!g) throw new InputError("Geração não encontrada.");
    if (g.kind !== "image" || !g.file) throw new InputError("Essa geração não é uma imagem pronta.");
    return {
      content: [{ type: "text", text: `Imagem ${g.id} (${g.tool}): ${cut(g.prompt, 300)}` }, imageRef(g.file)],
      summary: "imagem carregada",
    };
  },

  async elevenlabs_list_voices(input) {
    const q = str(input.search).toLowerCase();
    // Busca também por gênero/idade em português ("feminina", "idosa"…); gênero/idade deduzidos do nome vêm com guessed=true.
    const PT: Record<string, string> = { female: "feminina feminino mulher", male: "masculina masculino homem", neutral: "neutra neutro", young: "jovem", middle_aged: "meia-idade adulta adulto", old: "idosa idoso velha velho" };
    const voices = (await listElevenVoices()).filter(
      (v) => !q || `${v.name} ${v.description} ${v.accent} ${v.useCase} ${PT[v.gender] ?? ""} ${PT[v.age] ?? ""}`.toLowerCase().includes(q),
    );
    const order = (v: { gender: string; age: string }) => `${["female", "male", "neutral", ""].indexOf(v.gender)}${["young", "middle_aged", "old", ""].indexOf(v.age)}`;
    const items = [...voices]
      .sort((a, b) => order(a).localeCompare(order(b)) || a.name.localeCompare(b.name))
      .slice(0, 80)
      .map((v) => ({
        id: v.id,
        name: v.name,
        gender: v.gender || "desconhecido",
        age: v.age || "desconhecida",
        ...(v.guessed ? { guessed: true } : {}),
        ...(v.accent ? { accent: v.accent } : {}),
        category: v.category,
        description: cut(v.description, 100),
      }));
    return { content: json({ total: voices.length, items }), summary: `${voices.length} vozes` };
  },

  async elevenlabs_tts(input) {
    const g = await runTts({
      text: str(input.text),
      voiceId: str(input.voice_id),
      voiceName: str(input.voice_name),
      modelId: str(input.model_id),
      stability: input.stability as number | undefined,
      similarity: input.similarity as number | undefined,
      style: input.style as number | undefined,
      speed: input.speed as number | undefined,
    });
    return { content: json(brief(g)), summary: "narração pronta", generations: [g] };
  },

  async heygen_list_avatars(input) {
    const ownership = input.ownership === "public" ? "public" : "private";
    const q = str(input.search).toLowerCase();
    const looks = (await listLooks(ownership)).filter((l) => !q || l.name.toLowerCase().includes(q));
    const items = looks.map(({ id, name, type, orientation }) => ({ id, name, type, orientation }));
    return { content: json({ ownership, items }), summary: `${looks.length} avatares` };
  },

  async heygen_list_voices(input) {
    const voices = await listHeyVoices(str(input.language) || undefined);
    const items = voices.slice(0, 80).map(({ id, name, language, gender, own }) => ({ id, name, language, gender, own }));
    return { content: json({ total: voices.length, items }), summary: `${voices.length} vozes` };
  },

  async heygen_create_video(input) {
    const base = {
      lookId: str(input.look_id),
      lookName: str(input.look_name),
      aspectRatio: str(input.aspect_ratio),
      resolution: str(input.resolution),
    };
    const g = input.audio_generation_id
      ? await runAvatar({ ...base, mode: "audio", audioGenerationId: str(input.audio_generation_id) })
      : await runAvatar({ ...base, mode: "script", script: str(input.script), voiceId: str(input.voice_id), voiceName: str(input.voice_name) });
    return { content: json(brief(g)), summary: "vídeo na fila", generations: [g] };
  },

  async flora_list_models() {
    const families = FLORA_FAMILIES.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      note: f.note,
      base_cost_usd: f.baseCostUsd,
      params: Object.fromEntries(
        f.params.map((p) => [
          p.name,
          {
            default: p.default,
            options: p.options.map((o) => o.value),
            ...(p.only ? { only_when: p.only === "image" ? "com referência" : "sem referência" } : {}),
          },
        ]),
      ),
    }));
    return { content: json({ families, cod_markets: MARKETS }), summary: `${families.length} modelos` };
  },

  async flora_quote(input) {
    const q = await quoteFlora({
      family: str(input.family),
      params: strParams(input.params),
      count: Number(input.count) || 1,
      referenceId: str(input.reference_generation_id) || undefined,
    });
    return {
      content: json({ estimated_cost_usd: Number(q.estimatedCost.toFixed(3)), approximate: q.approximate }),
      summary: `US$ ${q.estimatedCost.toFixed(2)}${q.approximate ? " (aprox.)" : ""}`,
    };
  },

  async flora_generate(input, { chat }) {
    if (chat && !chat.floraProject) {
      throw new InputError(
        "Esta conversa ainda não tem projeto do FLORA. Pergunte ao usuário se quer criar um projeto novo (e o nome) ou usar um existente (mostre a lista com flora_projects action=list) e registre com flora_projects antes de gerar.",
      );
    }
    const gens = await runFlora({
      projectId: chat?.floraProject?.id,
      family: str(input.family),
      prompt: str(input.prompt),
      params: strParams(input.params),
      count: Number(input.count) || 1,
      operation: str(input.operation),
      market: str(input.market),
      referenceId: str(input.reference_generation_id) || undefined,
      label: str(input.label) || undefined,
    });
    return {
      content: json({ flora_project: chat?.floraProject?.name, items: gens.map(brief) }),
      summary: `${gens.length} na fila`,
      generations: gens,
    };
  },

  async higgsfield_list_edits() {
    const tools = EDIT_TOOLS.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      needs_prompt: Boolean(t.prompt),
      params: Object.fromEntries(t.fields.map((f) => [f.name, { default: f.default, options: f.options.map((o) => o.value) }])),
    }));
    return { content: json({ tools }), summary: `${tools.length} edições` };
  },

  async higgsfield_edit(input) {
    const g = await runEdit({
      tool: str(input.tool),
      prompt: str(input.prompt),
      params: strParams(input.params),
      source: { generationId: str(input.source_generation_id) },
    });
    return { content: json(brief(g)), summary: "edição na fila", generations: [g] };
  },

  async hub_montage(input) {
    const g = await runMontage({
      avatarId: str(input.avatar_generation_id),
      brollIds: (Array.isArray(input.broll_generation_ids) ? input.broll_generation_ids : []).map(str),
      lang: str(input.lang),
      name: str(input.name),
    });
    return { content: json(brief(g)), summary: "montagem iniciada", generations: [g] };
  },

  async editor_open(input) {
    let project = await openProject(str(input.generation_id));
    if (input.auto_captions) project = await autoCaptions(project.id, { perCaption: Number(input.words_per_caption) || 3 });
    const style = (input.style && typeof input.style === "object" ? input.style : {}) as Partial<CaptionStyle>;
    const texts = Array.isArray(input.captions) ? input.captions.map(str) : null;
    if (Object.keys(style).length || texts) {
      const placed = placeCaptions(project);
      const captions = texts
        ? project.captions.map((c) => {
            const i = placed.findIndex((p) => p.captionId === c.id);
            return i >= 0 && texts[i] !== undefined ? { ...c, text: texts[i] } : c;
          })
        : undefined;
      project = await saveProject(project.id, { style: { ...DEFAULT_STYLE, ...project.style, ...style }, ...(captions ? { captions } : {}) });
    }
    const { total } = placeClips(project);
    const placed = placeCaptions(project);
    return {
      content: json({
        project_id: project.id,
        editor_url: `/editor?p=${project.id}`,
        duration: Number(total.toFixed(2)),
        size: `${project.width}x${project.height}`,
        style: project.style,
        captions: placed.map((c) => ({ start: Number(c.start.toFixed(2)), end: Number(c.end.toFixed(2)), text: c.text })),
      }),
      summary: `projeto aberto · ${placed.length} legendas`,
    };
  },

  async editor_render(input) {
    const g = await renderProject(str(input.project_id));
    return { content: json(brief(g)), summary: "exportando", generations: [g] };
  },

  async pipeline_get() {
    const board = await getBoard();
    const columns = board.columns.map((col) => ({
      id: col.id,
      title: col.title,
      cards: col.cardIds
        .map((id) => board.cards[id])
        .filter(Boolean)
        .map((c) => ({ id: c.id, title: c.title, operation: c.operation, product: c.product, description: cut(c.description, 400), generation_ids: c.generationIds })),
    }));
    return { content: json({ columns }), summary: `${Object.keys(board.cards).length} cards` };
  },

  async pipeline_save_card(input) {
    const board = await getBoard();
    const colInput = str(input.column).trim().toLowerCase();
    const column = colInput ? board.columns.find((c) => c.id === colInput || c.title.toLowerCase() === colInput) : undefined;
    if (colInput && !column) throw new InputError(`Coluna não encontrada: ${str(input.column)}. Colunas: ${board.columns.map((c) => c.title).join(", ")}.`);
    const operation = input.operation === "" ? "" : OPERATIONS.some((o) => o === input.operation) ? (input.operation as Operation) : undefined;
    const addIds = (Array.isArray(input.add_generation_ids) ? input.add_generation_ids : []).map(str);
    const fields = {
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(operation !== undefined ? { operation } : {}),
      ...(typeof input.product === "string" ? { product: input.product } : {}),
    };
    let card;
    if (input.card_id) {
      const current = board.cards[str(input.card_id)];
      if (!current) throw new InputError("Card não encontrado.");
      card = await updateCard(current.id, { ...fields, ...(addIds.length ? { generationIds: [...new Set([...current.generationIds, ...addIds])] } : {}) });
      if (column) await moveCard(card.id, column.id);
    } else {
      if (!fields.title) throw new InputError("Informe o título do card.");
      card = await createCard({ ...fields, title: fields.title, columnId: column?.id, generationIds: addIds });
    }
    return { content: json({ card, column: column?.title }), summary: input.card_id ? "card atualizado" : "card criado" };
  },

  async hub_transcribe(input) {
    const engine = (["elevenlabs", "local"].includes(str(input.engine)) ? str(input.engine) : "auto") as Engine;
    const { transcript: t, noSpeech, cached } = await transcriptOf(str(input.generation_id), engine);
    if (!t) return { content: json({ fala: noSpeech ?? "sem fala" }), summary: "sem fala" };
    const lines = timeline(t);
    return {
      content: json({
        idioma: t.languageName,
        codigo: t.languageCode,
        confianca: t.confidence === null ? null : Number(t.confidence.toFixed(2)),
        duracao_s: t.duration === null ? null : Math.round(t.duration),
        motor: t.engine === "elevenlabs" ? "ElevenLabs Scribe" : "Whisper local",
        cache: cached,
        texto: cut(t.text, 40_000),
        com_tempo: cut(lines, 40_000),
      }),
      summary: `${t.languageName}${t.confidence !== null ? ` (${Math.round(t.confidence * 100)}%)` : ""} · ${t.segments.length} frases`,
    };
  },

  async hub_view_video(input) {
    const g = await readyMedia(str(input.generation_id), ["video"]);
    const { meta, cuts } = await videoInfo(g);
    const analysis = await getAnalysis(g.id);

    let fala: unknown = "não pedida";
    if (input.transcribe !== false) {
      if (!meta.hasAudio) fala = "o vídeo não tem trilha de áudio";
      else {
        try {
          const { transcript: t, noSpeech, cached } = await transcriptOf(g.id);
          fala = t
            ? { idioma: `${t.languageName} (${t.languageCode})`, motor: t.engine === "elevenlabs" ? "ElevenLabs Scribe" : "Whisper local", cache: cached, com_tempo: cut(timeline(t), 30_000) || "(nenhuma fala detectada)" }
            : (noSpeech ?? "sem fala");
        } catch (err) {
          fala = `não consegui transcrever: ${err instanceof Error ? err.message : "erro"}`;
        }
      }
    }

    const max = num(input.max_frames, 0, 24, 8);
    const start = input.start === undefined ? undefined : num(input.start, 0, meta.duration, 0);
    const end = input.end === undefined ? undefined : num(input.end, 0, meta.duration, meta.duration);
    const size = FRAME_SIZES[str(input.frame_size) as keyof typeof FRAME_SIZES] ?? FRAME_SIZES.medium;
    const picks = max && meta.duration > 0 ? pickTimes(meta.duration, cuts, max, start, end) : [];
    const frames: string[] = [];
    for (const p of picks) frames.push(await frameAt(g, p.t, size)); // um ffmpeg por vez

    const summary = {
      id: g.id,
      origem: `${g.tool}: ${cut(g.prompt, 200)}`,
      duracao_s: Number(meta.duration.toFixed(2)),
      tamanho: `${meta.width}x${meta.height}`,
      fps: meta.fps,
      cortes: cuts.length > 80 ? `${cuts.length} cortes (muitos para listar)` : cuts.map(ts),
      cortes_por_minuto: meta.duration ? Math.round((cuts.length / meta.duration) * 60) : 0,
      ...(analysis.notes ? { decupagem_salva: analysis.notes } : {}),
      fala,
      quadros: picks.length ? `${picks.length} abaixo, em ordem` : "nenhum",
    };
    return {
      content: [{ type: "text", text: json(summary) }, ...picks.flatMap((p, i) => [{ type: "text" as const, text: `[${ts(p.t)}] ${p.why}` }, imageRef(frames[i])])],
      summary: `${Math.round(meta.duration)}s · ${cuts.length} cortes · ${picks.length} quadros${analysis.notes ? " · decupagem salva" : ""}`,
    };
  },

  async hub_save_analysis(input) {
    const g = await readyMedia(str(input.generation_id), ["video", "image", "audio"]);
    const text = str(input.analysis).trim();
    if (!text) throw new InputError("Escreva a decupagem.");
    await patchAnalysis(g.id, { notes: cut(text, 20_000), notesAt: new Date().toISOString() });
    return { content: json({ ok: true, id: g.id }), summary: "decupagem salva" };
  },

  async hub_contact_sheet(input) {
    const ids = [...new Set((Array.isArray(input.generation_ids) ? input.generation_ids : []).map(str))].slice(0, 16);
    if (!ids.length) throw new InputError("Informe as gerações.");
    const gens = await Promise.all(ids.map((id) => readyMedia(id, ["video", "image"])));
    const tiles = await Promise.all(gens.map(async (g, i) => ({ file: await thumbOf(g), label: `#${i + 1}` })));
    const sheet = await contactSheet(tiles);
    const list = await Promise.all(
      gens.map(async (g, i) => {
        const a = await getAnalysis(g.id);
        return {
          n: i + 1,
          id: g.id,
          kind: g.kind,
          ...(a.meta ? { duracao_s: Math.round(a.meta.duration * 10) / 10 } : {}),
          prompt: cut(g.prompt, 160),
          ...(a.notes ? { decupagem: cut(a.notes, 200) } : {}),
        };
      }),
    );
    return { content: [{ type: "text", text: json(list) }, imageRef(sheet)], summary: `${gens.length} na folha` };
  },

  async flora_projects(input, { chat }) {
    const action = str(input.action);
    if (action === "create") {
      const name = str(input.name).trim();
      if (!name) throw new InputError("Informe o nome do projeto novo.");
      const p = await createProject(name);
      if (chat) chat.floraProject = { id: p.id, name: p.name };
      return { content: json({ current: chat?.floraProject ?? p }), summary: `projeto criado: ${p.name}` };
    }
    const projects = await listProjects();
    if (action === "link") {
      const id = str(input.project_id).trim();
      const name = str(input.name).trim().toLowerCase();
      const p = projects.find((x) => x.id === id) ?? (name ? projects.find((x) => x.name.toLowerCase() === name) : undefined);
      if (!p) throw new InputError("Projeto não encontrado. Use action=list para ver os projetos.");
      if (chat) chat.floraProject = { id: p.id, name: p.name };
      return { content: json({ current: chat?.floraProject ?? p }), summary: `projeto: ${p.name}` };
    }
    const usedBy = new Map<string, string[]>();
    for (const c of await listFullChats()) {
      if (c.floraProject && c.id !== chat?.id) usedBy.set(c.floraProject.id, [...(usedBy.get(c.floraProject.id) ?? []), `${agentName(c)}: ${c.title}`]);
    }
    const items = projects.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.lastModified ? { modificado: new Date(p.lastModified).toISOString().slice(0, 10) } : {}),
      ...(usedBy.has(p.id) ? { usado_em: usedBy.get(p.id)!.slice(0, 3) } : {}),
    }));
    return { content: json({ current: chat?.floraProject ?? null, projects: items }), summary: `${projects.length} projetos` };
  },

  async flora_project_media(input, { chat }) {
    const id = str(input.project_id).trim();
    let project = chat?.floraProject;
    if (id) {
      const p = (await listProjects()).find((x) => x.id === id);
      if (!p) throw new InputError("Projeto não encontrado. Use flora_projects action=list.");
      project = { id: p.id, name: p.name };
    }
    if (!project) throw new InputError("Esta conversa ainda não tem projeto do FLORA: informe project_id ou registre um com flora_projects.");
    const kind = input.kind === "image" ? "image" : "video";
    const { total, items } = await importFloraMedia(project.id, project.name, kind, num(input.limit, 1, 40, 16));
    const list = await Promise.all(
      items.map(async ({ generation: g, imported }, i) => {
        const a = await getAnalysis(g.id);
        return { n: i + 1, id: g.id, ...(imported ? { importado_agora: true } : {}), ...(a.notes ? { decupagem: cut(a.notes, 200) } : {}) };
      }),
    );
    const content: ToolResultContent[] = [{ type: "text", text: json({ project: project.name, total_no_projeto: total, items: list }) }];
    const sheetGens = items.slice(0, 16).map((x) => x.generation as Generation & { file: string });
    if (sheetGens.length) {
      const tiles = await Promise.all(sheetGens.map(async (g, i) => ({ file: await thumbOf(g), label: `#${i + 1}` })));
      content.push({ type: "text", text: `Folha de contato (#1 a #${sheetGens.length}):` }, imageRef(await contactSheet(tiles)));
    }
    return { content, summary: `${items.length} de ${total} no projeto ${project.name}`, generations: items.filter((x) => x.imported).map((x) => x.generation) };
  },

  async hub_list_chats(input, { chat }) {
    const agent = str(input.agent).trim();
    const words = str(input.search).toLowerCase().split(/\s+/).filter(Boolean);
    const chats = (await listFullChats()).filter((c) => {
      if (agent && (agent === "principal" ? Boolean(c.agentId) : c.agentId !== agent)) return false;
      if (!words.length) return true;
      const hay = `${c.title} ${chatText(c)}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const items = chats.slice(0, num(input.limit, 1, 50, 15)).map((c) => ({
      id: c.id,
      titulo: c.title,
      agente: agentName(c),
      atualizada: c.updatedAt.slice(0, 16).replace("T", " "),
      mensagens: c.messages.length,
      ...(c.floraProject ? { projeto_flora: c.floraProject.name } : {}),
      ...(c.id === chat?.id ? { esta_conversa: true } : {}),
    }));
    return { content: json({ total: chats.length, items }), summary: `${items.length} conversas` };
  },

  async hub_read_chat(input) {
    const c = (await listFullChats()).find((x) => x.id === str(input.chat_id));
    if (!c) throw new InputError("Conversa não encontrada. Use hub_list_chats.");
    const max = num(input.max_chars, 1000, 40000, 12000);
    const text = chatText(c);
    const body = text.length > max ? `(início cortado)\n…${text.slice(-max)}` : text;
    return { content: `Conversa "${c.title}" (${agentName(c)}):\n\n${body}`, summary: `${agentName(c)}: ${cut(c.title, 40)}` };
  },

  async heygen_translate_video(input) {
    const optBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    const optNum = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
    const gens = await runTranslation({
      videoGenerationId: str(input.video_generation_id),
      outputLanguages: (Array.isArray(input.output_languages) ? input.output_languages : []).map(str),
      mode: input.mode === "precision" ? "precision" : "speed",
      translateAudioOnly: optBool(input.translate_audio_only),
      inputLanguage: str(input.input_language) || null,
      speakerNum: optNum(input.speaker_num),
      enableDynamicDuration: optBool(input.enable_dynamic_duration),
      disableMusicTrack: optBool(input.disable_music_track),
      enableSpeechEnhancement: optBool(input.enable_speech_enhancement),
      keepTheSameFormat: optBool(input.keep_the_same_format),
      startTime: optNum(input.start_time),
      endTime: optNum(input.end_time),
      brandGlossaryId: str(input.brand_glossary_id) || null,
      audioGenerationId: str(input.audio_generation_id) || null,
      title: str(input.title),
    });
    return {
      content: json({ items: gens.map(brief), next: "Acompanhe com hub_check_generations (costuma levar alguns minutos por idioma)." }),
      summary: `${gens.length} ${gens.length === 1 ? "tradução enviada" : "traduções enviadas"}`,
      generations: gens,
    };
  },

  async editor_join(input) {
    const items = (Array.isArray(input.clips) ? input.clips : []).map((c) => {
      const clip = (c && typeof c === "object" ? c : {}) as Input;
      const optNum = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
      return { generationId: str(clip.generation_id), in: optNum(clip.in), out: optNum(clip.out) };
    });
    const project = await joinProject(items, str(input.title));
    const { clips, total } = placeClips(project);
    const info = {
      project_id: project.id,
      editor_url: `/editor?p=${project.id}`,
      duration: Number(total.toFixed(2)),
      size: `${project.width}x${project.height}`,
      clips: clips.map((c) => ({ generation_id: c.sourceId, in: Number(c.in.toFixed(2)), out: Number(c.out.toFixed(2)), at: Number(c.offset.toFixed(2)) })),
    };
    if (!input.render) return { content: json({ ...info, next: "Use editor_open com legendas ou editor_render para exportar." }), summary: `${clips.length} trechos · ${total.toFixed(1)}s` };
    const g = await renderProject(project.id);
    return { content: json({ ...info, export: brief(g) }), summary: `juntando ${clips.length} trechos`, generations: [g] };
  },

  async ad_writer(input) {
    const niche = str(input.niche);
    switch (str(input.action)) {
      case "files": {
        const files = await kbFiles();
        return { content: json(files.map((f) => `${f.path} (${Math.round(f.size / 1000)}k)`)), summary: `${files.length} arquivos do método` };
      }
      case "read": {
        const r = await kbRead(str(input.path), num(input.offset, 0, 10_000_000, 0), num(input.max_chars, 1000, 25000, 25000));
        return { content: `[${r.path} · caracteres ${r.offset}-${r.offset + r.text.length} de ${r.total_chars}${r.next_offset !== null ? ` · continua em offset=${r.next_offset}` : ""}]\n\n${r.text}`, summary: cut(r.path, 60) };
      }
      case "search": {
        const hits = await kbSearch(str(input.query));
        return { content: json(hits), summary: `${hits.length} trechos` };
      }
      case "niches": {
        const list = await listNiches();
        return { content: json(list.length ? list : "Nenhum nicho ainda. Use add_refs com os anúncios campeões."), summary: `${list.length} nichos` };
      }
      case "niche_read": {
        const r = await readNiche(niche, str(input.file) || "reference-ads.md");
        return { content: json(r), summary: `${r.niche}/${r.file}` };
      }
      case "niche_save": {
        const r = await saveNiche(niche, str(input.file), str(input.content));
        return { content: json(r), summary: `salvo ${r.niche}/${r.file}` };
      }
      case "add_refs": {
        const r = await addReferences(niche, (Array.isArray(input.ads) ? input.ads : []).map(str));
        return { content: json(r), summary: `${r.added} referências · total ${r.ref_count}` };
      }
      case "draw": {
        const r = await drawReferences(niche, num(input.count, 1, 30, 3));
        return { content: json(r), summary: `sorteio: #${r.drawn.map((d) => d.position).join(", #")}` };
      }
      default:
        throw new InputError("Ação inválida.");
    }
  },
};

export const CLIENT_TOOLS = definitions;
export const TOOL_NAMES = definitions.map((d) => d.name);

// Cada conversa usa a lista de ferramentas de quando foi criada: mudar as ferramentas no meio
// de uma conversa muda o prefixo (cache) e invalida os blocos de raciocínio já salvos.
export const toolsFor = (names?: string[]) => (names ? definitions.filter((d) => names.includes(d.name)) : definitions);

// Ferramentas que rodam nos servidores da Anthropic (pesquisa e leitura de páginas, ex.: página de vendas).
export const SERVER_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
];

export async function runTool(name: string, input: unknown, ctx: Ctx): Promise<ToolOutcome & { error: boolean }> {
  const handler = handlers[name];
  if (!handler) return { content: `Ferramenta desconhecida: ${name}`, summary: "desconhecida", error: true };
  try {
    return { ...(await handler((input ?? {}) as Input, ctx)), error: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro inesperado";
    return { content: message, summary: cut(message, 120), error: true };
  }
}

// Linha curta mostrada no card da ferramenta (o que foi pedido).
export function toolDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Input;
  const pick = (...keys: string[]) => keys.map((k) => str(i[k])).find(Boolean) ?? "";
  if (name === "web_search") return pick("query");
  if (name === "web_fetch") return pick("url");
  return cut(pick("prompt", "text", "script", "title", "search", "family", "tool", "generation_id", "project_id", "name", "action", "agent", "chat_id", "language"), 140);
}
