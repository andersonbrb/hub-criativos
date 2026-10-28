"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

// Vídeo de lista (Biblioteca, Fluxo, estúdios, editor) que só começa a carregar quando chega perto da tela.
// Cada vídeo vem do Google Drive passando pelo servidor do hub. Uma tela com 200 vídeos baixava dezenas de MB ao abrir,
// mesmo sem ninguém dar play, e deixava o servidor lento para todo mundo. Até chegar perto, o vídeo fica vazio, no
// mesmo tamanho (sem `src`, o navegador não baixa nada). Depois que carregou, continua carregado.
export function VideoNaTela({ src, preload = "metadata", ...props }: ComponentProps<"video">) {
  const ref = useRef<HTMLVideoElement>(null);
  const [perto, setPerto] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || perto) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        setPerto(true);
        observador.disconnect();
      },
      // Um pouco antes de aparecer, para o quadro já estar lá quando a pessoa rola.
      { rootMargin: "300px" },
    );
    observador.observe(video);
    return () => observador.disconnect();
  }, [perto]);

  return <video ref={ref} src={perto ? src : undefined} preload={preload} {...props} />;
}
