// Modelos de voz do ElevenLabs e os ajustes que cada um aceita (como na tela do próprio ElevenLabs).
// Fontes: GET /v1/models (can_use_style / can_use_speaker_boost) e a documentação de cada modelo (2026-10).
// Usado pela tela de Voz (mostra só os ajustes do modelo) e pelo servidor (manda só o que o modelo aceita).

export type VoiceSetting = "speed" | "stability" | "similarity" | "style";

export type ElevenModel = {
  id: string;
  label: string;
  note: string;
  settings: VoiceSetting[];
  // Eleven v3: estabilidade só em 3 níveis (0 Criativo, 0.5 Natural, 1 Robusto).
  stabilityPresets?: boolean;
  speakerBoost: boolean;
  // Aceita audio tags entre colchetes ([excited], [laughs]…) que dão emoção à fala.
  audioTags: boolean;
};

// Em ordem do mais avançado para o mais simples; o primeiro é o padrão da tela.
// Custo: 1 crédito por caractere em todos, menos o Flash (meio). v4 e v3 custam o mesmo que o Multilingual v2.
export const ELEVEN_MODELS: ElevenModel[] = [
  { id: "eleven_v4", label: "Eleven v4", note: "O mais natural e emotivo; aceita tags de emoção", settings: ["stability", "similarity"], speakerBoost: false, audioTags: true },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo", note: "Quase a mesma qualidade, bem mais rápido; aceita tags", settings: ["stability", "similarity"], speakerBoost: false, audioTags: true },
  { id: "eleven_v3", label: "Eleven v3", note: "Expressivo, aceita tags de emoção", settings: ["stability"], stabilityPresets: true, speakerBoost: false, audioTags: true },
  { id: "eleven_multilingual_v2", label: "Multilingual v2", note: "Estável em textos longos, menos emoção (ignora tags)", settings: ["speed", "stability", "similarity", "style"], speakerBoost: true, audioTags: false },
  { id: "eleven_flash_v2_5", label: "Flash v2.5", note: "O mais barato, soa mais robótico; só para rascunho (ignora tags)", settings: ["speed", "stability", "similarity"], speakerBoost: false, audioTags: false },
];

export const DEFAULT_ELEVEN_MODEL = ELEVEN_MODELS[0].id;

export const getElevenModel = (id: string) => ELEVEN_MODELS.find((m) => m.id === id);

// Ajustes padrão para narração de anúncio: estabilidade mais baixa deixa as tags e a entonação variarem mais.
// Receita aprovada em vídeos reais (skill motion-designer): estabilidade 0.3, similaridade 0.8.
export const NARRATION_DEFAULTS = { stability: 0.3, similarity: 0.8, style: 0.3, speed: 1 };

// Tags de emoção mais úteis em anúncio (o ElevenLabs entende melhor em inglês; o rótulo é para a tela).
export const AUDIO_TAGS: { tag: string; label: string }[] = [
  { tag: "[excited]", label: "Animada" },
  { tag: "[happy]", label: "Feliz" },
  { tag: "[curious]", label: "Curiosa" },
  { tag: "[surprised]", label: "Surpresa" },
  { tag: "[confident]", label: "Confiante" },
  { tag: "[warmly]", label: "Acolhedora" },
  { tag: "[sincere]", label: "Sincera" },
  { tag: "[frustrated]", label: "Frustrada" },
  { tag: "[sad]", label: "Triste" },
  { tag: "[mischievously]", label: "Marota" },
  { tag: "[whispers]", label: "Sussurro" },
  { tag: "[laughs]", label: "Risada" },
  { tag: "[chuckles]", label: "Risinho" },
  { tag: "[sighs]", label: "Suspiro" },
  { tag: "[gasps]", label: "Espanto" },
  { tag: "[emphatic]", label: "Ênfase" },
];

// Tira as tags quando o modelo não aceita (senão ele lê "[excited]" em voz alta).
export const stripAudioTags = (text: string) =>
  text.replace(/\s*\[[^\]\n]{1,40}\]\s*/g, " ").replace(/ {2,}/g, " ").trim();

export const V3_STABILITY = [
  { value: 0, label: "Criativo", note: "Mais emoção e variação" },
  { value: 0.5, label: "Natural", note: "Equilibrado, mais próximo da voz original" },
  { value: 1, label: "Robusto", note: "Mais estável, menos expressivo" },
] as const;

// Monta o voice_settings só com o que o modelo aceita (modelos novos recusam campos que não usam).
export function voiceSettingsFor(
  modelId: string,
  s: { stability: number; similarity: number; style: number; speed: number },
): Record<string, number | boolean> {
  const model = getElevenModel(modelId);
  if (!model) return { stability: s.stability, similarity_boost: s.similarity, style: s.style, speed: s.speed, use_speaker_boost: true };
  const out: Record<string, number | boolean> = {};
  if (model.settings.includes("stability")) {
    out.stability = model.stabilityPresets ? V3_STABILITY.reduce((a, b) => (Math.abs(b.value - s.stability) < Math.abs(a.value - s.stability) ? b : a)).value : s.stability;
  }
  if (model.settings.includes("similarity")) out.similarity_boost = s.similarity;
  if (model.settings.includes("style")) out.style = s.style;
  if (model.settings.includes("speed")) out.speed = s.speed;
  if (model.speakerBoost) out.use_speaker_boost = true;
  return out;
}
