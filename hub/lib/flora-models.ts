// Modelos do FLORA usados no estúdio de Geração (ids e parâmetros conferidos com flora_list_models em 2026-10-05).
// Cada família tem a versão só-texto e a versão a partir de imagem; o hub escolhe sozinho:
// com imagem de referência usa `fromImage` (exige a imagem em params), sem imagem usa `fromText`.
// A lista sai ordenada do mais barato para o mais caro (baseCostUsd).

export type FloraKind = "image" | "video";

export type FloraParam = {
  name: string;
  label: string;
  default: string;
  options: { value: string; label: string }[];
  // Alguns parâmetros só existem numa das versões (ex.: MiniMax com frame segue a proporção da imagem).
  only?: "text" | "image";
};

export type FloraFamily = {
  id: string;
  kind: FloraKind;
  label: string;
  note: string;
  fromText: string;
  fromImage: string;
  // Campo da imagem na versão fromImage. Quase todos usam image_url; o Gemini Omni pede uma lista.
  imageField?: "image_url" | "image_urls";
  // Versão com VÁRIAS imagens de referência (image_urls): is2i-* (imagem) e r2v-* (vídeo a partir de referências).
  // Sem ela, o modelo aceita uma imagem só.
  fromImages?: string;
  baseCostUsd: number; // orçamento do FLORA nos padrões do hub (imagem: 9:16 1K alta; vídeo: 5s)
  params: FloraParam[];
};

const opts = (values: string[], suffix = "") => values.map((v) => ({ value: v, label: `${v}${suffix}` }));

const aspect = (values: string[], only?: FloraParam["only"]): FloraParam => ({
  name: "aspect_ratio",
  label: "Proporção",
  default: values[0],
  options: opts(values),
  ...(only ? { only } : {}),
});
const resolution = (values: string[], def = values[0]): FloraParam => ({
  name: "resolution",
  label: "Resolução",
  default: def,
  options: opts(values),
});
const duration = (values: string[]): FloraParam => ({
  name: "duration",
  label: "Duração",
  default: "5",
  options: opts(values, "s"),
});
const QUALITY: FloraParam = {
  name: "quality",
  label: "Qualidade",
  default: "high",
  options: [
    { value: "low", label: "Baixa" },
    { value: "medium", label: "Média" },
    { value: "high", label: "Alta" },
  ],
};
const FIDELITY: FloraParam = {
  name: "input_fidelity",
  label: "Fidelidade à foto",
  default: "high",
  options: [
    { value: "low", label: "Baixa" },
    { value: "high", label: "Alta" },
  ],
  only: "image",
};

const GEMINI_AR = ["9:16", "4:5", "3:4", "2:3", "1:1", "16:9"];
const GPT25_AR = ["9:16", "3:4", "2:3", "1:1", "16:9"];
const GPT_LEGACY_AR = ["2:3", "1:1", "3:2"]; // GPT Image 1 e 1.5 não têm 9:16
const VIDEO_AR = ["9:16", "3:4", "1:1", "16:9"];
const MINIMAX_DUR = ["5", "6", "7", "8", "10", "12", "15"];
const SEEDANCE_DUR = ["4", "5", "6", "7", "8", "10", "12", "15"];

const FAMILIES: FloraFamily[] = [
  // ---------- Imagem ----------
  {
    id: "nano-banana-2-lite",
    kind: "image",
    label: "Nano Banana 2 Lite",
    note: "O mais barato e rápido (só 1K). Bom para rascunho.",
    fromText: "t2i-nano-banana-2-lite-t2i-google-gemini",
    fromImage: "i2i-nano-banana-2-lite-i2i-google-gemini",
    fromImages: "is2i-nano-banana-2-lite-is2i-google-gemini",
    baseCostUsd: 0.043,
    params: [aspect(GEMINI_AR)],
  },
  {
    id: "gpt-image-1",
    kind: "image",
    label: "GPT Image 1",
    note: "Barato, mas sem 9:16 (vertical é 2:3).",
    fromText: "t2i-openai-gpt-image-1",
    fromImage: "i2i-openai-gpt-image-1",
    fromImages: "is2i-openai-gpt-image-1",
    baseCostUsd: 0.045,
    params: [aspect(GPT_LEGACY_AR), QUALITY, FIDELITY],
  },
  {
    id: "nano-banana",
    kind: "image",
    label: "Nano Banana",
    note: "Primeira versão do Nano Banana. Edição rápida a partir da foto.",
    fromText: "t2i-nano-banana",
    fromImage: "i2i-nano-banana",
    fromImages: "is2i-nano-banana",
    baseCostUsd: 0.047,
    params: [aspect(GEMINI_AR)],
  },
  {
    id: "gpt-image-2-5-flare",
    kind: "image",
    label: "GPT Image 2.5 Flare",
    note: "Frame barato e rápido, bom para explorar.",
    fromText: "t2i-gpt-image-2-5-flare",
    fromImage: "i2i-gpt-image-2-5-flare",
    fromImages: "is2i-gpt-image-2-5-flare",
    baseCostUsd: 0.055,
    params: [aspect(GPT25_AR), QUALITY, resolution(["1k", "2k", "4k"])],
  },
  {
    id: "gpt-image-2-5-sunburst",
    kind: "image",
    label: "GPT Image 2.5 Sunburst",
    note: "Mesmo preço do Flare com outra estética; vale testar lado a lado.",
    fromText: "t2i-gpt-image-2-5-sunburst",
    fromImage: "i2i-gpt-image-2-5-sunburst",
    fromImages: "is2i-gpt-image-2-5-sunburst",
    baseCostUsd: 0.055,
    params: [aspect(GPT25_AR), QUALITY, resolution(["1k", "2k", "4k"])],
  },
  {
    id: "nano-banana-2",
    kind: "image",
    label: "Nano Banana 2",
    note: "Melhor custo-benefício do Nano Banana; ótimo editando a foto do produto.",
    fromText: "t2i-gemini-3.1-flash-image",
    fromImage: "i2i-gemini-3.1-flash-image",
    fromImages: "is2i-gemini-3.1-flash-image",
    baseCostUsd: 0.072,
    params: [aspect(GEMINI_AR), resolution(["1K", "2K", "4K"])],
  },
  {
    id: "gpt-image-1-5",
    kind: "image",
    label: "GPT Image 1.5",
    note: "Sem 9:16 (vertical é 2:3). Prefira o 2.5 ou o 2.",
    fromText: "t2i-openai-gpt-image-1-5",
    fromImage: "i2i-openai-gpt-image-1-5",
    fromImages: "is2i-openai-gpt-image-1-5",
    baseCostUsd: 0.168,
    params: [aspect(GPT_LEGACY_AR), QUALITY, FIDELITY],
  },
  {
    id: "nano-banana-pro",
    kind: "image",
    label: "Nano Banana Pro",
    note: "Topo do Nano Banana: detalhe fino e texto legível na embalagem.",
    fromText: "t2i-gemini-3-pro",
    fromImage: "i2i-gemini-3-pro",
    fromImages: "is2i-gemini-3-pro",
    baseCostUsd: 0.18,
    params: [aspect(GEMINI_AR), resolution(["1K", "2K", "4K"])],
  },
  {
    id: "gpt-image-2",
    kind: "image",
    label: "GPT Image 2",
    note: "Padrão para frames. Fiel à foto do produto.",
    fromText: "t2i-gpt-image-2-t2i",
    fromImage: "i2i-gpt-image-2-i2i",
    fromImages: "is2i-gpt-image-2",
    baseCostUsd: 0.254,
    params: [aspect(GEMINI_AR), QUALITY, resolution(["1k", "2k", "4k"])],
  },

  // ---------- Vídeo ----------
  {
    id: "minimax-h3-max-turbo",
    kind: "video",
    label: "MiniMax H3 Max Turbo",
    note: "O mais barato e sai em ~20s. Bom para testar movimento. Com frame, a proporção segue a imagem.",
    fromText: "t2v-minimax-h3-max-turbo-gateway",
    fromImage: "i2v-minimax-h3-max-turbo-gateway",
    baseCostUsd: 0.21,
    params: [aspect(VIDEO_AR, "text"), duration(MINIMAX_DUR), resolution(["480P", "768P", "1080P"], "768P")],
  },
  {
    id: "seedance-1-5-pro",
    kind: "video",
    label: "Seedance 1.5 Pro",
    note: "Seedance barato, até 12s. Bom para b-roll simples.",
    fromText: "t2v-seedance-1.5-pro",
    fromImage: "i2v-seedance-1.5-pro",
    baseCostUsd: 0.312,
    params: [aspect(VIDEO_AR), duration(["4", "5", "6", "7", "8", "10", "12"]), resolution(["480p", "720p"], "720p")],
  },
  {
    id: "minimax-h3-max",
    kind: "video",
    label: "MiniMax H3 Max",
    note: "Mais qualidade que o Turbo, ainda rápido. Com frame, a proporção segue a imagem.",
    fromText: "t2v-minimax-h3-max-gateway",
    fromImage: "i2v-minimax-h3-max-gateway",
    fromImages: "r2v-minimax-h3-max-gateway",
    baseCostUsd: 0.48,
    params: [aspect(VIDEO_AR, "text"), duration(MINIMAX_DUR), resolution(["480P", "768P"], "768P")],
  },
  {
    id: "gemini-omni-flash",
    kind: "video",
    label: "Gemini Omni 1.1 Flash",
    note: "Modelo do Google. Só 9:16 ou 16:9, até 10s.",
    fromText: "t2v-gemini-omni-1-1-flash-t2v",
    fromImage: "i2v-gengateway-omni-1-1-flash-gg",
    fromImages: "r2v-gengateway-omni-1-1-flash-gg",
    imageField: "image_urls",
    baseCostUsd: 0.6, // FLORA cota US$ 0,96 para 8s
    params: [
      aspect(["9:16", "16:9"]),
      duration(["3", "4", "5", "6", "7", "8", "10"]),
      resolution(["360p", "720p", "1080p", "4k"], "720p"),
    ],
  },
  {
    id: "minimax-h3",
    kind: "video",
    label: "MiniMax H3",
    note: "Em 768P sai mais barato que o Max; vai até 4K, mas 2K/4K custam bem mais. Com frame, a proporção segue a imagem.",
    fromText: "t2v-minimax-h3-gateway",
    fromImage: "i2v-minimax-h3-gateway",
    fromImages: "r2v-minimax-h3-gateway",
    baseCostUsd: 0.315,
    params: [aspect(VIDEO_AR, "text"), duration(MINIMAX_DUR), resolution(["480P", "768P", "2K", "4K"], "768P")],
  },
  {
    id: "seedance-2-fast",
    kind: "video",
    label: "Seedance 2.0 Fast",
    note: "Padrão para explorar hooks.",
    fromText: "t2v-seedance-2.0-fast-enhancor",
    fromImage: "i2v-seedance-2-fast-enhancor",
    fromImages: "r2v-seedance-2.0-fast-enhancor",
    baseCostUsd: 0.851,
    params: [aspect(VIDEO_AR), duration(SEEDANCE_DUR), resolution(["480p", "720p"], "720p")],
  },
  {
    id: "seedance-2-mini",
    kind: "video",
    label: "Seedance 2.0 Mini",
    note: "Versão leve do 2.0; no FLORA sai um pouco mais caro que o Fast.",
    fromText: "t2v-seedance-2-0-mini-t2v",
    fromImage: "i2v-seedance-2-0-mini-i2v",
    baseCostUsd: 0.929,
    params: [aspect(VIDEO_AR), duration(["4", "5", "6", "8", "10", "12", "15"]), resolution(["480p", "720p"], "720p")],
  },
  {
    id: "seedance-2",
    kind: "video",
    label: "Seedance 2.0",
    note: "Mais qualidade que o Fast.",
    fromText: "t2v-seedance-2.0-enhancor",
    fromImage: "i2v-seedance-2.0-enhancor",
    fromImages: "r2v-seedance-2.0-enhancor",
    baseCostUsd: 1.058,
    params: [aspect(VIDEO_AR), duration(SEEDANCE_DUR), resolution(["480p", "720p", "1080p", "4k"], "720p")],
  },
  {
    id: "seedance-2-5",
    kind: "video",
    label: "Seedance 2.5",
    note: "Só para o que vai escalar.",
    fromText: "t2v-gengateway-seedance-2-5-t2v",
    fromImage: "i2v-gengateway-seedance-2-5-i2v",
    fromImages: "r2v-seedance-2-5",
    baseCostUsd: 2.483,
    params: [aspect(VIDEO_AR), duration(SEEDANCE_DUR), resolution(["480p", "720p", "1080p"], "720p")],
  },
];

export const FLORA_FAMILIES: FloraFamily[] = [...FAMILIES].sort((a, b) => a.baseCostUsd - b.baseCostUsd);

// Modelo aberto ao trocar de aba (o padrão do playbook, não o mais barato).
export const DEFAULT_FAMILY: Record<FloraKind, string> = { image: "gpt-image-2", video: "seedance-2-fast" };

export const getFamily = (id: string) => FLORA_FAMILIES.find((f) => f.id === id);

// Limite do hub de imagens de referência numa geração (o FLORA não publica um máximo por modelo).
export const MAX_REFERENCES = 8;

// Parâmetros que valem para a versão que vai rodar (com ou sem imagem de referência).
export const paramsFor = (family: FloraFamily, withImage: boolean) =>
  family.params.filter((p) => !p.only || p.only === (withImage ? "image" : "text"));

// Regras do playbook de dropshipping COD (hub/playbooks/dropshipping-cod-criativos.md) aplicadas no prompt.
// Mercado = país + idioma da fala. Com COD aplica as regras do playbook; sem COD, só fixa o idioma da fala do vídeo.
export const MARKETS = [
  { id: "cl", label: "Chile (espanhol)", speech: "Chilean Spanish" },
  { id: "co", label: "Colômbia (espanhol)", speech: "Colombian Spanish" },
  { id: "mx", label: "México (espanhol)", speech: "Mexican Spanish" },
  { id: "gt", label: "Guatemala (espanhol)", speech: "Guatemalan Spanish" },
  { id: "es", label: "América Latina (espanhol neutro)", speech: "neutral Latin American Spanish" },
  { id: "br", label: "Brasil (português)", speech: "Brazilian Portuguese" },
  { id: "pt", label: "Portugal (português)", speech: "European Portuguese" },
  { id: "fr", label: "França (francês)", speech: "French" },
  { id: "us", label: "EUA (inglês)", speech: "American English" },
  { id: "ro", label: "Romênia (romeno)", speech: "Romanian" },
] as const;

export type Operation = "none" | "cod";

export function applyRules(prompt: string, kind: FloraKind, operation: Operation, marketId?: string): string {
  const base = prompt.trim();
  if (operation !== "cod") {
    // Sem regras: só o idioma da fala, quando escolhido (vídeo).
    const market = kind === "video" ? MARKETS.find((m) => m.id === marketId) : undefined;
    return market ? `${base}\nAll speech in ${market.speech} only.` : base;
  }
  const lines = [base];
  if (kind === "video") {
    const market = MARKETS.find((m) => m.id === marketId) ?? MARKETS[0];
    lines.push(`Continuous energetic speech, no silence. All speech in ${market.speech} only, no other language.`);
    lines.push("Adults only, no children anywhere. No on-screen text, no subtitles.");
  } else {
    lines.push("Adults only, no children anywhere. No added text, no watermark.");
  }
  return lines.join("\n");
}
