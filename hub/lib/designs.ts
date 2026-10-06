// Direções de design do hub (escolhidas em /design). As cores, fontes e acabamentos de cada uma ficam em
// app/designs.css, ligados por data-design no <html> (ou num contêiner, para as prévias).

export type DesignId = "atual" | "lima" | "poster" | "ilha" | "papel" | "suico" | "ceu" | "argila" | "revista" | "marfim" | "blush" | "menta";

export type Design = {
  id: DesignId;
  name: string;
  tagline: string;
  // De onde vem a ideia (bibliotecas e produtos de referência).
  mix: string;
  fonts: string;
  // Amostras de cor para o cartão da prévia: fundo, superfície, destaque, apoio.
  swatches: { dark: string[]; light: string[] };
  // "light": direção leve; ao aplicar, o hub vai para o claro (o escuro dela é suave).
  prefers?: "light";
};

export const DESIGNS: Design[] = [
  {
    id: "ceu",
    name: "Céu",
    tagline: "Arejado e leve: branco com azul-céu, degradês suaves no fundo, sombras macias e texto azul-marinho em vez de preto.",
    mix: "Stripe + Linear (claro) + Magic UI (degradês)",
    fonts: "Sora · Manrope · DM Mono",
    swatches: { light: ["#f8fbfe", "#ffffff", "#3d8fe0", "#c9b8f2"], dark: ["#283445", "#2f3c4f", "#7cbcf0", "#9a8fd8"] },
    prefers: "light",
  },
  {
    id: "argila",
    name: "Argila",
    tagline: "Pastel e amigável: lavanda e menta, cantos bem redondos, botões em pílula e cartões com sombra de massinha.",
    mix: "Claymorphism + Uiverse + Fredoka (títulos)",
    fonts: "Fredoka · Nunito · DM Mono",
    swatches: { light: ["#f5f2fb", "#fefdff", "#8a6de0", "#9fdcc2"], dark: ["#332c47", "#3b3452", "#b9a5f2", "#8fd3b4"] },
    prefers: "light",
  },
  {
    id: "revista",
    name: "Revista",
    tagline: "Editorial de moda: fundo off-white, títulos enormes e condensados em caixa alta, filetes pretos e vermelho-carmim.",
    mix: "Kinfolk + Bloomberg + Codrops (tipografia)",
    fonts: "Anton · Manrope · DM Mono",
    swatches: { light: ["#fbfaf7", "#ffffff", "#c42b46", "#1f1d1c"], dark: ["#2b2826", "#33302e", "#e2566c", "#f3f1ec"] },
    prefers: "light",
  },
  {
    id: "marfim",
    name: "Marfim",
    tagline: "Luxo leve: marfim com azul-marinho, filete dourado nos cartões e títulos em serifa clássica.",
    mix: "Aesop + Mantine + editorial clássico",
    fonts: "Cormorant Garamond · Outfit · DM Mono",
    swatches: { light: ["#f9f6ee", "#fdfbf6", "#2c3d66", "#d4b46a"], dark: ["#2b3348", "#323b52", "#e3cd8e", "#f5f0e3"] },
    prefers: "light",
  },
  {
    id: "blush",
    name: "Blush",
    tagline: "Branco rosado com rosa vivo, brilho suave no topo e botões que brilham de leve. Moderno sem pesar.",
    mix: "Raycast + Dribbble + Aceternity (brilho)",
    fonts: "Syne · Outfit · DM Mono",
    swatches: { light: ["#fdf8fa", "#ffffff", "#e0457f", "#6fcfb1"], dark: ["#382b33", "#41323b", "#f290b6", "#7fd6bb"] },
    prefers: "light",
  },
  {
    id: "menta",
    name: "Menta",
    tagline: "Minimalista e fresco: branco, cinza suave e verde-menta. Limpo, calmo e fácil de ler o dia inteiro.",
    mix: "Notion + Linear (claro) + shadcn (estrutura)",
    fonts: "Sora · Sora · DM Mono",
    swatches: { light: ["#f8fcfa", "#ffffff", "#2ea98a", "#2d3a40"], dark: ["#283538", "#2f3d41", "#7cd6bd", "#eef7f3"] },
    prefers: "light",
  },
  {
    id: "lima",
    name: "Precisão",
    tagline: "Grafite quase preto, linhas finas, grade de pontos e verde-lima ácido como destaque. Títulos em serifa editorial.",
    mix: "Linear + Vercel (Geist UI) + Aceternity (grade e spotlight)",
    fonts: "Instrument Serif · Hanken Grotesk · JetBrains Mono",
    swatches: { dark: ["#0d0e0b", "#17181a", "#c8f24a", "#5ad1e6"], light: ["#fbfbf8", "#ffffff", "#9fd21c", "#1aa3bd"] },
  },
  {
    id: "poster",
    name: "Pôster",
    tagline: "Neo-brutalista: bordas grossas, sombras duras deslocadas, creme com azul elétrico e amarelo. Cara de peça de campanha.",
    mix: "Neobrutalism (cult-ui / neobrutalism.dev) + Gumroad + HyperUI",
    fonts: "Archivo Black · Space Grotesk · Space Mono",
    swatches: { dark: ["#1d1b16", "#26241e", "#4d6bff", "#ffd84d"], light: ["#f6f0e1", "#fffdf6", "#2f4bff", "#ffd23f"] },
  },
  {
    id: "ilha",
    name: "Ilha de Edição",
    tagline: "Ferramenta de pós-produção: azul-ardósia profundo, painéis densos, cantos retos, ciano de timeline e rótulos técnicos.",
    mix: "DaVinci Resolve + Frame.io + Mantine (densidade de painel)",
    fonts: "IBM Plex Sans Condensed · IBM Plex Sans · IBM Plex Mono",
    swatches: { dark: ["#0f1520", "#151c29", "#3fd0e8", "#e05aa8"], light: ["#eef1f5", "#fafbfc", "#0f8fa8", "#c23d8a"] },
  },
  {
    id: "papel",
    name: "Papel & Tinta",
    tagline: "Editorial e quente: papel com textura, tinta marrom-escura, verde-floresta e mostarda. Títulos em serifa variável.",
    mix: "Notion + Arc + Flowbite (formulários) + Codrops (tipografia)",
    fonts: "Fraunces · Instrument Sans · JetBrains Mono",
    swatches: { dark: ["#1f1a15", "#29231d", "#5fbf95", "#d9b44a"], light: ["#f7f2e8", "#fffcf5", "#2f7a57", "#c9971f"] },
  },
  {
    id: "suico",
    name: "Suíço",
    tagline: "Estilo tipográfico internacional: preto e branco puros, grade rígida, cantos retos e azul Klein como única cor.",
    mix: "Swiss design + Vercel + shadcn (estrutura)",
    fonts: "Archivo (800) · Archivo · JetBrains Mono",
    swatches: { dark: ["#0b0b0b", "#151515", "#4c5cff", "#ffffff"], light: ["#fcfcfc", "#ffffff", "#1e2fd8", "#111111"] },
  },
  {
    id: "atual",
    name: "Antigo",
    tagline: "O visual de antes (shadcn padrão, grafite azulado e coral), para comparar.",
    mix: "shadcn/ui",
    fonts: "Bricolage Grotesque · Geist · Geist Mono",
    swatches: { dark: ["#1b1d24", "#23262e", "#f0715a", "#3fbf8f"], light: ["#f6f7fa", "#ffffff", "#e0573f", "#2e9c74"] },
  },
];

// Design padrão do hub (escolha do usuário em 2026-10-06): Suíço. Vale em qualquer navegador sem escolha salva.
export const DEFAULT_DESIGN: DesignId = "suico";
export const DESIGN_KEY = "hub-design";
export const isDesign = (v: unknown): v is DesignId => DESIGNS.some((d) => d.id === v);
