// Contrato do Drive (regra do dono): todo vídeo do hub, gerado ou enviado pela equipe, mora SÓ no Google Drive de uma
// conta Google, numa pasta "Hub de Criativos" com uma subpasta por tipo. O disco do hub guarda apenas cópias
// temporárias para processar (ffmpeg, Python, envio ao Drive, ao HeyGen ou ao YouTube), apagadas logo depois e nunca
// por mais de 12 horas (PRAZO_MAXIMO_NO_HUB_MS). As telas tocam e baixam pelo /api/media/<file>, que busca no Drive.
// Sem Drive conectado, a organização não gera nem recebe vídeo.
// Arquivo puro (sem código de servidor). Funções em features/drive/servicos/{conta,arquivos,videos}.ts.
//
// Acesso: escopo drive.file (o hub só enxerga o que ele mesmo criou). Não exige verificação do app no Google, então
// o login não vence a cada 7 dias. O que alguém apagar, renomear ou mandar para a lixeira nesses arquivos aparece no
// hub (espelho). Arquivos postos à mão na pasta não aparecem.

export const PASTA_RAIZ = "Hub de Criativos";

// O máximo que um vídeo fica no disco do hub: cópia temporária segura por um trabalho longo, ou vídeo novo que o
// Drive não aceitou na hora (o hub tenta de novo até esse prazo e depois descarta).
export const PRAZO_MAXIMO_NO_HUB_MS = 12 * 60 * 60 * 1000;

export const PASTAS = {
  "edicao-final": "Edição final",
  batida: "Edição na batida",
  editor: "Editor",
  traducao: "Tradução",
  "sem-legenda": "Sem legenda",
  broll: "B-rolls (FLORA)",
  avatar: "Avatar (HeyGen)",
  entregas: "Entregas do Claude",
  enviados: "Enviados pela equipe",
  outros: "Outros",
  // Vídeos que estavam soltos no disco do hub, sem registro (sobras de antes da regra do dono): vão para cá em vez de
  // serem apagados sem ninguém ver.
  recuperados: "Recuperados do hub",
} as const;

export type PastaDoDrive = keyof typeof PASTAS;

export type ArquivoDrive = {
  id: string;
  nome: string;
  mimeType: string;
  tamanho: number;
  modificadoEm: string;
  noLixo: boolean;
  // Impressão digital (MD5) que o Google calcula do conteúdo: confere que o vídeo chegou inteiro antes de a cópia do
  // hub sair. Pode faltar (o Google nem sempre devolve); aí vale só o tamanho.
  md5?: string;
};

export type StatusDrive = {
  configurado: boolean; // GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET existem
  conectado: boolean;
  conta: { email: string; nome: string | null } | null;
  // Espaço da conta em bytes (null se o Google não informar, ou com a pasta num Drive compartilhado, que usa o espaço
  // da empresa e não o da conta).
  espaco: { usado: number; limite: number | null } | null;
  // Onde fica a pasta "Hub de Criativos": null = raiz do Meu Drive; senão a pasta escolhida na janela do Google.
  pasta: PastaEscolhida | null;
};

export type PastaEscolhida = { id: string; nome: string; compartilhado: boolean };

// Pedaço de arquivo para tocar no navegador (Range) ou baixar.
export type Trecho = { status: 200 | 206 | 416; cabecalhos: Record<string, string>; corpo: ReadableStream<Uint8Array> | null };
