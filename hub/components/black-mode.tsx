"use client";

import { useSyncExternalStore } from "react";
import { VenetianMask } from "lucide-react";

import { cn } from "@/lib/utils";

// Modo Black: liga o modelo venice-uncensored no chat principal e em todos os agentes.
// Um estado só para o hub inteiro, salvo no navegador e sincronizado entre páginas e abas.

const KEY = "hub-chat-black";
const EVENT = "hub-black-mode";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useBlackMode(): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const toggle = () => {
    const next = !read();
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(EVENT));
    // Sem aviso: o próprio botão (e a faixa do Modo Black) mostra o estado.
  };
  return [on, toggle];
}

export function BlackModeButton({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      title={on ? "Modo Black ativo: clique para voltar ao modo normal" : "Modo Black: troca para o modelo venice-uncensored"}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[0.8rem] font-medium transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        on
          ? "black-mode-glow bg-black font-bold tracking-wider text-white uppercase ring-2 ring-rec"
          : "text-foreground hover:bg-muted",
        className,
      )}
    >
      {on && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rec opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-rec" />
        </span>
      )}
      <VenetianMask className={cn("size-3.5", on && "text-rec")} />
      {on ? "Modo Black ativo" : "Modo Black"}
    </button>
  );
}

// Faixa acima do campo de mensagem enquanto o modo está ligado.
export function BlackModeBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2 rounded-lg bg-black px-3 py-1.5 text-xs text-white ring-1 ring-rec/60",
        className,
      )}
    >
      <VenetianMask className="size-3.5 shrink-0 text-rec" />
      <span>
        <b className="tracking-wider uppercase">Modo Black</b> · venice-uncensored · só texto, sem as ferramentas do hub
      </span>
    </div>
  );
}

// Classes do contorno do campo de mensagem com o modo ligado.
export const blackComposerClass = "border-rec/70 shadow-[0_0_0_1px_var(--rec),0_0_22px_-4px_var(--rec)]";
