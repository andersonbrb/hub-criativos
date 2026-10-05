// Dados de exemplo do protótipo. Na versão real, isso vem do banco e das chamadas MCP.

export type Status = "ok" | "run" | "idle" | "warn";

export type Tool =
  | "Claude"
  | "Copy Miner"
  | "Ad Library"
  | "ElevenLabs"
  | "HeyGen"
  | "FLORA"
  | "Higgsfield"
  | "Hub";

export type ChatMessage = { from: "me" | "ai" | "tool"; text: string };

export type Deliverable =
  | { kind: "text"; label: string; text: string; meta: string }
  | { kind: "audio"; label: string; duration: string; recommended?: boolean }
  | { kind: "video"; label: string; meta: string; status: Status };

export type Agent = {
  id: string;
  name: string;
  short: string;
  status: Status;
  meta?: string;
  role: string;
  tools: Tool[];
  chat: ChatMessage[];
  deliverables: Deliverable[];
};

export const project = {
  product: "SonoLeve",
  campaign: "Campanha Out/26",
  code: "CR-014",
  title: "Gancho “café”",
  format: "UGC 9:16",
  duration: "00:30",
  variations: "3 ganchos × 2 CTAs",
  platforms: "Meta · TikTok",
  cost: "US$ 4,82",
};

export const agents: Agent[] = [
  {
    id: "estrategista",
    name: "Estrategista",
    short: "ES",
    status: "ok",
    meta: "feito",
    role: "Lê a página de vendas e os anúncios de referência, define avatar, dores e ângulos.",
    tools: ["Claude", "Copy Miner", "Ad Library"],
    chat: [
      { from: "me", text: "Analisa a página do SonoLeve e os 3 anúncios mais escalados do nicho de sono." },
      { from: "tool", text: "copy_miner.list_pains(produto: \"SonoLeve\") → 14 dores" },
      {
        from: "ai",
        text: "Avatar principal: mulher 30–45, trabalha em casa, toma 3+ cafés por dia e acorda cansada.\n\nÂngulos com mais tração:\n1. Café como vilão escondido do sono\n2. “Dormi 8h e acordei destruída”\n3. Rotina noturna em 2 minutos",
      },
      { from: "me", text: "Segue com o ângulo 1 pro CR-014." },
    ],
    deliverables: [
      { kind: "text", label: "Avatar", text: "Mulher 30–45, home office, dependente de café, sono leve e fragmentado.", meta: "Copy Miner" },
      { kind: "text", label: "Ângulo escolhido", text: "Café como vilão escondido do sono", meta: "Claude" },
      { kind: "text", label: "Objeção-chave", text: "“Já tentei melatonina e me deixa grogue”", meta: "Copy Miner" },
    ],
  },
  {
    id: "copy",
    name: "Copy",
    short: "CP",
    status: "ok",
    meta: "3 ganchos",
    role: "Escreve ganchos, body e CTA a partir do ângulo. Gera variações para teste A/B.",
    tools: ["Claude", "Copy Miner"],
    chat: [
      { from: "me", text: "3 ganchos de até 3s pro ângulo do café. Tom de conversa, UGC." },
      { from: "tool", text: "copy_miner.list_validated_ugcs(produto: \"SonoLeve\") → 9 narrações validadas" },
      { from: "ai", text: "Usei a estrutura das 2 UGCs que mais escalaram como base. Ganchos prontos ao lado. O body tem 22s e fecha com CTA de frete grátis." },
      { from: "me", text: "Gancho B ficou ótimo. Deixa o A mais agressivo." },
    ],
    deliverables: [
      { kind: "text", label: "Gancho A", text: "“Seu café das 16h está roubando 2 horas do seu sono.”", meta: "3,1s" },
      { kind: "text", label: "Gancho B", text: "“Eu parei de tomar café por 7 dias… e olha o que aconteceu.”", meta: "2,8s" },
      { kind: "text", label: "Gancho C", text: "“Ninguém te conta isso sobre cafeína e insônia.”", meta: "2,6s" },
      { kind: "text", label: "Body", text: "Na primeira noite eu já senti diferença. Comecei a usar o SonoLeve 30 minutos antes de deitar…", meta: "22s" },
    ],
  },
  {
    id: "vsl",
    name: "VSL",
    short: "VS",
    status: "idle",
    role: "Monta roteiros longos de VSL: lead, história, mecanismo, prova, oferta e fechamento.",
    tools: ["Claude", "Copy Miner"],
    chat: [{ from: "ai", text: "Pronto para montar a VSL do SonoLeve. Uso o ângulo do café do CR-014 ou começo de um novo?" }],
    deliverables: [
      {
        kind: "text",
        label: "Estrutura sugerida",
        text: "Lead (0:00–0:45) · História (0:45–3:10) · Mecanismo (3:10–5:00) · Prova · Oferta · Garantia",
        meta: "~9 min",
      },
    ],
  },
  {
    id: "voz",
    name: "Voz",
    short: "VZ",
    status: "ok",
    meta: "3 takes",
    role: "Gera a narração com voz clonada ou de biblioteca, ajusta ritmo e entonação.",
    tools: ["ElevenLabs"],
    chat: [
      { from: "me", text: "Narração do gancho B + body com a voz da Camila, ritmo de conversa." },
      { from: "tool", text: "elevenlabs.creative_generate_speech(voice: \"Camila – UGC\", 412 caracteres)" },
      { from: "ai", text: "3 takes gerados. O take 2 tem pausa natural depois de “7 dias”. Recomendo ele." },
    ],
    deliverables: [
      { kind: "audio", label: "Take 1", duration: "00:24.6" },
      { kind: "audio", label: "Take 2", duration: "00:25.1", recommended: true },
      { kind: "audio", label: "Take 3", duration: "00:24.2" },
    ],
  },
  {
    id: "avatar",
    name: "Avatar UGC",
    short: "AV",
    status: "run",
    meta: "68%",
    role: "Cria o avatar falando o roteiro com lipsync sobre a narração aprovada.",
    tools: ["HeyGen"],
    chat: [
      { from: "me", text: "Avatar da Júlia, look cozinha de manhã, lipsync no take 2." },
      { from: "tool", text: "heygen.create_video_from_avatar(look: \"Júlia – cozinha\", audio: take_2.mp3, 9:16)" },
      { from: "ai", text: "Renderizando. Previsão: ~3 min. Aviso quando terminar e já mando pro editor." },
    ],
    deliverables: [
      { kind: "video", label: "Gancho B · Júlia", meta: "render 68%", status: "run" },
      { kind: "video", label: "Body · Júlia", meta: "na fila", status: "idle" },
      { kind: "video", label: "CTA · Júlia", meta: "pronto", status: "ok" },
    ],
  },
  {
    id: "b-rolls",
    name: "B-rolls",
    short: "BR",
    status: "run",
    meta: "4/6",
    role: "Gera cenas de apoio: produto, rotina, antes/depois. Imagem para vídeo.",
    tools: ["FLORA", "Higgsfield"],
    chat: [
      { from: "me", text: "6 b-rolls pro body: close do frasco, xícara de café à tarde, mulher acordando descansada." },
      { from: "tool", text: "flora.create_generations(6 prompts, 9:16) · custo estimado US$ 1,62" },
      { from: "ai", text: "4 prontos, 2 renderizando. O “antes/depois” saiu melhor no Higgsfield, gerei lá." },
    ],
    deliverables: [
      { kind: "video", label: "Frasco close-up", meta: "FLORA · 4s", status: "ok" },
      { kind: "video", label: "Xícara 16h", meta: "FLORA · 3s", status: "ok" },
      { kind: "video", label: "Acordando", meta: "Higgsfield · 4s", status: "ok" },
      { kind: "video", label: "Antes/depois", meta: "Higgsfield · 5s", status: "ok" },
      { kind: "video", label: "Rotina noturna", meta: "renderizando", status: "run" },
      { kind: "video", label: "Mesa home office", meta: "renderizando", status: "run" },
    ],
  },
  {
    id: "estaticos",
    name: "Estáticos",
    short: "ET",
    status: "idle",
    role: "Criativos de imagem: feed, stories e carrossel a partir do mesmo ângulo.",
    tools: ["FLORA"],
    chat: [{ from: "ai", text: "Posso gerar 4 estáticos 4:5 com o gancho C como headline. Quer que eu use o frasco do b-roll como base?" }],
    deliverables: [
      { kind: "text", label: "Formatos", text: "1080×1350 feed · 1080×1920 stories · carrossel 5 cards", meta: "FLORA" },
    ],
  },
  {
    // Instruções reais em lib/agent-profiles.ts (este array só alimenta o menu lateral).
    id: "transcricao",
    name: "Transcrição",
    short: "TR",
    status: "idle",
    role: "Transcreve vídeos e áudios e identifica o idioma falado.",
    tools: ["ElevenLabs", "Hub"],
    chat: [],
    deliverables: [],
  },
];

export const getAgent = (id: string) => agents.find((a) => a.id === id);

export type Stage = {
  num: string;
  name: string;
  href?: string;
  status: Status;
  output: string;
  tools: string;
  progress?: number;
};

export const stages: Stage[] = [
  { num: "01", name: "Estratégia", href: "/agentes/estrategista", status: "ok", output: "Ângulo: café como vilão do sono", tools: "Claude · Copy Miner" },
  { num: "02", name: "Copy", href: "/agentes/copy", status: "ok", output: "3 ganchos + body 22s + CTA", tools: "Claude" },
  { num: "03", name: "Voz", href: "/agentes/voz", status: "ok", output: "Take 2 aprovado · 25,1s", tools: "ElevenLabs" },
  { num: "04", name: "Avatar UGC", href: "/agentes/avatar", status: "run", output: "Gancho B renderizando", tools: "HeyGen", progress: 68 },
  { num: "05", name: "B-rolls", href: "/agentes/b-rolls", status: "run", output: "4 de 6 cenas prontas", tools: "FLORA · Higgsfield", progress: 66 },
  { num: "06", name: "Edição", href: "/editor", status: "ok", output: "v3 montada · aguardando avatar", tools: "Hub" },
  { num: "07", name: "Revisão", status: "idle", output: "Link para o gestor de tráfego", tools: "Hub" },
  { num: "08", name: "Export", status: "idle", output: "6 variações 9:16", tools: "Hub" },
];

export const variations: { hook: string; text: string; copy: Status; avatar: Status; edit: Status }[] = [
  { hook: "A", text: "Seu café das 16h…", copy: "ok", avatar: "ok", edit: "run" },
  { hook: "B", text: "Eu parei de tomar café…", copy: "ok", avatar: "run", edit: "run" },
  { hook: "C", text: "Ninguém te conta isso…", copy: "ok", avatar: "idle", edit: "idle" },
];

// Editor: tempos em segundos
export type TrackKind = "avatar" | "broll" | "voz" | "leg" | "mus";
export type Clip = { start: number; end: number; label: string; source: string };
export type Track = { kind: TrackKind; name: string; agent?: string; clips: Clip[] };

export const FPS = 30;
export const DURATION = 30;

export const tracks: Track[] = [
  {
    kind: "avatar",
    name: "Avatar",
    agent: "avatar",
    clips: [
      { start: 0, end: 3, label: "Gancho B · Júlia", source: "HeyGen" },
      { start: 3, end: 9, label: "Body · Júlia", source: "HeyGen" },
      { start: 22, end: 30, label: "CTA · Júlia", source: "HeyGen" },
    ],
  },
  {
    kind: "broll",
    name: "B-roll",
    agent: "b-rolls",
    clips: [
      { start: 9, end: 13, label: "Xícara 16h", source: "FLORA" },
      { start: 13, end: 17, label: "Frasco close-up", source: "FLORA" },
      { start: 17, end: 22, label: "Antes/depois", source: "Higgsfield" },
    ],
  },
  {
    kind: "voz",
    name: "Narração",
    agent: "voz",
    clips: [{ start: 0, end: 25.1, label: "Take 2 · voz Camila", source: "ElevenLabs" }],
  },
  {
    kind: "leg",
    name: "Legendas",
    clips: [
      { start: 0, end: 3, label: "Eu parei de tomar *café* por 7 dias", source: "Hub" },
      { start: 3, end: 9, label: "e olha o que aconteceu com meu *sono*", source: "Hub" },
      { start: 9, end: 13, label: "o café das 4 da tarde era o *vilão*", source: "Hub" },
      { start: 13, end: 17, label: "aí comecei o *SonoLeve*", source: "Hub" },
      { start: 17, end: 22, label: "na 1ª noite já *apaguei*", source: "Hub" },
      { start: 22, end: 30, label: "*frete grátis* no link", source: "Hub" },
    ],
  },
  {
    kind: "mus",
    name: "Trilha",
    clips: [{ start: 0, end: 30, label: "Lo-fi manhã · −18 dB", source: "Biblioteca" }],
  },
];
