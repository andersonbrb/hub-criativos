"use client";

import { useEffect } from "react";

import { useLayoutMode } from "@/hooks/use-mobile";

// Marca no <html> se está na versão celular ou computador e, com a versão celular forçada numa tela larga, liga a
// coluna do tamanho de um celular (app/globals.css). Não desenha nada.
export function ShellEffects() {
  const { isMobile, isNarrow } = useLayoutMode();

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.layout = isMobile ? "mobile" : "desktop";
    html.toggleAttribute("data-mobile-frame", isMobile && !isNarrow);
  }, [isMobile, isNarrow]);

  return null;
}
