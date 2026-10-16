// Contrato do Drive: os vídeos gerados moram SÓ no Google Drive de uma conta Google, numa pasta "Hub de Criativos"
// com uma subpasta por tipo. O disco do hub guarda apenas cópias temporárias para processar (ffmpeg, Python, envio
// ao HeyGen), apagadas depois. As telas tocam e baixam pelo /api/media/<file>, que busca no Drive.
// Arquivo puro (sem código de servidor). Funções em features/drive/servicos/{conta,arquivos,videos}.ts.
//
// Acesso: escopo drive.file (o hub só enxerga o que ele mesmo criou). Não exige verificação do app no Google, então
// o login não vence a cada 7 dias. O que alguém apagar, renomear ou mandar para a lixeira nesses arquivos aparece no
// hub (espelho). Arquivos postos à mão na pasta não aparecem.

export const PASTA_RAIZ = "Hub de Criativos";

export const PASTAS = {
  "edicao-final": "Edição final",
  batida: "Edição na batida",
  editor: "Editor",
  traducao: "Tradução",
  "sem-legenda": "Sem legenda",
  broll: "B-rolls (FLORA)",
  avatar: "Avatar (HeyGen)",
  entregas: "Entregas do Claude",
  outros: "Outros",
} as const;

export type PastaDoDrive = keyof typeof PASTAS;

export type ArquivoDrive = {
  id: string;
  nome: string;
  mimeType: string;
  tamanho: number;
  modificadoEm: string;
  noLixo: boolean;
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
