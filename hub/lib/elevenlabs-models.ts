// Modelos de voz do ElevenLabs que o hub oferece (os que o MCP do ElevenLabs aceita em creative_generate_speech).
// O MCP não expõe ajustes de voz (estabilidade, similaridade, estilo, velocidade): só modelo, voz e texto.

export type ElevenModel = {
  id: string;
  label: string;
  note: string;
  // Aceita audio tags entre colchetes ([excited], [laughs]…) que dão emoção à fala.
  audioTags: boolean;
};

// O primeiro é o padrão da tela e do chat: o Multilingual v2, modelo padrão do contexto do Sávio (decisão de
// 20/10/2026). Custo: 1 crédito por caractere em todos, menos Flash e Turbo (meio).
export const ELEVEN_MODELS: ElevenModel[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", note: "Padrão (contexto do Sávio): estável em textos longos (ignora tags)", audioTags: false },
  { id: "eleven_v4", label: "Eleven v4", note: "Mais emotivo; aceita tags de emoção", audioTags: true },
  { id: "eleven_v3", label: "Eleven v3", note: "Expressivo, aceita tags de emoção", audioTags: true },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", note: "Rápido e barato, menos natural (ignora tags)", audioTags: false },
  { id: "eleven_flash_v2_5", label: "Flash v2.5", note: "O mais barato, soa mais robótico; só para rascunho (ignora tags)", audioTags: false },
];

export const DEFAULT_ELEVEN_MODEL = ELEVEN_MODELS[0].id;

// Modelos antigos que o MCP não oferece → o equivalente mais próximo (eleven_v4_turbo segue no chat por compatibilidade).
const MODEL_ALIASES: Record<string, string> = { eleven_v4_turbo: "eleven_v4" };

export const resolveElevenModel = (id: string) => (getElevenModel(id) ? id : (MODEL_ALIASES[id] ?? DEFAULT_ELEVEN_MODEL));

export const getElevenModel = (id: string) => ELEVEN_MODELS.find((m) => m.id === id);

export const elevenModelLabel = (id: string) => getElevenModel(id)?.label ?? (id === "eleven_v4_turbo" ? "Eleven v4 Turbo" : id);

// Meio crédito por caractere nos modelos rápidos.
export const isHalfCreditModel = (id: string) => id === "eleven_flash_v2_5" || id === "eleven_turbo_v2_5";

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
