import "server-only";

import { voiceSettingsFor } from "@/lib/elevenlabs-models";
import { requireKey } from "@/lib/server/env";
import { ProviderError } from "@/lib/server/http";

const BASE = "https://api.elevenlabs.io";

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

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": requireKey("elevenlabs"), ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new ProviderError("ElevenLabs", res.status, await res.text());
  return res;
}

type RawVoice = {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
};

export async function listVoices(): Promise<ElevenVoice[]> {
  const voices: RawVoice[] = [];
  let token: string | undefined;
  // /v2/voices é paginado; buscamos até 300 vozes da conta.
  for (let page = 0; page < 3; page++) {
    const qs = new URLSearchParams({ page_size: "100", ...(token ? { next_page_token: token } : {}) });
    const data = (await (await call(`/v2/voices?${qs}`)).json()) as {
      voices: RawVoice[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    voices.push(...data.voices);
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  return voices.map((v) => {
    const labels = v.labels ?? {};
    const gender = normGender(labels.gender);
    const age = normAge(labels.age);
    // O nome vale mais que a descrição (ex.: "AD21 narradora" com descrição genérica "Clone do narrador…").
    const guessedGender = gender ? "" : guessGender(v.name) || guessGender(v.description ?? "");
    const guessedAge = age ? "" : guessAge(v.name) || guessAge(v.description ?? "");
    return {
      id: v.voice_id,
      name: v.name,
      category: v.category ?? "",
      description: v.description || Object.values(labels).join(" · "),
      previewUrl: v.preview_url ?? null,
      gender: gender || guessedGender,
      age: age || guessedAge,
      guessed: Boolean(guessedGender || guessedAge),
      accent: labels.accent ?? "",
      useCase: labels.use_case ?? labels["use case"] ?? labels.descriptive ?? "",
    };
  });
}

export type TtsInput = {
  text: string;
  voiceId: string;
  modelId: string;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
};

export async function textToSpeech(input: TtsInput): Promise<ArrayBuffer> {
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: input.text,
      model_id: input.modelId,
      // Só os ajustes que o modelo aceita (v4 não tem velocidade/estilo; v3 só estabilidade em 3 níveis).
      voice_settings: voiceSettingsFor(input.modelId, input),
    }),
  });
  return res.arrayBuffer();
}

export type SttWord = { text: string; start: number; end: number };

// Transcrição com tempo por palavra (Scribe), usada para gerar as legendas do editor.
export async function transcribe(audio: Buffer, filename: string): Promise<{ language: string; words: SttWord[] }> {
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("tag_audio_events", "false");
  form.set("timestamps_granularity", "word");
  form.set("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
  const data = (await (await call("/v1/speech-to-text", { method: "POST", body: form })).json()) as {
    language_code?: string;
    words?: { text: string; start: number; end: number; type: string }[];
  };
  return {
    language: data.language_code ?? "",
    words: (data.words ?? []).filter((w) => w.type === "word").map(({ text, start, end }) => ({ text: text.trim(), start, end })),
  };
}
