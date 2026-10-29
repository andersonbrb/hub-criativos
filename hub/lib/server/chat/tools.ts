import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import { getAgentProfile } from "@/lib/agent-profiles";
import { FLORA_FAMILIES, MARKETS } from "@/lib/flora-models";
import type { Generation } from "@/lib/generations";
import { OPERATIONS, type Operation } from "@/lib/board";
import { DEFAULT_STYLE, placeCaptions, placeClips, type CaptionStyle } from "@/lib/editor";
import { quoteFlora, refreshGeneration, runAvatar, runFlora, runTts } from "@/lib/server/actions";
import { imageRef } from "@/lib/server/chat/images";
import { listFullChats, type Chat } from "@/lib/server/chat/store";
import { createCard, getBoard, moveCard, updateCard } from "@/lib/server/board";
import { autoCaptions, joinProject, openProject, renderProject, saveProject } from "@/lib/server/editor";
import { InputError } from "@/lib/server/http";
import { pastaDeMidia } from "@/lib/server/pastas";
import { runBeatEdit, runMontage, runRemoveCaptions, type MontageFx, type MontageRequest } from "@/lib/server/montage";
import type { GraphicRequest } from "@/lib/server/motion";
import { timeline, type Engine, type Transcript } from "@/lib/server/transcription";
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
import { createProject, getProject, listProjects } from "@/lib/server/providers/flora";
import { createAvatar, listCreations, type AvatarMode } from "@/lib/server/heygen-avatars";
import { listLooks, listVoices as listHeyVoices } from "@/lib/server/providers/heygen";
import { mcp } from "@/lib/server/mcp-client";
import { saveMedia } from "@/lib/server/media";
import { createGeneration, getGeneration, listGenerations } from "@/lib/server/store";
// ---- Acesso (features/acesso) ----
import { ehAdmin, podeUsar, SemPermissao, type Chave, type Usuario } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
// ---- Drive (features/drive) ----
import { arquivoLocal, exigirDriveParaVideo, guardarNoDriveEmSegundoPlano, prazoNoHub } from "@/features/drive/servicos/videos";
// ---- Memória (features/memoria) ----
import { FRENTE_ROTULO, FRENTES, TIPO_ROTULO, TIPOS, type DocResumo, type Frente, type TipoDoc } from "@/features/memoria/contrato";
import { DocNaoEncontrado } from "@/features/memoria/erros";
import {
  acrescentarSecao,
  registrarLicao,
  buscar as buscarNaMemoria,
  ler as lerDaMemoria,
  listarIndice as indiceDaMemoria,
  resolverSlug,
  salvar as salvarNaMemoria,
} from "@/features/memoria/servicos/memoria";

// PC sem banco: a Memória só existe no hub da nuvem. Resposta para o agente seguir com os playbooks do prompt.
const MEMORIA_FORA = { content: "A Memória fica no hub da nuvem; neste PC ela não está ligada. Siga os playbooks do prompt.", summary: "memória indisponível" };

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
// viaMcp: chamada pela MCP do hub (Claude Code), que corta ferramentas demoradas: esperas ficam curtas.
// usuario: quem está usando o chat. runTool barra a ferramenta que exige uma chave que a pessoa não tem
// (CHAVE_DA_FERRAMENTA, no fim do arquivo). As rotas do chat sempre passam a pessoa; só scripts e testes internos
// chamam sem ela, e aí nada é barrado.
type Ctx = { signal: AbortSignal; chat?: Chat; viaMcp?: boolean; usuario?: Usuario };

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
    ...(g.name ? { nome: g.name } : {}),
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

// Foto de prévia de um avatar do HeyGen, baixada uma vez só (cache nas mídias da organização pelo hash da URL).
async function lookThumb(url: string): Promise<string> {
  const file = `heygen-look-${createHash("sha1").update(url.split("?")[0]).digest("hex").slice(0, 16)}.jpg`;
  const midia = await pastaDeMidia();
  const out = path.join(midia, file);
  if (existsSync(out)) return file;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`foto ${res.status}`);
  await mkdir(midia, { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return file;
}

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
      "Atualiza o status de gerações assíncronas (FLORA, HeyGen, edição final/montagem, editor) e baixa o resultado quando ficam prontas. Com wait_seconds, espera até todas terminarem ou o tempo acabar; use quando o próximo passo depende do resultado (ex.: frame aprovado antes do vídeo).",
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
      "Gera uma narração (texto para fala) no ElevenLabs. Síncrono: devolve a geração pronta, que pode ir para o lipsync do HeyGen. Até 5.000 caracteres. Cobra 1 crédito por caractere (Flash: meio).\n" +
      "VOZ NO PADRÃO DO SÁVIO (contexto do Sávio na Memória, documento 08): modelo eleven_multilingual_v2 (o padrão). Roteiro no idioma do mercado, sem hora do dia ('hoy', 'esta noche') e sem promessa de resultado. Nome de marca que o TTS erra vai com grafia fonética no texto do áudio (o roteiro e a legenda ficam com a grafia certa); siglas e números por extenso, com a mesma grafia em todos os vídeos do lote. Velocidade até 1,1x: se não couber no tempo, enxugue o texto. Uma voz por personagem/criador, a mesma em todos os vídeos dele. O roteiro inteiro vai numa geração só. Marca própria: o padrão é clonar a voz do narrador original (e voz única por clone + speech-to-speech); o hub ainda não clona voz nem faz speech-to-speech: quando o lote precisar disso, diga ao usuário em vez de trocar por outra voz sem perguntar.\n" +
      "Depois de gerar, transcreva (hub_transcribe) e compare com o roteiro: se uma frase saiu lida errado, refaça só ela. Guarde o roteiro exato: a edição final (hub_montage) faz a legenda com ele.",
    input_schema: objectSchema(
      {
        text: { type: "string", description: "Roteiro exato da narração, no idioma do mercado." },
        voice_id: { type: "string", description: "Id vindo de elevenlabs_list_voices." },
        voice_name: { type: "string" },
        model_id: {
          type: "string",
          enum: ["eleven_multilingual_v2", "eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_flash_v2_5"],
          description:
            "eleven_multilingual_v2 (padrão do Sávio). Os outros só se o usuário pedir: eleven_v4/v3 (aceitam tags de emoção), eleven_flash_v2_5 (mais barato, robótico, só rascunho).",
        },
        stability: { type: "number", minimum: 0, maximum: 1, description: "Padrão 0.3 (mais baixo = mais emoção e variação)." },
        similarity: { type: "number", minimum: 0, maximum: 1, description: "Padrão 0.8." },
        style: { type: "number", minimum: 0, maximum: 1, description: "Só multilingual_v2. Padrão 0.3." },
        speed: { type: "number", minimum: 0.7, maximum: 1.1, description: "Até 1.1 (regra do Sávio). Padrão 1." },
      },
      ["text", "voice_id"],
    ),
  },
  {
    name: "heygen_list_avatars",
    description:
      "Lista avatares (looks) do HeyGen. private = avatares da conta do usuário; public = biblioteca do HeyGen. Com preview (padrão), devolve também uma folha de contato com a foto de cada avatar (#n = posição na lista, até 16 por página): escolha pela APARÊNCIA (gênero, idade, cenário, estilo UGC), não só pelo nome. Use search e page para ver outros.",
    input_schema: objectSchema({
      ownership: { type: "string", enum: ["private", "public"], description: "Padrão private." },
      search: { type: "string" },
      preview: { type: "boolean", description: "Padrão true: folha com as fotos. false = só a lista (mais barato)." },
      page: { type: "integer", minimum: 1, description: "Página de 16 avatares da folha. Padrão 1." },
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
      "Gera imagem (frame) ou vídeo no FLORA. Com reference_generation_id (imagem do hub, ex.: foto do produto anexada ou frame aprovado) usa o modelo a partir de imagem. operation=cod trava o idioma da fala no do mercado e pede sem texto na tela, sem legenda e sem música (a fala, o texto e a música entram na edição). Assíncrono: devolve gerações 'running'; acompanhe com hub_check_generations. Cobra em dólar no FLORA.",
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
        reference_generation_ids: {
          type: "array",
          items: { type: "string" },
          maxItems: 8,
          description:
            "Várias imagens de referência na MESMA geração (ex.: vários frames iniciais, produto + cenário). Só nos modelos com versão de várias imagens (flora_list_models: multi_reference=true).",
        },
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
  // Descontinuadas (2026-10-06): o usuário tirou as edições de IA do Higgsfield. Ficam só para conversas antigas
  // (API com lista de ferramentas congelada); não entram em conversas novas nem na MCP (DEPRECATED, abaixo).
  {
    name: "higgsfield_list_edits",
    description: "DESCONTINUADA: não use. As edições de IA do Higgsfield foram removidas do hub; a edição final é a hub_montage.",
    input_schema: objectSchema({}),
  },
  {
    name: "higgsfield_edit",
    description: "DESCONTINUADA: não use. As edições de IA do Higgsfield foram removidas do hub; a edição final (cortes, juntar, b-rolls, legenda) é a hub_montage.",
    input_schema: objectSchema(
      {
        tool: { type: "string" },
        source_generation_id: { type: "string" },
        prompt: { type: "string" },
        params: { type: "object", additionalProperties: { type: "string" } },
      },
      ["tool", "source_generation_id"],
    ),
  },
  {
    name: "hub_montage",
    description:
      "EDIÇÃO FINAL do criativo no padrão do Sávio (contexto do Sávio na Memória; decisão de 20/10/2026), local e sem custo: junta os vídeos do avatar na ordem, corta o silêncio acima de 0,35 s deixando 0,12 s (na fronteira das palavras), troca o plano a cada 1,1 a 4 s (enquadramento 1,00/1,13), coloca os b-rolls já criados (2 a 4 s na tela, corte seco) e queima a legenda do Sávio: estilo drop (Poppins Bold ~107 px, centro y=1060; sb = Anton ~116 px em y=1480), branca com contorno preto, 1 palavra-chave amarela por bloco, até 3 palavras/16 caracteres. LEGENDA PELO ROTEIRO: passe em roteiro o texto exato que foi falado (sem ele, o hub usa o texto da narração do hub que gerou o avatar no HeyGen); o tempo vem da fala original, antes dos cortes, nunca do vídeo montado. Áudio: voz -15 LUFS, música (opcional) -32 LUFS sob a fala com ducking de 11 dB, final -14 LUFS. Entrega: H.264, 30 fps, AAC 128k, até 30 MB; 720 de largura quando a origem é baixa (lado menor abaixo de 720 px), 1080 caso contrário (resolucao=1080 para AD vencedor refeito); formatos 9:16, 4:5 e 1:1. B-roll nos momentos certos: em broll_cues, a palavra falada em que cada b-roll entra (sem deixa, entra depois de ~10–15 s de avatar). Use hub_transcribe/hub_view_video antes para escolher as deixas. Assíncrono (1 a 3 min): acompanhe com hub_check_generations.",
    input_schema: objectSchema(
      {
        avatar_generation_id: { type: "string", description: "Vídeo pronto do avatar falando (HeyGen). Para vários, use avatar_generation_ids." },
        avatar_generation_ids: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Vários vídeos do avatar (ex.: gancho + body, várias tomadas), juntados nessa ordem antes dos cortes.",
        },
        broll_generation_ids: { type: "array", items: { type: "string" }, maxItems: 40, description: "Vídeos prontos de b-roll, na ordem em que entram." },
        lang: { type: "string", enum: ["es", "pt", "fr", "en"], description: "Idioma da fala. Padrão es." },
        name: {
          type: "string",
          description: "Nome no padrão do Sávio, que vira o nome do arquivo e do anúncio: \"AD NN - <OFERTA>-<FORMATO>-<VOZ/IDIOMA>-<VARIAÇÃO>\" (variação de gancho: \"VAR NN - <GANCHO> x <CORPO>\"). Continue a numeração da oferta (o maior AD que já existe + 1).",
        },
        roteiro: { type: "string", description: "Texto exato que foi falado (roteiro aprovado ou o texto da narração). A legenda usa este texto, alinhado à fala." },
        formato: { type: "string", enum: ["9:16", "4:5", "1:1"], description: "Padrão 9:16. Os gráficos animados só entram no 9:16." },
        resolucao: { type: "string", enum: ["auto", "720", "1080"], description: "auto (padrão): 720 para origem baixa, 1080 para origem de 720 px ou mais. 1080 = AD vencedor refeito." },
        cta: {
          type: "object",
          additionalProperties: false,
          description: "CTA sem cara de botão (Sávio): 2 setas vermelhas que entram na palavra do CTA e ficam até o fim. O botão do Meta precisa bater com o que a fala manda tocar.",
          properties: {
            palavra: { type: "string", description: "Palavra do CTA na fala, ex.: \"toca\", \"pide\", \"appuie\"." },
            inicio: { type: "number", minimum: 0, description: "Ou o segundo exato (no vídeo já editado)." },
          },
        },
        aviso: { type: "string", description: "Texto pequeno numa faixa opaca no rodapé, ex.: \"Solo con fines demostrativos. Algunas escenas están aceleradas.\" (demonstração ou cena acelerada)." },
        broll_cues: {
          type: "array",
          items: { type: "string" },
          maxItems: 40,
          description: "Deixa de cada b-roll, na mesma ordem de broll_generation_ids: palavra ou frase curta da fala (no idioma falado) em que ele entra, ex.: \"café\", \"sin pagar\". \"\" = depois de ~10–15 s de avatar.",
        },
        fx: {
          type: "object",
          additionalProperties: false,
          description:
            "Efeitos. O padrão já segue o Sávio e não precisa de fx. Macetes do lote Yara (validado): whoosh nas entradas de b-roll e punch-in (a troca de enquadramento, já ligada). Vídeo longo → barra_progresso. Não empilhe tudo num vídeo só.",
          properties: {
            estilo: { type: "string", enum: ["drop", "sb"], description: "Estilo da legenda do Sávio: drop (padrão, Poppins y=1060) ou sb (San Benito, Anton y=1480)." },
            legenda: { type: "string", enum: ["bloco", "palavra"], description: "bloco (padrão do kit): o bloco inteiro com 1 palavra-chave em amarelo. palavra: as palavras aparecem quando são ditas." },
            zoom_cortes: { type: "boolean", description: "Troca de enquadramento 1,00/1,13 a cada 1,1–4 s (padrão true). false = enquadramento fixo." },
            transicao: { type: "string", enum: ["corte", "dissolve", "zoom", "slide"], description: "Entrada do b-roll. Padrão corte (seco)." },
            whoosh: { type: "boolean", description: "Som de whoosh na entrada de cada b-roll (macete do lote Yara)." },
            music_generation_id: { type: "string", description: "Áudio do hub para música de fundo: fica a -32 LUFS sob a fala, com ducking de 11 dB. Com música, entregue também uma versão sem música (reserva)." },
            cor: { type: "string", enum: ["nenhuma", "quente", "fria", "vivo"] },
            barra_progresso: { type: "boolean" },
          },
        },
        graphics: {
          type: "array",
          maxItems: 12,
          description:
            "Gráficos animados OPCIONAIS (Remotion, só no 9:16). Use poucos e só quando servem à mensagem ou o usuário pedir: titulo (frase de impacto no topo; como manchete, só durante o gancho), destaque (oferta ou número: texto grande + sub; preço SÓ se o usuário decidiu que o vídeo fala preço), lista (benefícios em itens), contador (contagem regressiva: é risco de compliance, pergunte antes; nunca escassez inventada), cta (vira as 2 setas vermelhas do Sávio na palavra da deixa; prefira o campo cta). Textos no idioma do anúncio.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              tipo: { type: "string", enum: ["titulo", "destaque", "lista", "contador", "cta"] },
              texto: { type: "string" },
              sub: { type: "string" },
              itens: { type: "array", items: { type: "string" }, maxItems: 6 },
              deixa: { type: "string", description: "Palavra falada em que o gráfico entra (como em broll_cues)." },
              inicio: { type: "number", minimum: 0, description: "Ou o segundo exato (no vídeo já editado)." },
              duracao: { type: "number", minimum: 0.8, maximum: 15 },
              cor: { type: "string", description: "#RRGGBB" },
              posicao: {
                type: "string",
                enum: ["topo", "meio", "baixo"],
                description:
                  "Onde fica na tela. Padrão: titulo/contador topo, lista meio, destaque baixo. Nada cobre o rosto ou a boca de quem fala: confira os quadros (hub_view_video). Manchete fixa no meio = sem legenda ao mesmo tempo.",
              },
            },
            required: ["tipo"],
          },
        },
      },
      [],
    ),
  },
  {
    name: "editor_open",
    description:
      "Abre um vídeo do hub no editor de vídeo (ou retoma o projeto que já existe para ele) e, se pedido, gera as legendas automaticamente (pela fala do vídeo de origem, Whisper local) e aplica um estilo. Use quando o usuário quiser legendar, cortar ou ajustar um vídeo; depois ele pode corrigir tudo à mão no editor. Devolve o projeto com as legendas no tempo da timeline. Legenda pelo roteiro (regra do Sávio): quando houver roteiro, troque o texto das legendas pelo do roteiro em captions (na mesma ordem), até 3 palavras por bloco; para o criativo final, prefira hub_montage com roteiro.",
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
      "Transcreve um vídeo ou áudio do hub (inclusive o anexado no chat) e identifica o idioma falado. Devolve o idioma (código ISO e nome), a confiança da detecção, a duração, o texto completo e a transcrição com tempo [mm:ss] por frase. Motor (contexto do Sávio): Whisper local, grátis, um por vez; o ElevenLabs Scribe (pago) só entra se o Whisper falhar. O resultado fica em cache e qualquer agente reaproveita sem custo. Pode levar de segundos a alguns minutos. Transcreva cada take de IA antes de usar (a IA de vídeo erra palavras raras e repete frase no fim).",
    input_schema: objectSchema(
      {
        generation_id: { type: "string", description: "Vídeo ou áudio pronto do hub (ex.: o id do anexo na nota de anexos)." },
        engine: { type: "string", enum: ["auto", "elevenlabs", "local"], description: "Deixe em auto (Whisper local). elevenlabs (Scribe, pago) só se o usuário pedir." },
      },
      ["generation_id"],
    ),
  },
  {
    name: "hub_view_video",
    description:
      "Assiste a um vídeo do hub (anexado no chat, gerado ou importado do FLORA). Devolve a ficha técnica (duração, tamanho, fps), os cortes de cena, a fala transcrita com tempo [mm:ss] (Whisper local, em cache) e quadros-chave como imagens: abertura e primeiros 3s (gancho), um por corte e o resto espalhado. Se o vídeo já tiver decupagem salva (hub_save_analysis), ela vem junto: use-a e peça quadros só se faltar algo. Custo: só os tokens das imagens. Comece com poucos quadros e use start/end para olhar um trecho de perto.",
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
      "Traduz um vídeo do hub para outros idiomas no HeyGen (Video Translate: voz da pessoa clonada + lipsync), pelo MCP do HeyGen com os créditos do plano. Um idioma = uma geração 'running' (tool heygen-traducao); acompanhe com hub_check_generations. Cobra créditos premium do HeyGen por minuto e por idioma: confirme idiomas e trecho com o usuário antes (é gasto real). Se o HeyGen não estiver conectado, peça para o usuário clicar em \"Conectar HeyGen\" no estúdio de Tradução.\n" +
      "Regras do Sávio (documentos 05 e 09 da Memória): sempre o modo speed, nunca precision (no precision a boca segue o idioma original nas pausas). A tradução automática é literal (preço, marca e termos do país de origem continuam): prefira roteiro reescrito no idioma do mercado + narração nova (elevenlabs_tts) + lipsync com audio_generation_id, por trecho de até ~12 s (start_time/end_time). Com áudio próprio, o hub manda duração dinâmica desligada, mesmo formato e quadros constantes. Boca coberta (produto na frente, mão) gasta crédito e devolve a boca igual: troque só o áudio. Método novo ou caro: 1 piloto completo, aprovação, depois o lote.",
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
        mode: { type: "string", enum: ["speed"], description: "Sempre speed (o hub ignora outro valor)." },
        translate_audio_only: { type: "boolean", description: "Só dubla o áudio, sem lipsync. Padrão false." },
        input_language: { type: "string", description: "Idioma original (nome do HeyGen). Vazio = detectar." },
        speaker_num: { type: "integer", minimum: 1, maximum: 10, description: "Quantas pessoas falam. Vazio = automático." },
        enable_dynamic_duration: { type: "boolean", description: "Padrão true na tradução e false com áudio próprio (lipsync)." },
        disable_music_track: { type: "boolean", description: "Remove a música de fundo." },
        enable_speech_enhancement: { type: "boolean", description: "Melhora a voz." },
        keep_the_same_format: { type: "boolean", description: "Mantém resolução e bitrate do original. Padrão true com áudio próprio (lipsync)." },
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
  {
    name: "hub_beat_edit",
    description:
      "EDIÇÃO NA BATIDA (motion na batida): criativo curto guiado pela música, sem narração, local e sem custo. Uma cena por batida do grave depois da \"virada\" da música, tensão em câmera lenta antes dela, palavras gigantes batendo na tela (1 a 3 por vez, a de baixo na cor de destaque), zoom e tremida na batida, chicote, glitch de cor, flash, vinheta, granulado, respiro em câmera lenta e a chamada final pulsando na batida. Tudo em VÍDEO de tela cheia: passe vídeos (b-rolls) do hub como cenas; quanto mais cenas diferentes (6 a 10), melhor. Sem efeito sonoro de transição: o único som é a música.\n" +
      "Música: music_generation_id = áudio do hub (o usuário manda a faixa; música trend do mercado é liberada pela pessoa: não repita alerta de direitos, só cite no fim quais músicas usou); sem música, o hub sintetiza uma batida própria (phonk/trap) no BPM pedido.\n" +
      "Palavras: escreva uma frase só, quebrada em pedaços curtos e reais sobre o produto (ex.: PASTEL DE FEIRA / SÓ QUE EM CASA / FRITO NA HORA / PAGAS AL RECIBIR), no idioma do anúncio; para cada pedaço, clip = índice (0..) da cena que mostra aquilo. Termine com cta (ex.: CHAMA NO / WHATSAPP) e o clip do produto. Assíncrono: acompanhe com hub_check_generations.",
    input_schema: objectSchema(
      {
        clip_generation_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 16, description: "Vídeos do hub usados como cenas, na ordem dos índices (clip 0, 1, 2…)." },
        music_generation_id: { type: "string", description: "Áudio do hub. Sem ele, batida própria sintetizada." },
        music_start: { type: "number", minimum: 0, description: "Segundo da música em que o vídeo começa (pegue o trecho com a virada)." },
        duration: { type: "number", minimum: 6, maximum: 60, description: "Segundos. Padrão 15." },
        bpm: { type: "integer", minimum: 80, maximum: 180, description: "Só para a batida própria. Padrão 140." },
        words: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              top: { type: "string", description: "Linha de cima (branca), até 18 caracteres." },
              bottom: { type: "string", description: "Linha de baixo (cor de destaque), a palavra de impacto." },
              clip: { type: "integer", minimum: 0, description: "Índice da cena que combina com estas palavras." },
            },
          },
        },
        cta: {
          type: "object",
          additionalProperties: false,
          properties: { top: { type: "string" }, bottom: { type: "string" }, clip: { type: "integer", minimum: 0 } },
        },
        accent: { type: "string", description: "#RRGGBB da palavra de destaque. Padrão #FFB627 (dourado)." },
        name: { type: "string" },
      },
      ["clip_generation_ids"],
    ),
  },  {
    name: "hub_remove_captions",
    description:
      "REMOVER LEGENDA queimada de um vídeo do hub com o LaMa (inpainting): acha o texto em cada quadro e refaz o fundo no lugar; o áudio sai igual. Local e sem custo, mas lento na CPU (~0,6 s por quadro: 30 s de vídeo ≈ 10 min). Use antes de traduzir ou reaproveitar um criativo que já tem legenda, ou quando o usuário pedir. O resultado é um vídeo novo (o original fica). Assíncrono: acompanhe com hub_check_generations. Funciona melhor com legenda clara com contorno ou sombra escura; para legenda numa tarja/caixa sólida use mode=faixa.",
    input_schema: objectSchema(
      {
        generation_id: { type: "string", description: "Vídeo pronto do hub." },
        region: { type: "string", enum: ["baixo", "meio", "topo", "tudo"], description: "Onde está a legenda. Padrão baixo. Olhe os quadros (hub_view_video) se não souber." },
        mode: { type: "string", enum: ["auto", "faixa"], description: "auto (padrão): só as letras. faixa: o retângulo inteiro de cada linha (legenda em tarja)." },
        name: { type: "string" },
      },
      ["generation_id"],
    ),
  },  {
    name: "hub_transcript_read",
    description:
      "Lê uma transcrição JÁ FEITA (hub_transcribe) em partes, sem transcrever de novo e sem custo. Use quando hub_transcribe avisar que o texto é longo (VSL, aula, live). Dois modos: por trecho (start_s/end_s, em segundos) ou por busca (search: palavras como \"precio\", \"$\", \"dólares\"), que devolve só as frases que contêm alguma delas, com o tempo [mm:ss] e a frase de antes e de depois para contexto.",
    input_schema: objectSchema(
      {
        generation_id: { type: "string", description: "O mesmo vídeo/áudio já transcrito." },
        start_s: { type: "number", minimum: 0, description: "Início do trecho em segundos. Padrão 0." },
        end_s: { type: "number", minimum: 0, description: "Fim do trecho em segundos (opcional)." },
        search: { type: "array", items: { type: "string" }, description: "Palavras para achar (sem diferenciar maiúsculas e acentos). Se vier, ignora start_s/end_s." },
      },
      ["generation_id"],
    ),
  },
  // ---- Memória (features/memoria) ----
  // Só leitura. Ficam no fim da lista: a ordem das definições faz parte do prefixo cacheado.
  {
    name: "memoria_buscar",
    description:
      "Procura na Memória da operação (regras, fluxos, dados do negócio, projetos e lotes, lições, decisões e playbooks; o antigo contexto do Sávio). Devolve os documentos mais relevantes com um trecho em volta do termo. Use antes de responder sobre um fluxo, um lote ou projeto, um dado do negócio ou uma lição, e depois leia o documento certo com memoria_ler. Sem consulta, lista o índice (com tipo e frente, se vierem).",
    input_schema: objectSchema({
      consulta: { type: "string", description: "Palavras do assunto, com ou sem acento (ex.: tradução espanhol, lipsync heygen, Yara Chile)." },
      tipo: { type: "string", enum: [...TIPOS], description: "Filtrar por tipo de documento." },
      frente: { type: "string", enum: [...FRENTES], description: "Filtrar por frente: cod, info (infoproduto), x1 ou geral." },
    }),
  },
  {
    name: "memoria_ler",
    description:
      "Lê um documento inteiro da Memória da operação pelo slug (o nome que aparece na lista do prompt ou na memoria_buscar). Sem versão, lê a mais recente.",
    input_schema: objectSchema(
      {
        slug: { type: "string", description: "Ex.: 05-traducao-de-criativos, projeto-yara-bf-chile." },
        versao: { type: "integer", minimum: 1, description: "Versão antiga específica (opcional)." },
      },
      ["slug"],
    ),
  },
  // ---- Avatar novo no HeyGen (lib/server/heygen-avatars.ts, o mesmo do botão "Criar avatar" do estúdio) ----
  {
    name: "heygen_create_avatar",
    description:
      "Cria um avatar NOVO no HeyGen, como o botão \"Criar avatar\" do estúdio. Três modos: photo (foto da pessoa: photo_generation_id), prompt (avatar inventado a partir de uma descrição: idade, aparência, roupa, cenário; até 3 imagens de referência) e twin (gêmeo digital a partir de um vídeo da pessoa falando para a câmera: video_generation_id; a pessoa filmada precisa abrir o link de consentimento que volta). Fotos e vídeos vêm do hub: anexos do usuário no chat (tool=upload) ou gerações. O treino leva alguns minutos: acompanhe com action=status; pronto, o avatar aparece em heygen_list_avatars (private) e serve no heygen_create_video. Usa créditos do plano do HeyGen: confirme com o usuário antes de criar.",
    input_schema: objectSchema({
      action: { type: "string", enum: ["create", "status"], description: "create (padrão) cria; status lista as criações e em que pé está o treino." },
      mode: { type: "string", enum: ["photo", "prompt", "twin"], description: "Padrão photo." },
      name: { type: "string", description: "Nome do avatar (obrigatório para criar)." },
      photo_generation_id: { type: "string", description: "Modo photo: imagem da pessoa (rosto visível, boa luz)." },
      prompt: { type: "string", description: "Modo prompt: descrição da pessoa." },
      reference_generation_ids: { type: "array", items: { type: "string" }, maxItems: 3, description: "Modo prompt: até 3 imagens de referência." },
      aspect_ratio: { type: "string", enum: ["9:16", "1:1", "4:5", "16:9", "5:4", "auto"], description: "Modo prompt. Padrão 9:16." },
      video_generation_id: { type: "string", description: "Modo twin: vídeo da pessoa falando para a câmera." },
    }),
  },
  // ---- Mudar regras pela conversa (features/memoria, chave "memoria_editar", como a tela da Memória) ----
  {
    name: "memoria_salvar",
    description:
      "Grava na Memória da operação o que o hub aprendeu: regra que o usuário mandou mudar, criar ou tirar, e lições das correções dele. licao = o jeito de aprender sozinho: registre, sem perguntar, toda correção, reclamação, preferência ou acerto confirmado do usuário (o que aconteceu + a regra que fica), na tabela de lições (22-licoes-producao-video) e, com relacionado, também no documento do tema; fica marcada para alguém revisar na tela da Memória. acrescentar = seção nova datada no fim de um documento (para regra que o usuário mandou; não apaga nada); reescrever = troca o texto inteiro de um documento (leia antes com memoria_ler e mande o texto completo); criar = documento novo. Cada gravação vira versão nova (dá para voltar na tela da Memória). no_prompt=true põe o documento no prompt de todos os agentes (só admin ou dono). Vale para as conversas novas; nesta conversa, siga a regra nova desde já.",
    input_schema: objectSchema(
      {
        acao: { type: "string", enum: ["licao", "acrescentar", "reescrever", "criar"], description: "Padrão acrescentar." },
        slug: { type: "string", description: "Documento (ex.: decisoes-pendentes, 22-licoes-producao-video). Para criar: slug novo, minúsculas e hífens. Na lição: não precisa (use relacionado)." },
        titulo: { type: "string", description: "acrescentar: título da seção. criar: título do documento. licao: título curto da lição." },
        conteudo: { type: "string", description: "Texto em markdown (a regra com as palavras do usuário). Na lição: a regra que fica." },
        o_que_aconteceu: { type: "string", description: "Só na lição: o que deu errado ou o que o usuário corrigiu/aprovou, com o produto ou lote." },
        relacionado: { type: "string", description: "Só na lição: slug do documento do tema, que também recebe a lição (opcional)." },
        tipo: { type: "string", enum: [...TIPOS], description: "Só para criar. Regras: regra." },
        frente: { type: "string", enum: [...FRENTES], description: "Só para criar. Padrão geral." },
        no_prompt: { type: "boolean", description: "Só para criar: entra no prompt de todos os agentes. Só admin ou dono." },
        nota: { type: "string", description: "O que mudou, em uma linha (fica no histórico)." },
      },
      ["conteudo"],
    ),
  },
  // ---- Qualquer função dos serviços (MCPs oficiais do HeyGen, FLORA e ElevenLabs), além das ferramentas prontas ----
  {
    name: "servico_ferramentas",
    description:
      "Lista TODAS as funções que o HeyGen, o FLORA ou o ElevenLabs oferecem pela conta conectada no hub (não só as das ferramentas prontas do hub). Sem nome: nome e resumo de cada função (filtre com busca). Com nome: a descrição completa e os parâmetros dessa função. Use quando o usuário pedir algo que as ferramentas prontas não fazem (ex.: clonar voz, template, brand kit, tradução em lote, foto avatar com looks, efeitos sonoros) e depois chame com servico_chamar.",
    input_schema: objectSchema(
      {
        servico: { type: "string", enum: ["heygen", "flora", "elevenlabs"] },
        busca: { type: "string", description: "Palavras do nome ou da descrição (ex.: voice, template, translate)." },
        nome: { type: "string", description: "Nome exato de uma função: devolve os parâmetros dela." },
      },
      ["servico"],
    ),
  },
  {
    name: "servico_chamar",
    description:
      "Chama qualquer função do HeyGen, do FLORA ou do ElevenLabs pela conta conectada no hub, com os parâmetros que servico_ferramentas mostrou. Devolve o resultado como o serviço respondeu. Funções que geram ou gastam créditos: diga ao usuário o que vai fazer e o custo (se o serviço informar) e espere o ok antes. Funções que apagam algo na conta: só com o pedido explícito do usuário. Arquivo pronto (link de vídeo, imagem ou áudio): traga para a Biblioteca com servico_importar_arquivo.",
    input_schema: objectSchema(
      {
        servico: { type: "string", enum: ["heygen", "flora", "elevenlabs"] },
        funcao: { type: "string", description: "Nome exato da função (de servico_ferramentas)." },
        argumentos: { type: "object", description: "Parâmetros da função, no formato que ela pede." },
      },
      ["servico", "funcao"],
    ),
  },
  {
    name: "servico_importar_arquivo",
    description:
      "Traz para a Biblioteca do hub um arquivo que o HeyGen, o FLORA ou o ElevenLabs gerou (link https devolvido por servico_chamar). Vídeo vai para o Google Drive, como todo vídeo do hub. Devolve a geração com id, para usar nas outras ferramentas (edição, lipsync etc.).",
    input_schema: objectSchema(
      {
        servico: { type: "string", enum: ["heygen", "flora", "elevenlabs"] },
        url: { type: "string" },
        tipo: { type: "string", enum: ["video", "image", "audio"] },
        descricao: { type: "string", description: "O que é o arquivo (vira o texto da geração)." },
      },
      ["servico", "url", "tipo"],
    ),
  },
];

// A resposta de uma ferramenta tem limite: transcrições longas vão em páginas de até ~20 mil caracteres.
const TRANSCRIPT_PAGE = 20_000;
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function transcriptPage(t: Transcript, startS: number, endS = Infinity) {
  const out: string[] = [];
  let size = 0;
  let next: number | null = null;
  for (const s of t.segments.filter((x) => x.end > startS && x.start < endS)) {
    const line = `[${mmss(s.start)}] ${s.text}`;
    if (size + line.length > TRANSCRIPT_PAGE && out.length) {
      next = Math.floor(s.start);
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return {
    com_tempo: out.join("\n") || "(nenhuma fala nesse trecho)",
    ...(next !== null
      ? { continua: `Texto longo: isto vai até ${mmss(next)}. Leia o resto com hub_transcript_read (start_s=${next}) ou ache trechos com hub_transcript_read (search=[...]).` }
      : {}),
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const handlers: Record<string, (input: Input, ctx: Ctx) => Promise<ToolOutcome>> = {
  async hub_list_generations(input) {
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
    const all = await listGenerations(GEN_TOOLS.includes(str(input.tool)) ? (str(input.tool) as Generation["tool"]) : undefined);
    const filtered = all.filter((g) => (!input.kind || g.kind === input.kind) && (!input.status || g.status === input.status));
    const notes = new Map(await Promise.all(filtered.map(async (g) => [g.id, (await getAnalysis(g.id)).notes ?? ""] as const)));
    const words = str(input.search).toLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.length
      ? filtered.filter((g) => {
          const hay = `${g.name ?? ""} ${g.prompt} ${JSON.stringify(g.params)} ${notes.get(g.id)}`.toLowerCase();
          return words.some((w) => hay.includes(w));
        })
      : filtered;
    const items = matches.slice(0, limit).map((g) => ({ ...brief(g), ...(notes.get(g.id) ? { decupagem: cut(notes.get(g.id)!, 300) } : {}) }));
    return { content: json({ total: matches.length, items }), summary: `${items.length} gerações` };
  },

  async hub_check_generations(input, { signal, viaMcp }) {
    const ids = (Array.isArray(input.ids) ? input.ids : []).map(str).slice(0, 20);
    // Pela MCP, no máximo 50s por chamada (acima disso o Claude Code dá "The operation timed out"); o agente chama de novo.
    const deadline = Date.now() + Math.min(viaMcp ? 50 : 240, Math.max(0, Number(input.wait_seconds) || 0)) * 1000;
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
    const still = gens.some((g) => g.status === "pending" || g.status === "running");
    return {
      content: json({
        items: gens.map(brief),
        ...(missing.length ? { not_found: missing } : {}),
        ...(still && Number(input.wait_seconds) > 0 ? { note: "Ainda gerando. Se o próximo passo depende disso, chame hub_check_generations de novo com wait_seconds." } : {}),
      }),
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
    if (input.preview === false) {
      const items = looks.map(({ id, name, type, orientation }) => ({ id, name, type, orientation }));
      return { content: json({ ownership, items }), summary: `${looks.length} avatares` };
    }
    // Folha de contato com as fotos (16 por página), para escolher pela aparência.
    const pages = Math.max(1, Math.ceil(looks.length / 16));
    const page = num(input.page, 1, pages, 1);
    const slice = looks.slice((page - 1) * 16, page * 16);
    const thumbs = await Promise.all(slice.map((l) => (l.image ? lookThumb(l.image).catch(() => null) : null)));
    const tiles = slice.flatMap((l, i) => (thumbs[i] ? [{ file: thumbs[i], label: `#${i + 1} ${l.name}`.slice(0, 28) }] : []));
    const items = slice.map(({ id, name, type, orientation }, i) => ({ n: i + 1, id, name, type, orientation, ...(thumbs[i] ? {} : { sem_foto: true }) }));
    const content: ToolResultContent[] = [{ type: "text", text: json({ ownership, total: looks.length, page, pages, items }) }];
    if (tiles.length) content.push(imageRef(await contactSheet(tiles)));
    return { content, summary: `${looks.length} avatares${pages > 1 ? ` (página ${page}/${pages})` : ""}` };
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
      multi_reference: Boolean(f.fromImages),
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
      referenceIds: (Array.isArray(input.reference_generation_ids) ? input.reference_generation_ids : []).map(str),
      label: str(input.label) || undefined,
    });
    return {
      content: json({ flora_project: chat?.floraProject?.name, items: gens.map(brief) }),
      summary: `${gens.length} na fila`,
      generations: gens,
    };
  },

  async higgsfield_list_edits() {
    throw new InputError("As edições de IA do Higgsfield foram removidas do hub. Para a edição final (cortes, juntar vídeos, b-rolls, legenda), use hub_montage.");
  },

  async higgsfield_edit() {
    throw new InputError("As edições de IA do Higgsfield foram removidas do hub. Para a edição final (cortes, juntar vídeos, b-rolls, legenda), use hub_montage.");
  },

  async hub_montage(input) {
    const g = await runMontage({
      avatarId: str(input.avatar_generation_id),
      avatarIds: (Array.isArray(input.avatar_generation_ids) ? input.avatar_generation_ids : []).map(str),
      brollIds: (Array.isArray(input.broll_generation_ids) ? input.broll_generation_ids : []).map(str),
      brollCues: (Array.isArray(input.broll_cues) ? input.broll_cues : []).map(str),
      fx: (() => {
        const f = (input.fx && typeof input.fx === "object" ? input.fx : {}) as Input;
        return { ...f, musicId: f.music_generation_id ? str(f.music_generation_id) : undefined } as MontageFx;
      })(),
      graphics: Array.isArray(input.graphics) ? (input.graphics as GraphicRequest[]) : [],
      lang: str(input.lang),
      name: str(input.name),
      roteiro: str(input.roteiro) || undefined,
      formato: (str(input.formato) || undefined) as MontageRequest["formato"],
      resolucao: (str(input.resolucao) || undefined) as MontageRequest["resolucao"],
      cta: (() => {
        const o = (input.cta && typeof input.cta === "object" ? input.cta : null) as Input | null;
        if (!o) return undefined;
        const inicio = Number(o.inicio);
        return { palavra: str(o.palavra) || undefined, inicio: o.inicio !== undefined && Number.isFinite(inicio) ? inicio : undefined };
      })(),
      aviso: str(input.aviso) || undefined,
    });
    return { content: json(brief(g)), summary: "montagem iniciada", generations: [g] };
  },

  async hub_beat_edit(input) {
    const obj = (v: unknown) => (v && typeof v === "object" ? (v as Input) : {});
    const g = await runBeatEdit({
      clipIds: (Array.isArray(input.clip_generation_ids) ? input.clip_generation_ids : []).map(str),
      songId: input.music_generation_id ? str(input.music_generation_id) : undefined,
      songStart: Number(input.music_start) || 0,
      duration: Number(input.duration) || undefined,
      bpm: Number(input.bpm) || undefined,
      words: (Array.isArray(input.words) ? input.words : []).map((w) => {
        const o = obj(w);
        return { top: str(o.top), bottom: str(o.bottom), clip: Number.isInteger(o.clip) ? (o.clip as number) : undefined };
      }),
      cta: (() => {
        const o = obj(input.cta);
        return { top: str(o.top), bottom: str(o.bottom), clip: Number.isInteger(o.clip) ? (o.clip as number) : undefined };
      })(),
      accent: str(input.accent) || undefined,
      name: str(input.name),
    });
    return { content: json(brief(g)), summary: "edição na batida iniciada", generations: [g] };
  },

  async hub_remove_captions(input) {
    const region = str(input.region);
    const g = await runRemoveCaptions({
      videoId: str(input.generation_id),
      region: (["baixo", "meio", "topo", "tudo"].includes(region) ? region : "baixo") as "baixo",
      mode: input.mode === "faixa" ? "faixa" : "auto",
      name: str(input.name),
    });
    return { content: json(brief(g)), summary: "removendo a legenda", generations: [g] };
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
    const { transcript: t, noSpeech, cached, pending } = await transcriptOf(str(input.generation_id), engine, 240_000);
    if (pending)
      return {
        content: json({
          status: "transcrevendo",
          aviso: "Áudio longo: a transcrição continua rodando no hub e fica salva. Chame hub_transcribe de novo com o mesmo generation_id daqui a 1 a 2 minutos (não abre outra transcrição, só espera a mesma).",
        }),
        summary: "ainda transcrevendo",
      };
    if (!t) return { content: json({ fala: noSpeech ?? "sem fala" }), summary: "sem fala" };
    return {
      content: json({
        idioma: t.languageName,
        codigo: t.languageCode,
        confianca: t.confidence === null ? null : Number(t.confidence.toFixed(2)),
        duracao_s: t.duration === null ? null : Math.round(t.duration),
        motor: t.engine === "elevenlabs" ? "ElevenLabs Scribe" : "Whisper local",
        cache: cached,
        ...transcriptPage(t, 0),
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
          const { transcript: t, noSpeech, cached, pending } = await transcriptOf(g.id, "auto", 150_000);
          fala = pending
            ? "transcrição em andamento (áudio longo); chame hub_transcribe com este generation_id daqui a 1 a 2 minutos"
            : t
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
      const p =
        projects.find((x) => x.id === id) ??
        (name ? projects.find((x) => x.name.toLowerCase() === name) : undefined) ??
        (id ? await getProject(id) : null); // projeto de outro workspace da conta
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
      const p = (await listProjects()).find((x) => x.id === id) ?? (await getProject(id));
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
      mode: "speed", // nunca precision (contexto do Sávio)
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

  async hub_transcript_read(input) {
    const { transcript: t } = await transcriptOf(str(input.generation_id), "auto", 1);
    if (!t) throw new InputError("Esse arquivo ainda não foi transcrito (ou ainda está transcrevendo). Use hub_transcribe primeiro.");
    const terms = (Array.isArray(input.search) ? input.search : []).map((x) => fold(String(x)).trim()).filter(Boolean);
    if (terms.length) {
      const segs = t.segments;
      const hits = segs.flatMap((s, i) => (terms.some((w) => fold(s.text).includes(w)) ? [i] : []));
      const trechos = hits.map((i) => ({
        tempo: mmss(segs[i].start),
        segundos: Math.floor(segs[i].start),
        frase: segs[i].text,
        contexto: [segs[i - 1]?.text, segs[i].text, segs[i + 1]?.text].filter(Boolean).join(" "),
      }));
      return {
        content: json({ encontrados: trechos.length, trechos: trechos.slice(0, 80), ...(trechos.length > 80 ? { aviso: "Mais de 80 trechos: refine a busca." } : {}) }),
        summary: `${trechos.length} trechos`,
      };
    }
    const start = num(input.start_s, 0, 1e6, 0);
    const end = typeof input.end_s === "number" && input.end_s > start ? input.end_s : Infinity;
    return { content: json(transcriptPage(t, start, end)), summary: `a partir de ${mmss(start)}` };
  },

  // ---- Memória (features/memoria) ----
  async memoria_buscar(input) {
    if (!process.env.DATABASE_URL?.trim()) return MEMORIA_FORA;
    const filtro = {
      ...(TIPOS.includes(str(input.tipo) as TipoDoc) ? { tipo: str(input.tipo) as TipoDoc } : {}),
      ...(FRENTES.includes(str(input.frente) as Frente) ? { frente: str(input.frente) as Frente } : {}),
    };
    const consulta = str(input.consulta).trim();
    const docs: (DocResumo & { trecho?: string })[] = consulta ? await buscarNaMemoria(consulta, filtro) : await indiceDaMemoria(filtro);
    const itens = docs.map((d) => ({
      slug: d.slug,
      titulo: d.titulo,
      tipo: TIPO_ROTULO[d.tipo],
      frente: FRENTE_ROTULO[d.frente],
      ...(d.mercado ? { mercado: d.mercado } : {}),
      versao: d.versao,
      ...(d.precisaRevisao ? { precisa_revisao: true } : {}),
      ...(d.trecho ? { trecho: d.trecho } : {}),
    }));
    if (!itens.length)
      return { content: consulta ? `Nada na Memória para "${consulta}". Tente outras palavras ou sem filtro.` : "Nenhum documento na Memória com esse filtro.", summary: "0 documentos" };
    return { content: json({ total: itens.length, documentos: itens }), summary: `${itens.length} ${itens.length === 1 ? "documento" : "documentos"}` };
  },

  async memoria_ler(input) {
    if (!process.env.DATABASE_URL?.trim()) return MEMORIA_FORA;
    // Aceita também o nome de arquivo dos links dos textos antigos ("projetos/dewalt-ads-cl.md").
    const slug = (await resolverSlug(str(input.slug))) ?? str(input.slug).trim();
    const versao = input.versao === undefined || input.versao === null || input.versao === "" ? undefined : Number(input.versao);
    const d = await lerDaMemoria(slug, versao);
    if (!d) {
      if (versao !== undefined && (await lerDaMemoria(slug))) throw new InputError(`O documento "${slug}" não tem a versão ${versao}.`);
      throw new DocNaoEncontrado(slug);
    }
    // Teto para caber na resposta da ferramenta; os documentos da Memória ficam bem abaixo disso.
    const TETO = 40_000;
    const cortado = d.conteudo.length > TETO;
    const cabecalho = [
      `${d.titulo} (${d.slug}) · ${TIPO_ROTULO[d.tipo]} · ${FRENTE_ROTULO[d.frente]}${d.mercado ? ` · ${d.mercado}` : ""}`,
      `Versão ${d.versao}, de ${d.autor}, em ${d.atualizadoEm.slice(0, 10)}.`,
      ...(d.precisaRevisao ? [`Precisa de revisão${typeof d.metadados.motivoRevisao === "string" ? `: ${d.metadados.motivoRevisao}` : "."}`] : []),
    ].join("\n");
    const aviso = cortado ? `\n\n[Cortado: o documento tem ${d.conteudo.length.toLocaleString("pt-BR")} caracteres e só os primeiros ${TETO.toLocaleString("pt-BR")} vieram. Use memoria_buscar com palavras do trecho que falta.]` : "";
    return { content: `${cabecalho}\n\n${d.conteudo.slice(0, TETO)}${aviso}`, summary: `leu ${cut(d.slug, 40)}` };
  },

  async heygen_create_avatar(input) {
    if (str(input.action) === "status") {
      const list = (await listCreations()).slice(0, 20);
      return { content: json({ total: list.length, items: list }), summary: `${list.length} ${list.length === 1 ? "avatar criado" : "avatares criados"}` };
    }
    const mode = (["photo", "prompt", "twin"].includes(str(input.mode)) ? str(input.mode) : "photo") as AvatarMode;
    const refs = (Array.isArray(input.reference_generation_ids) ? input.reference_generation_ids : []).map(str).filter(Boolean);
    if (refs.length > 3) throw new InputError("No máximo 3 imagens de referência.");
    const creation = await createAvatar({
      mode,
      name: str(input.name),
      photo: mode === "photo" && input.photo_generation_id ? await arquivoDaGeracao(str(input.photo_generation_id), "image") : null,
      video: mode === "twin" && input.video_generation_id ? await arquivoDaGeracao(str(input.video_generation_id), "video") : null,
      prompt: str(input.prompt),
      references: mode === "prompt" ? await Promise.all(refs.map((id) => arquivoDaGeracao(id, "image"))) : [],
      aspectRatio: str(input.aspect_ratio) || "9:16",
    });
    const proximo = creation.consentUrl
      ? `A pessoa filmada precisa abrir este link de consentimento (vale 24 h): ${creation.consentUrl}. Depois o treino começa; acompanhe com action=status.`
      : "Treinando no HeyGen; acompanhe com action=status. Pronto, ele aparece em heygen_list_avatars (private).";
    return { content: json({ ...creation, proximo }), summary: `avatar "${cut(creation.name, 30)}" criado` };
  },

  async servico_ferramentas(input) {
    const servico = servicoLivre(input.servico);
    const todas = await mcp(servico).listTools();
    const nome = str(input.nome).trim();
    if (nome) {
      const t = todas.find((x) => x.name === nome);
      if (!t) throw new InputError(`O ${servico} não tem a função "${nome}". Liste sem nome para ver as que existem.`);
      return { content: json({ nome: t.name, descricao: t.description ?? "", parametros: t.inputSchema ?? {} }), summary: `${servico}: ${cut(t.name, 40)}` };
    }
    const q = str(input.busca).toLowerCase().split(/\s+/).filter(Boolean);
    const achadas = todas.filter((t) => q.every((p) => `${t.name} ${t.description ?? ""}`.toLowerCase().includes(p)));
    const itens = achadas.map((t) => ({ nome: t.name, resumo: cut((t.description ?? "").replace(/\s+/g, " "), 160) }));
    return { content: json({ servico, total: todas.length, mostradas: itens.length, funcoes: itens }), summary: `${servico}: ${itens.length} funções` };
  },

  async servico_chamar(input) {
    const servico = servicoLivre(input.servico);
    const funcao = str(input.funcao).trim();
    if (!funcao) throw new InputError("Diga a função (nome de servico_ferramentas).");
    const args = (input.argumentos && typeof input.argumentos === "object" && !Array.isArray(input.argumentos) ? input.argumentos : {}) as Record<string, unknown>;
    const r = await mcp(servico).callToolRaw(funcao, args);
    const partes: ToolResultContent[] = [];
    const textos = (r.content ?? []).map((c) => c.text ?? c.resource?.text ?? c.resource?.uri ?? "").filter(Boolean).join("\n").trim();
    const dados = r.structuredContent ? json(r.structuredContent) : "";
    const corpo = [textos, dados && dados !== textos ? dados : ""].filter(Boolean).join("\n\n") || "(sem resposta em texto)";
    partes.push({ type: "text", text: `${r.isError ? "O serviço respondeu com erro:\n" : ""}${cut(corpo, 20_000)}` });
    // Imagens que o serviço devolveu (ex.: prévia): entram como imagem para o agente ver.
    for (const c of (r.content ?? []).filter((x) => x.type === "image" && x.data).slice(0, 4)) {
      const ext = (c.mimeType ?? "image/png").split("/")[1]?.replace("jpeg", "jpg") || "png";
      partes.push(imageRef(await saveMedia(Buffer.from(c.data!, "base64"), ext)));
    }
    if (r.isError) return { content: partes, summary: `${servico}: ${cut(funcao, 30)} deu erro` };
    return { content: partes, summary: `${servico}: ${cut(funcao, 40)}` };
  },

  async servico_importar_arquivo(input) {
    const servico = servicoLivre(input.servico);
    const tipo = (["video", "image", "audio"].includes(str(input.tipo)) ? str(input.tipo) : "") as "video" | "image" | "audio";
    if (!tipo) throw new InputError("Diga o tipo: video, image ou audio.");
    const url = str(input.url).trim();
    if (!/^https:\/\//i.test(url)) throw new InputError("O link precisa começar com https://.");
    // Vídeo só com o Drive conectado (regra do dono): confere antes de baixar.
    if (tipo === "video") await exigirDriveParaVideo();
    const res = await mcp(servico).download(url);
    if (!res.ok) throw new InputError(`Não consegui baixar o arquivo (${res.status}). O link pode ter vencido: peça o link de novo ao serviço.`);
    const file = await saveMedia(Buffer.from(await res.arrayBuffer()), EXTENSAO[tipo]);
    const generation = await createGeneration({
      tool: servico,
      kind: tipo,
      status: "done",
      prompt: str(input.descricao).trim().slice(0, 500) || `Importado do ${servico}`,
      file,
      remoteUrl: url,
      params: { imported: true, viaChat: true, ...(tipo === "video" ? { prazoNoHub: prazoNoHub() } : {}) },
    });
    if (tipo === "video") guardarNoDriveEmSegundoPlano(generation);
    return { content: json(brief(generation)), summary: `${tipo === "video" ? "vídeo" : tipo === "image" ? "imagem" : "áudio"} na Biblioteca`, generations: [generation] };
  },

  async memoria_salvar(input, { usuario }) {
    if (!process.env.DATABASE_URL?.trim()) return MEMORIA_FORA;
    if (!usuario) throw new InputError("Só uma pessoa logada grava na Memória.");
    const autor = { id: usuario.id, nome: usuario.nome };
    const acao = ["licao", "reescrever", "criar"].includes(str(input.acao)) ? str(input.acao) : "acrescentar";
    const conteudo = str(input.conteudo).trim();
    const nota = str(input.nota).trim().slice(0, 200) || undefined;
    if (acao === "licao") {
      const relacionado = str(input.relacionado).trim() ? ((await resolverSlug(str(input.relacionado))) ?? str(input.relacionado).trim()) : undefined;
      const licoes = await registrarLicao(
        { titulo: str(input.titulo), data: new Date().toISOString().slice(0, 10), oQueAconteceu: str(input.o_que_aconteceu), regra: conteudo, relacionado },
        autor,
      );
      // Aprendida sozinha pelo chat: entra na fila "precisa de revisão" da Memória para uma pessoa conferir.
      await salvarNaMemoria({ slug: licoes.slug, conteudo: licoes.conteudo, versaoEsperada: licoes.versao, precisaRevisao: true }, autor).catch(() => undefined);
      return { content: `Lição guardada em ${licoes.slug}${relacionado ? ` e em ${relacionado}` : ""}. Vale nas conversas novas; nesta, siga desde já.`, summary: `lição: ${cut(str(input.titulo), 40)}` };
    }
    if (!str(input.slug).trim()) throw new InputError("Diga o documento (slug).");
    if (acao === "criar") {
      if (input.no_prompt !== undefined && !ehAdmin(usuario)) throw new InputError("Só admin ou dono decide o que entra no prompt dos agentes. Crie sem no_prompt.");
      const d = await salvarNaMemoria(
        {
          slug: str(input.slug).trim(),
          conteudo,
          versaoEsperada: null,
          titulo: str(input.titulo).trim() || undefined,
          tipo: (str(input.tipo) || "regra") as TipoDoc,
          frente: (str(input.frente) || "geral") as Frente,
          ...(input.no_prompt !== undefined ? { noPrompt: input.no_prompt === true } : {}),
          nota: nota ?? "criado pelo chat",
        },
        autor,
      );
      return { content: `Documento ${d.slug} criado (versão ${d.versao}${d.noPrompt ? ", no prompt de todos os agentes" : ""}).`, summary: `criou ${cut(d.slug, 40)}` };
    }
    const slug = (await resolverSlug(str(input.slug))) ?? str(input.slug).trim();
    if (acao === "reescrever") {
      const atual = await lerDaMemoria(slug);
      if (!atual) throw new DocNaoEncontrado(slug);
      const d = await salvarNaMemoria({ slug, conteudo, versaoEsperada: atual.versao, nota: nota ?? "reescrito pelo chat" }, autor);
      return { content: `Documento ${d.slug} reescrito (versão ${d.versao}).`, summary: `reescreveu ${cut(d.slug, 40)}` };
    }
    const d = await acrescentarSecao(slug, { titulo: str(input.titulo) || "Regra nova", conteudo }, autor, nota);
    return { content: `Seção acrescentada em ${d.slug} (versão ${d.versao}).`, summary: `gravou em ${cut(d.slug, 40)}` };
  },
};

const SERVICOS_LIVRES = ["heygen", "flora", "elevenlabs"] as const;
const servicoLivre = (v: unknown) => {
  const s = str(v) as (typeof SERVICOS_LIVRES)[number];
  if (!SERVICOS_LIVRES.includes(s)) throw new InputError(`Serviço inválido: use ${SERVICOS_LIVRES.join(", ")}.`);
  return s;
};
const EXTENSAO: Record<"video" | "image" | "audio", string> = { video: "mp4", image: "png", audio: "mp3" };

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4",
};

// Arquivo de uma geração do hub (anexo do chat ou gerado) no formato que createAvatar recebe da tela.
async function arquivoDaGeracao(id: string, kind: "image" | "video"): Promise<File> {
  const g = await getGeneration(id);
  if (!g) throw new InputError(`Geração ${id} não encontrada.`);
  if (g.kind !== kind || g.status !== "done" || !g.file) throw new InputError(`A geração ${id} não é ${kind === "image" ? "uma imagem" : "um vídeo"} pronto.`);
  const ext = path.extname(g.file).slice(1).toLowerCase();
  const buffer = await readFile(await arquivoLocal(g.file));
  return new File([buffer], path.basename(g.file), { type: MIME[ext] ?? (kind === "image" ? "image/jpeg" : "video/mp4") });
}

export const CLIENT_TOOLS = definitions;
// Descontinuadas: só aparecem para conversas antigas que já as tinham (lista congelada, modo API).
const DEPRECATED = new Set(["higgsfield_list_edits", "higgsfield_edit"]);
const CURRENT = definitions.filter((d) => !DEPRECATED.has(d.name));

export const TOOL_NAMES = CURRENT.map((d) => d.name);

// Cada conversa usa a lista de ferramentas de quando foi criada: mudar as ferramentas no meio
// de uma conversa muda o prefixo (cache) e invalida os blocos de raciocínio já salvos.
export const toolsFor = (names?: string[]) => (names ? definitions.filter((d) => names.includes(d.name)) : CURRENT);

// ---- Quem pode usar cada ferramenta (features/acesso) ----
// Ter a chave do chat não libera o hub inteiro: a ferramenta que lê a Memória, gasta crédito ou mexe em outra tela
// exige a chave daquela tela, como as rotas da interface (app/api/**). Sem o mapa, uma conta só com "chat" lia os dados
// do negócio e gerava no FLORA, HeyGen e ElevenLabs pelo agente.
// Fora do mapa basta o chat: ler o histórico do hub, listar vozes, avatares e modelos, orçar e o que roda local sem
// crédito. hub_remove_captions fica livre de propósito: roda local (LaMa) e o botão do card já aceita quem tem "chat"
// (app/api/montagem/sem-legenda).
// quando: a chave vale só para algumas chamadas (ex.: criar projeto no FLORA). A ferramenta continua na lista da
// conversa e só a chamada que gasta é barrada. dica: o que o agente pode fazer no lugar.
type RegraDeAcesso = { chave: Chave; quando?: (input: Input) => boolean; dica?: string };

const CHAVE_DA_FERRAMENTA: Record<string, RegraDeAcesso> = {
  // Memória: dados do negócio.
  memoria_buscar: { chave: "memoria" },
  memoria_ler: { chave: "memoria" },
  memoria_salvar: { chave: "memoria_editar" },
  // Qualquer função dos serviços: listar é livre; chamar pode gastar crédito, e importar traz arquivo (como os estúdios).
  servico_chamar: { chave: "estudios" },
  servico_importar_arquivo: { chave: "estudios" },
  // Estúdios: gera ou gasta crédito (FLORA, HeyGen, ElevenLabs; a transcrição usa o Scribe só de reserva do Whisper).
  elevenlabs_tts: { chave: "estudios" },
  heygen_create_video: { chave: "estudios" },
  heygen_translate_video: { chave: "estudios" },
  heygen_create_avatar: { chave: "estudios", quando: (input) => str(input.action) !== "status" },
  flora_generate: { chave: "estudios" },
  higgsfield_edit: { chave: "estudios" },
  // As duas edições seguem a tela (app/api/montagem pede "estudios"); a edição final pode cair no Scribe de reserva.
  hub_montage: { chave: "estudios" },
  hub_beat_edit: { chave: "estudios" },
  hub_transcribe: { chave: "estudios" },
  // Promete só ler, mas sem transcrição pronta transcriptOf começa uma (Whisper, ou o Scribe de reserva).
  hub_transcript_read: { chave: "estudios" },
  flora_projects: { chave: "estudios", quando: (input) => str(input.action) === "create" },
  hub_view_video: {
    chave: "estudios",
    quando: (input) => input.transcribe !== false,
    dica: "Sem a fala, dá para assistir: chame hub_view_video de novo com transcribe=false.",
  },
  // Fluxo (quadro Kanban).
  pipeline_get: { chave: "fluxo" },
  pipeline_save_card: { chave: "fluxo" },
  // Editor. Como na tela do editor (app/api/editor), a legenda automática vem junto com a chave "editor".
  editor_open: { chave: "editor" },
  editor_render: { chave: "editor" },
  editor_join: { chave: "editor" },
};

// Chave que falta para esta chamada, ou null se a pessoa pode fazê-la.
function chaveQueFalta(name: string, input: Input, usuario: Usuario): RegraDeAcesso | null {
  const regra = CHAVE_DA_FERRAMENTA[name];
  if (!regra || podeUsar(usuario, regra.chave)) return null;
  return !regra.quando || regra.quando(input) ? regra : null;
}

// Ferramentas que a pessoa recebe numa lista (conversa nova e Modo Black), na mesma ordem das definições.
// Some só a ferramenta que exige sempre uma chave que ela não tem; a que exige em parte das chamadas fica.
export const ferramentasDaPessoa = (usuario: Usuario, names: string[] = TOOL_NAMES) =>
  names.filter((name) => {
    const regra = CHAVE_DA_FERRAMENTA[name];
    return !regra || Boolean(regra.quando) || podeUsar(usuario, regra.chave);
  });

// Ferramentas que rodam nos servidores da Anthropic (pesquisa e leitura de páginas, ex.: página de vendas).
export const SERVER_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
];

export async function runTool(name: string, input: unknown, ctx: Ctx): Promise<ToolOutcome & { error: boolean }> {
  const handler = handlers[name];
  if (!handler) return { content: `Ferramenta desconhecida: ${name}`, summary: "desconhecida", error: true };
  // Barra na hora da chamada, não só na lista: a conversa antiga (lista congelada com tudo), a conversa de outra pessoa
  // e o modelo que chama uma ferramenta fora da lista dele (a Venice aceita qualquer nome) passam por aqui.
  const falta = ctx.usuario ? chaveQueFalta(name, (input ?? {}) as Input, ctx.usuario) : null;
  if (falta) {
    const message = `${new SemPermissao(falta.chave).message}${falta.dica ? ` ${falta.dica}` : ""}`;
    return { content: message, summary: cut(message, 120), error: true };
  }
  // A ferramenta roda na organização de quem pediu (a mesma em que as chaves acima foram conferidas). Quem chama já
  // costuma estar dentro dela (route(), MCP do hub); aqui fica garantido também para quem chama direto.
  const org = ctx.usuario?.ativo && ctx.usuario.organizacao?.situacao === "ativa" ? ctx.usuario.organizacao.id : null;
  const executar = async () => {
    try {
      return { ...(await handler((input ?? {}) as Input, ctx)), error: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      return { content: message, summary: cut(message, 120), error: true };
    }
  };
  return org ? comOrganizacao(org, executar) : executar();
}

// Linha curta mostrada no card da ferramenta (o que foi pedido).
export function toolDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Input;
  const pick = (...keys: string[]) => keys.map((k) => str(i[k])).find(Boolean) ?? "";
  if (name === "web_search") return pick("query");
  if (name === "web_fetch") return pick("url");
  return cut(pick("prompt", "text", "script", "title", "search", "consulta", "slug", "family", "tool", "generation_id", "project_id", "name", "action", "agent", "chat_id", "language"), 140);
}
