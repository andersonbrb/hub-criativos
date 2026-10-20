import * as React from "react";

// Pontos de troca de layout do hub: os mesmos do Tailwind (sm 640, md 768, lg 1024, xl 1280, 2xl 1536), para o CSS
// e o código trocarem juntos em todas as telas.
// - Abaixo de 1024 (celular em pé ou deitado, tablet em pé): o menu vira gaveta e as telas de trabalho (chat,
//   estúdios, editor, Fluxo) mostram um painel por vez, escolhido em abas. Classes `lg:` no CSS.
// - De 1024 a 1279 (tablet deitado, notebook pequeno): menu só com ícones, para sobrar espaço aos painéis. `xl:`.
// - A partir de 1280 (notebook e computador): tudo aberto, como sempre.
// - Altura até 500 (celular deitado): barras mais baixas. Variante `baixa:` (app/globals.css).
export const TELA_COMPACTA = "(max-width: 1023.98px)";
export const TELA_MEDIA = "(min-width: 1024px) and (max-width: 1279.98px)";

function useMidia(consulta: string) {
  return React.useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia(consulta).matches,
    // No servidor não há tela: desenha a versão de computador e acerta logo depois de abrir.
    () => false,
  );
}

// Celular e tablet em pé: menu em gaveta e um painel por vez.
export const useTelaCompacta = () => useMidia(TELA_COMPACTA);

// Tablet deitado e notebook pequeno: menu recolhido em ícones.
export const useTelaMedia = () => useMidia(TELA_MEDIA);
