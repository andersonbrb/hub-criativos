/**
 * O que o editor de vídeo (Remotion) renderiza: o vídeo de base e os textos na tela, com os
 * tempos. Montado pelo diretor de edição; é também o `inputProps` da composição.
 */
export interface EditPlan {
  /** `null`: fundo escuro (pré-visualização e testes). */
  videoUrl: string | null;
  width: number;
  height: number;
  fps: number;
  durationInSeconds: number;
  style: {
    font: 'Montserrat' | 'Poppins' | 'Inter' | 'Lora' | 'Playfair Display';
    textColor: string;
    highlightColor: string;
    captionsPosition: 'bottom' | 'middle';
  };
  /** Gancho na tela nos primeiros segundos. */
  hook: { text: string; endSecond: number } | null;
  /** Título fixo no topo entre o gancho e o CTA. */
  headline: { text: string; startSecond: number; endSecond: number } | null;
  /** Cartão de chamada para ação no final. */
  cta: { text: string; startSecond: number } | null;
  /** Palavras faladas com o tempo (legendas sincronizadas). Vazio: sem legendas. */
  captions: { text: string; startMs: number; endMs: number }[];
  /** Palavras destacadas nas legendas (minúsculas, sem pontuação). */
  emphasis: string[];
}

export const EDIT_COMPOSITION_ID = 'AdaptedReel';
