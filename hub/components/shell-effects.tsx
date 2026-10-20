"use client";

import { useEffect } from "react";

import { useIsMobile } from "@/hooks/use-mobile";

// Escolha antiga do botão "Versão celular/computador", que saiu do menu: apagada para não prender ninguém numa versão.
const ESCOLHA_ANTIGA = "hub:layout-mode";

// Marca no <html> se está na versão celular ou computador (segue a largura da tela). Não desenha nada.
export function ShellEffects() {
  const isMobile = useIsMobile();

  useEffect(() => {
    try {
      localStorage.removeItem(ESCOLHA_ANTIGA);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.dataset.layout = isMobile ? "mobile" : "desktop";
  }, [isMobile]);

  return null;
}
