import "server-only";

import { resolveElevenModel } from "@/lib/elevenlabs-models";
import { organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { mcp } from "@/lib/server/mcp-client";

// ElevenLabs pelo MCP remoto (api.elevenlabs.io/v1/mcp) com login OAuth da conta (Integrações → ElevenLabs).
// Cada geração vira um flow no ElevenLabs e roda em segundo plano: começa, consulta o status até terminar e baixa o resultado.

const el = mcp("elevenlabs");

const ctx = (why: string) => `Hub de Criativos (ferramenta local de criativos de anúncio): ${why}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// gender/age normalizados a partir dos labels do ElevenLabs, para agrupar como na biblioteca deles.
export type VoiceGender = "female" | "male" | "neutral" | "";
export type VoiceAge = "young" | "middle_aged" | "old" | "";

export type ElevenVoice = {
  id: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string | null;
  gender: VoiceGender;
  age: VoiceAge;
  // true quando gênero/idade foram deduzidos do nome (vozes clonadas costumam vir sem labels).
  guessed: boolean;
  accent: string;
  useCase: string;
};

// Vozes clonadas vêm sem labels: deduz pelo nome/descrição (pt, es, en). Na dúvida, fica sem classificação.
const has = (text: string, words: string[]) => words.some((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(text));

function guessGender(text: string): VoiceGender {
  const female = has(text, ["narradora", "entrenadora", "locutora", "mulher", "mujer", "feminina", "femenina", "female", "woman", "senhora", "señora", "garota", "chica", "moça", "vovó", "vovo", "avó", "abuela", "mãe", "mae", "madre", "tia", "ela", "dona", "coroa", "fem", "doutora", "dra", "doctora"]);
  const male = has(text, ["narrador", "entrenador", "locutor", "homem", "hombre", "masculino", "male", "man", "senhor", "señor", "garoto", "chico", "rapaz", "vovô", "avô", "abuelo", "pai", "padre", "tio", "ele", "doutor", "médico", "medico", "masc", "dr", "doctor"]);
  if (female && !male) return "female";
  if (male && !female) return "male";
  return "";
}

function guessAge(text: string): VoiceAge {
  const years = Number(/(\d{2})\s*(anos|años|years|yo)\b/i.exec(text)?.[1]);
  if (years) return years < 35 ? "young" : years < 56 ? "middle_aged" : "old";
  if (has(text, ["idosa", "idoso", "velha", "velho", "vovó", "vovô", "vovo", "avó", "avô", "abuela", "abuelo", "anciana", "anciano", "old", "elderly", "senior", "coroa"])) return "old";
  if (has(text, ["jovem", "joven", "young", "garota", "garoto", "chica", "chico", "moça", "rapaz", "teen"])) return "young";
  return "";
}

function normGender(v?: string): VoiceGender {
  const s = (v ?? "").toLowerCase();
  if (s.startsWith("fem") || s === "woman") return "female";
  if (s.startsWith("male") || s === "man" || s.startsWith("masc")) return "male";
  if (s.startsWith("neutral") || s.startsWith("non")) return "neutral";
  return "";
}

function normAge(v?: string): VoiceAge {
  const s = (v ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (s.startsWith("young") || s === "child" || s === "teen") return "young";
  if (s.startsWith("middle")) return "middle_aged";
  if (s.startsWith("old") || s.startsWith("elder") || s === "senior") return "old";
  return "";
}

type RawVoice = {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
  is_library_voice?: boolean;
};

// creative_list_voices devolve no máximo 25 vozes por busca, sem paginação: as da conta primeiro, depois as da
// biblioteca. Para cobrir as vozes da conta, juntamos várias buscas (grátis) e tiramos as repetidas.
const VOICE_QUERIES: Record<string, unknown>[] = [
  { languages: ["pt"] },
  { languages: ["es"] },
  { languages: ["en"] },
  { search: "narrador" },
  { search: "narradora" },
  { search: "clone" },
  { gender: "female" },
  { gender: "male" },
  { age: "old" },
  { age: "young" },
];

const LIBRARY_LANGUAGES = ["pt", "es", "en"];

// Vozes da conta do ElevenLabs de cada organização (cada uma tem as próprias vozes clonadas).
const voiceCache = new Map<string, { at: number; voices: ElevenVoice[] }>();

export async function listVoices(): Promise<ElevenVoice[]> {
  const org = await organizacaoAtual();
  const cached = voiceCache.get(org);
  if (cached && Date.now() - cached.at < 120_000) return cached.voices;
  const search = (args: Record<string, unknown>) =>
    el.callTool<{ voices?: RawVoice[] }>("creative_list_voices", { context: ctx("listar as vozes da conta para o usuário escolher a da narração"), ...args });
  // A primeira busca abre a sessão do MCP; as outras vão em paralelo.
  const first = await search({});
  const rest = await Promise.allSettled(VOICE_QUERIES.map(search));
  const seen = new Map<string, RawVoice>();
  for (const page of [first, ...rest.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))]) {
    for (const v of page.voices ?? []) if (v?.voice_id && !seen.has(v.voice_id)) seen.set(v.voice_id, v);
  }
  // Vozes da conta primeiro, depois as da biblioteca pública (só nos idiomas das operações, para não poluir a lista).
  const raw = [...seen.values()]
    .filter((v) => !v.is_library_voice || LIBRARY_LANGUAGES.includes(v.labels?.language ?? ""))
    .sort((a, b) => Number(Boolean(a.is_library_voice)) - Number(Boolean(b.is_library_voice)));
  const voices = raw.map((v): ElevenVoice => {
    const labels = v.labels ?? {};
    const name = v.name.trim();
    const gender = normGender(labels.gender);
    const age = normAge(labels.age);
    // O nome vale mais que a descrição (ex.: "AD21 narradora" com descrição genérica "Clone do narrador…").
    const guessedGender = gender ? "" : guessGender(name) || guessGender(v.description ?? "");
    const guessedAge = age ? "" : guessAge(name) || guessAge(v.description ?? "");
    return {
      id: v.voice_id,
      name,
      category: v.is_library_voice ? "library" : (v.category ?? ""),
      description: v.description || Object.values(labels).join(" · "),
      previewUrl: v.preview_url ?? null,
      gender: gender || guessedGender,
      age: age || guessedAge,
      guessed: Boolean(guessedGender || guessedAge),
      accent: labels.accent ?? "",
      useCase: labels.use_case ?? labels["use case"] ?? labels.descriptive ?? "",
    };
  });
  voiceCache.set(org, { at: Date.now(), voices });
  return voices;
}

// ---------- Execução no flow (começa → consulta o status até terminar) ----------

type Started = { flow_id?: string; node_id?: string; session_ids?: string[]; session_id?: string; poll_after_seconds?: number };
type RunStatus = { all_completed?: boolean; has_failures?: boolean; poll_after_seconds?: number; generations?: unknown[]; notes?: string } & Record<string, unknown>;

// Percorre o JSON da resposta (os resultados podem vir aninhados) e devolve [chave, valor] de todas as folhas.
function leaves(node: unknown, key = "", out: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(node)) node.forEach((v) => leaves(v, key, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, k, out);
  else out.push([key, node]);
  return out;
}

function findKey(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findKey(v, key);
      if (hit !== undefined) return hit;
    }
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (key in obj) return obj[key];
    for (const v of Object.values(obj)) {
      const hit = findKey(v, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function failureMessage(status: RunStatus): string {
  const msg = leaves(status.generations ?? status).find(([k, v]) => /error|fail|reason/i.test(k) && typeof v === "string" && v.trim())?.[1];
  return typeof msg === "string" ? msg.slice(0, 300) : "a geração falhou";
}

async function waitRun(start: Started, what: string, timeoutMs: number): Promise<RunStatus> {
  const flowId = start.flow_id;
  const sessionIds = start.session_ids?.length ? start.session_ids : start.session_id ? [start.session_id] : [];
  if (!flowId || !sessionIds.length) throw new Error(`ElevenLabs não devolveu o andamento da ${what}.`);
  const deadline = Date.now() + timeoutMs;
  let wait = start.poll_after_seconds ?? 3;
  for (;;) {
    await sleep(Math.min(15, Math.max(1, wait)) * 1000);
    const status = await el.callTool<RunStatus>("creative_get_flow_run_status", {
      context: ctx(`acompanhar a ${what} até terminar`),
      flow_id: flowId,
      session_ids: sessionIds,
    });
    if (status.has_failures) throw new Error(`ElevenLabs: ${failureMessage(status)}`);
    if (status.all_completed) return status;
    if (Date.now() > deadline) throw new Error(`ElevenLabs demorou mais de ${Math.round(timeoutMs / 60_000)} min na ${what}. Veja o flow no ElevenLabs: ${String(status.url ?? "")}`.trim());
    wait = status.poll_after_seconds ?? 3;
  }
}

// URL do arquivo gerado: prefere chaves de áudio/saída e ignora links do canvas (elevenlabs.io/app/...).
function outputUrl(status: RunStatus): string | null {
  const rank = (k: string) => (/audio/i.test(k) ? 0 : /output|download|file|media|asset|result/i.test(k) ? 1 : k === "url" ? 2 : 3);
  const urls = leaves(status.generations ?? [])
    .filter((e): e is [string, string] => typeof e[1] === "string" && /^https?:\/\//.test(e[1]) && !/elevenlabs\.io\/app\//.test(e[1]) && !/thumbnail|orb_url|preview_image/i.test(e[0]))
    .sort((a, b) => rank(a[0]) - rank(b[0]));
  return urls[0]?.[1] ?? null;
}

// ---------- Dublagem de vídeo (Dubbing v2) ----------

// Dubla o vídeo para o idioma (código ISO, ex.: "es") num flow novo: sobe o vídeo, liga a um nó de dublagem e baixa o
// vídeo dublado. Usada pela linha de produção do Instagram (features/instagram), com a mesma conta do hub.
export async function dublarVideo(video: Buffer, filename: string, idioma: string): Promise<{ body: ArrayBuffer; contentType: string; flowId: string }> {
  const why = ctx(`dublar um reel para o idioma ${idioma}, mantendo a imagem`);
  const flow = await el.callTool<{ flow_id?: string }>("creative_create_flow", { context: why, name: `Hub de Criativos · dublagem ${filename}` });
  if (!flow.flow_id) throw new Error("ElevenLabs não criou o flow da dublagem.");

  const up = await el.callTool<{ asset_id?: string; upload_url?: string; upload_headers?: Record<string, string> }>("creative_create_asset_upload", {
    context: why,
    name: filename,
    mime_type: "video/mp4",
    file_size: video.length,
  });
  if (!up.asset_id || !up.upload_url) throw new Error("ElevenLabs não devolveu o endereço de envio do vídeo.");
  const put = await fetch(up.upload_url, { method: "PUT", headers: { ...up.upload_headers, "Content-Type": "video/mp4" }, body: new Uint8Array(video) });
  if (!put.ok) throw new Error(`Falhou o envio do vídeo ao ElevenLabs (${put.status}).`);
  const fin = await el.callTool<Record<string, unknown>>("creative_finalize_asset_upload", { context: why, asset_id: up.asset_id, flow_id: flow.flow_id });
  const fonte = findKey(fin, "node_id");
  if (typeof fonte !== "string") throw new Error("ElevenLabs não colocou o vídeo no flow da dublagem.");

  const node = await el.callTool<Record<string, unknown>>("creative_add_flow_node", {
    context: why,
    flow_id: flow.flow_id,
    node_type: "dubbing-video",
    model_id: "dubbing_v2_video",
    model_parameters: { target_language_code: idioma },
    connect_from: [fonte],
    label: `Dublagem (${idioma})`,
  });
  const nodeId = findKey(node, "node_id") ?? findKey(node, "id");
  if (typeof nodeId !== "string") throw new Error("ElevenLabs não criou o nó da dublagem.");

  // Nunca repetir creative_run_flow_nodes para "tentar de novo": cada chamada cobra uma dublagem nova.
  const start = await el.callTool<Started>("creative_run_flow_nodes", { context: why, flow_id: flow.flow_id, node_ids: [nodeId] });
  const status = await waitRun({ ...start, flow_id: start.flow_id ?? flow.flow_id }, "dublagem", 45 * 60_000);
  const url = outputUrl(status);
  if (!url) throw new Error("ElevenLabs terminou a dublagem, mas não devolveu o endereço do vídeo.");
  const res = await el.download(url);
  if (!res.ok) throw new Error(`Não consegui baixar o vídeo dublado do ElevenLabs (${res.status}).`);
  const contentType = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim();
  if (contentType.includes("text/html")) throw new Error("O ElevenLabs devolveu uma página em vez do vídeo dublado.");
  return { body: await res.arrayBuffer(), contentType, flowId: flow.flow_id };
}

// ---------- Texto para fala ----------

export type TtsInput = {
  text: string;
  voiceId: string;
  modelId: string;
};

export async function textToSpeech(input: TtsInput): Promise<ArrayBuffer> {
  // Nunca repetir creative_generate_speech para "tentar de novo": cada chamada cobra uma geração nova.
  const start = await el.callTool<Started>("creative_generate_speech", {
    context: ctx("gerar a narração de um anúncio com o roteiro e a voz que o usuário escolheu"),
    prompt: input.text,
    model_id: resolveElevenModel(input.modelId),
    voice_id: input.voiceId,
    generations_count: 1,
  });
  const status = await waitRun(start, "narração", 180_000);
  const url = outputUrl(status);
  if (!url) throw new Error("ElevenLabs terminou a narração, mas não devolveu o endereço do áudio.");
  const res = await el.download(url);
  if (!res.ok) throw new Error(`Não consegui baixar a narração do ElevenLabs (${res.status}).`);
  if ((res.headers.get("content-type") ?? "").includes("text/html")) throw new Error("O ElevenLabs devolveu uma página em vez do áudio da narração.");
  return res.arrayBuffer();
}

// ---------- Transcrição (Scribe) ----------

export type SttWord = { text: string; start: number; end: number };
export type SttResult = { language: string; languageProbability: number | null; text: string; words: SttWord[] };

type RawWord = { text?: string; word?: string; start?: number; end?: number; type?: string };

function toWords(list: unknown): SttWord[] {
  if (!Array.isArray(list)) return [];
  return (list as RawWord[])
    .filter((w) => w && (!w.type || w.type === "word") && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({ text: String(w.text ?? w.word ?? "").trim(), start: w.start!, end: w.end! }))
    .filter((w) => w.text);
}

const mimeOf = (filename: string) =>
  ({ wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac" })[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "audio/mpeg";

// Sobe o áudio para um flow novo, transcreve com o Scribe e devolve texto, idioma e tempo por palavra.
export async function transcribeFull(audio: Buffer, filename: string): Promise<SttResult> {
  const why = ctx("transcrever a fala de um vídeo/áudio do hub com tempo por palavra, para legendas");
  const flow = await el.callTool<{ flow_id?: string }>("creative_create_flow", { context: why, name: `Hub de Criativos · transcrição ${filename}` });
  if (!flow.flow_id) throw new Error("ElevenLabs não criou o flow da transcrição.");

  const mime = mimeOf(filename);
  const up = await el.callTool<{ asset_id?: string; upload_url?: string; upload_headers?: Record<string, string> }>("creative_create_asset_upload", {
    context: why,
    name: filename,
    mime_type: mime,
    file_size: audio.length,
  });
  if (!up.asset_id || !up.upload_url) throw new Error("ElevenLabs não devolveu o endereço de envio do áudio.");
  const put = await fetch(up.upload_url, { method: "PUT", headers: { ...up.upload_headers, "Content-Type": mime }, body: new Uint8Array(audio) });
  if (!put.ok) throw new Error(`Falhou o envio do áudio ao ElevenLabs (${put.status}).`);
  const fin = await el.callTool<Record<string, unknown>>("creative_finalize_asset_upload", { context: why, asset_id: up.asset_id, flow_id: flow.flow_id });
  const nodeId = findKey(fin, "node_id");
  if (typeof nodeId !== "string") throw new Error("ElevenLabs não colocou o áudio no flow da transcrição.");

  // Nunca repetir creative_transcribe_audio para "tentar de novo": cada chamada cobra uma transcrição nova.
  const start = await el.callTool<Started>("creative_transcribe_audio", {
    context: why,
    model_id: "eleven_scribe_v1",
    flow_id: flow.flow_id,
    connect_from: [nodeId],
  });
  const status = await waitRun({ ...start, flow_id: start.flow_id ?? flow.flow_id }, "transcrição", 600_000);

  const transcripts = findKey(status, "transcripts");
  const t = ((Array.isArray(transcripts) ? transcripts[0] : transcripts) ?? {}) as Record<string, unknown>;
  let words = toWords(t.words);
  const download = t.words_download_url;
  // A lista de palavras pode vir cortada na resposta; a completa fica em words_download_url.
  if (typeof download === "string" && (t.words_truncated || !words.length || (typeof t.words_count === "number" && t.words_count > words.length))) {
    const res = await el.download(download);
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as unknown;
      const full = toWords(Array.isArray(data) ? data : (data as { words?: unknown } | null)?.words);
      if (full.length) words = full;
    }
  }
  const lang = t.language_code ?? t.language ?? findKey(status, "language_code");
  const prob = t.language_probability ?? findKey(status, "language_probability");
  const text = typeof t.text === "string" ? t.text : words.map((w) => w.text).join(" ");
  return {
    language: typeof lang === "string" ? lang : "",
    languageProbability: typeof prob === "number" ? prob : null,
    text: text.trim(),
    words,
  };
}

// Transcrição com tempo por palavra, usada para gerar as legendas do editor.
export async function transcribe(audio: Buffer, filename: string): Promise<{ language: string; words: SttWord[] }> {
  const { language, words } = await transcribeFull(audio, filename);
  return { language, words };
}

export const elevenlabsConnected = async () => (await el.connectionStatus()).connected;
