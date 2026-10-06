// Script do <head> que aplica o tema salvo antes da primeira pintura (sem "piscar" o tema errado).
// Fica fora de componentes "use client" para o layout (servidor) conseguir importar o texto.
export const THEME_KEY = "hub-theme";
// Direção de design escolhida em /design (lib/designs.ts, app/designs.css).
export const DESIGN_STORAGE_KEY = "hub-design";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")==="light"?"light":"dark";var d=document.documentElement;d.classList.toggle("dark",t==="dark");d.style.colorScheme=t;var g=localStorage.getItem("${DESIGN_STORAGE_KEY}");if(g)d.setAttribute("data-design",g)}catch(e){document.documentElement.classList.add("dark")}`;
