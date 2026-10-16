"use client";

import { useEffect } from "react";

import { useLayoutMode } from "@/hooks/use-mobile";

const HOLOFOTE = '[data-slot="card"], .hub-spot';

// Holofote que segue o ponteiro nos cartões (--spot-x/--spot-y), como no Ownly e na Cifra.
export function useHolofote() {
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    let quadro = 0;
    let ultimo: PointerEvent | null = null;
    const pintar = () => {
      quadro = 0;
      const cartao = (ultimo?.target as Element | null)?.closest?.(HOLOFOTE) as HTMLElement | null;
      if (!ultimo || !cartao) return;
      const caixa = cartao.getBoundingClientRect();
      cartao.style.setProperty("--spot-x", `${ultimo.clientX - caixa.left}px`);
      cartao.style.setProperty("--spot-y", `${ultimo.clientY - caixa.top}px`);
    };
    const mover = (e: PointerEvent) => {
      ultimo = e;
      if (!quadro) quadro = requestAnimationFrame(pintar);
    };
    document.addEventListener("pointermove", mover, { passive: true });
    return () => {
      document.removeEventListener("pointermove", mover);
      cancelAnimationFrame(quadro);
    };
  }, []);
}

// Efeitos da moldura do hub, sem nada na tela:
// - marca no <html> se está na versão celular ou computador (a altura das telas de trabalho depende disso) e,
//   com a versão celular forçada numa tela larga, a coluna do tamanho de um celular;
// - o holofote dos cartões.
export function ShellEffects() {
  const { isMobile, isNarrow } = useLayoutMode();

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.layout = isMobile ? "mobile" : "desktop";
    html.toggleAttribute("data-mobile-frame", isMobile && !isNarrow);
  }, [isMobile, isNarrow]);

  useHolofote();
  return null;
}
