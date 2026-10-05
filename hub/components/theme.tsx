"use client";

import { useSyncExternalStore } from "react";

// Tema claro/escuro do hub (classe .dark no <html>), sem biblioteca: o THEME_SCRIPT (lib/theme-script.ts) roda no <head>
// antes da pintura (nada de "piscar" o tema errado) e o hook lê/alterna a classe. Escolha salva no navegador.

import { THEME_KEY as KEY } from "@/lib/theme-script";

export type Theme = "light" | "dark";
const EVENT = "hub-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function setTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "dark");
}
