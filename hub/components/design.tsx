"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_DESIGN, isDesign, type DesignId } from "@/lib/designs";
import { DESIGN_STORAGE_KEY } from "@/lib/theme-script";

// Direção de design do hub (data-design no <html>), escolhida em /design e salva no navegador.
// O THEME_SCRIPT aplica a escolha antes da primeira pintura.

const EVENT = "hub-design-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const read = (): DesignId => {
  const v = document.documentElement.getAttribute("data-design");
  return isDesign(v) ? v : DEFAULT_DESIGN;
};

export function setDesign(design: DesignId) {
  document.documentElement.setAttribute("data-design", design);
  try {
    localStorage.setItem(DESIGN_STORAGE_KEY, design);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useDesign(): DesignId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_DESIGN);
}
