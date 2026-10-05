// Ferramentas de EDIÇÃO de vídeo do Higgsfield (o hub não usa o Higgsfield para gerar do zero; geração é no FLORA).
// `target` é o job type / workflow da CLI; o vídeo entra sempre por `--video`.

export type EditField = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  number?: boolean;
};

export type EditTool = {
  id: string;
  label: string;
  description: string;
  target: string;
  via: "model" | "workflow";
  prompt?: { label: string; placeholder: string };
  fields: EditField[];
};

export const EDIT_TOOLS: EditTool[] = [
  {
    id: "prompt-edit",
    label: "Editar com prompt",
    description: "Muda o que acontece no vídeo descrevendo a alteração (Kling 3.0 Omni Edit).",
    target: "kling_video_edit",
    via: "model",
    prompt: { label: "O que mudar", placeholder: "Troque o fundo por um quarto aconchegante à noite, mantenha a pessoa e o frasco" },
    fields: [
      {
        name: "mode",
        label: "Qualidade",
        default: "pro",
        options: [
          { value: "std", label: "Padrão" },
          { value: "pro", label: "Pro" },
          { value: "4k", label: "4K" },
        ],
      },
    ],
  },
  {
    id: "reframe",
    label: "Reenquadrar",
    description: "Muda o formato preenchendo as bordas com IA, por exemplo 16:9 para 9:16.",
    target: "reframe",
    via: "workflow",
    fields: [
      {
        name: "aspect_ratio",
        label: "Novo formato",
        default: "9:16",
        options: ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"].map((v) => ({ value: v, label: v })),
      },
      {
        name: "resolution",
        label: "Resolução",
        default: "1080p",
        options: ["480p", "720p", "1080p"].map((v) => ({ value: v, label: v })),
      },
    ],
  },
  {
    id: "upscale",
    label: "Aumentar resolução",
    description: "Deixa o vídeo mais nítido e em resolução maior.",
    target: "video_upscale",
    via: "model",
    fields: [],
  },
  {
    id: "background",
    label: "Remover fundo",
    description: "Recorta a pessoa ou o produto e remove o fundo do vídeo.",
    target: "video_background_remover",
    via: "model",
    fields: [],
  },
  {
    id: "deflicker",
    label: "Tirar flicker",
    description: "Remove a cintilação de luz entre os quadros, comum em vídeos de IA.",
    target: "video_deflicker",
    via: "model",
    fields: [],
  },
  {
    id: "fps",
    label: "Mais fluidez (FPS)",
    description: "Cria quadros intermediários para o movimento ficar mais suave.",
    target: "fps_boost",
    via: "model",
    fields: [
      {
        name: "fps",
        label: "FPS",
        default: "60",
        number: true,
        options: ["30", "48", "60"].map((v) => ({ value: v, label: `${v} fps` })),
      },
      {
        name: "variant",
        label: "Motor",
        default: "bytedance",
        options: [
          { value: "bytedance", label: "ByteDance" },
          { value: "topaz", label: "Topaz" },
        ],
      },
    ],
  },
  {
    id: "dubbing",
    label: "Dublar",
    description: "Traduz a fala e dubla o vídeo em outro idioma, com sincronia labial.",
    target: "dubbing",
    via: "workflow",
    fields: [
      {
        name: "target_language",
        label: "Idioma",
        default: "eng",
        options: [
          { value: "por", label: "Português" },
          { value: "eng", label: "Inglês" },
          { value: "spa", label: "Espanhol" },
          { value: "fra", label: "Francês" },
          { value: "ita", label: "Italiano" },
          { value: "deu", label: "Alemão" },
        ],
      },
    ],
  },
];

export const getEditTool = (id: string) => EDIT_TOOLS.find((t) => t.id === id);
