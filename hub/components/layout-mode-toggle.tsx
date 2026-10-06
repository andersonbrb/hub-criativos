"use client";

import { useEffect } from "react";
import { Monitor, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayoutMode } from "@/hooks/use-mobile";

// Troca entre a versão celular (uma aba por vez, menu em gaveta) e a versão computador.
// Forçada numa tela larga, a versão celular aparece numa coluna central do tamanho de um celular.
export function LayoutModeToggle() {
  const { isMobile, isNarrow, toggle } = useLayoutMode();

  useEffect(() => {
    document.documentElement.toggleAttribute("data-mobile-frame", isMobile && !isNarrow);
  }, [isMobile, isNarrow]);

  const label = isMobile ? "Versão computador" : "Versão celular";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 px-2" aria-label={label} onClick={toggle}>
          {isMobile ? <Monitor /> : <Smartphone />}
          {!isMobile && <span className="hidden lg:inline">Celular</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
