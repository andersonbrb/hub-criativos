// Contrato do YouTube: cada organização conecta o próprio canal (login do Google na tela Integrações) e envia para
// ele os vídeos prontos do hub, na hora ou agendados. Nada sobe sozinho: o envio sempre parte do botão "Enviar para o
// YouTube" de um vídeo pronto.
// Arquivo puro (sem código de servidor): a tela importa. Serviços em features/youtube/servicos/{conta,envios}.ts.
//
// O login usa o mesmo cliente OAuth do Google do card do Google Drive (Integrações), com as permissões do YouTube.
// A conexão é separada da do Drive: o canal pode ser de outra conta Google (ou de uma conta de marca).

export const VISIBILIDADES = {
  public: { rotulo: "Público", dica: "Qualquer pessoa encontra e assiste." },
  unlisted: { rotulo: "Não listado", dica: "Só quem tem o link assiste." },
  private: { rotulo: "Privado", dica: "Só quem administra o canal vê." },
} as const;

export type Visibilidade = keyof typeof VISIBILIDADES;

// hasOwn, e não "in": "toString" in {} é true.
export const ehVisibilidade = (v: unknown): v is Visibilidade => typeof v === "string" && Object.hasOwn(VISIBILIDADES, v);

// agendado: espera a hora marcada no hub (nada vai ao YouTube antes). enviando: subindo agora (ou na vez dele).
export const SITUACOES = {
  agendado: "Agendado",
  enviando: "Enviando",
  enviado: "Enviado",
  falhou: "Falhou",
  cancelado: "Cancelado",
} as const;

export type SituacaoDoEnvio = keyof typeof SITUACOES;

// Limites do próprio YouTube para o título e a descrição (a descrição é em bytes; 5000 caracteres cobre o comum).
export const TITULO_MAXIMO = 100;
export const DESCRICAO_MAXIMA = 5000;
// Miniatura: JPG ou PNG. O YouTube aceita até 50 MB; 10 MB cobre qualquer imagem de 1280x720.
export const MINIATURA_MAXIMA = 10 * 1024 * 1024;
export const TIPOS_DE_MINIATURA = ["image/jpeg", "image/png"] as const;
// Agendamento: a partir de 2 minutos à frente e até 1 ano.
export const ANTECEDENCIA_MINIMA_MS = 2 * 60_000;
export const AGENDAMENTO_MAXIMO_MS = 365 * 24 * 60 * 60_000;

export type CanalDoYoutube = { id: string; titulo: string; foto: string | null; endereco: string };

// Card do YouTube em Integrações. `canal` sem `conectado`: a conexão parou de valer e precisa de um login novo.
export type StatusYoutube = { configurado: boolean; conectado: boolean; canal: CanalDoYoutube | null };

// Botão "Enviar para o YouTube" dos vídeos prontos: aparece só para quem pode enviar.
export type EstadoDoEnvio = { podeEnviar: boolean; conectado: boolean; canal: CanalDoYoutube | null };

export type EnvioYoutube = {
  id: string;
  geracaoId: string;
  titulo: string;
  visibilidade: Visibilidade;
  shorts: boolean;
  temMiniatura: boolean;
  // ISO. null: enviar na hora.
  agendadoPara: string | null;
  situacao: SituacaoDoEnvio;
  // 0 a 100 enquanto sobe; null quando ainda está esperando a vez.
  progresso: number | null;
  link: string | null;
  // Por que falhou, em linguagem simples.
  erro: string | null;
  // Deu certo, mas com uma ressalva (miniatura não aplicada, o YouTube deixou privado...).
  aviso: string | null;
  canal: string;
  criadoEm: string;
  enviadoEm: string | null;
};

export const linkDoVideo = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const linkDoCanal = (id: string) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
