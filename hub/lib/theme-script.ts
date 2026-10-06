// Script do <head> que aplica o tema salvo antes da primeira pintura (sem "piscar" o tema errado).
// Fica fora de componentes "use client" para o layout (servidor) conseguir importar o texto.
export const THEME_KEY = "hub-theme";

// O design é fixo (Suíço); a escolha antiga da aba Aparência ("hub-design"), removida, é apagada do navegador.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")==="light"?"light":"dark";var d=document.documentElement;d.classList.toggle("dark",t==="dark");d.style.colorScheme=t;localStorage.removeItem("hub-design")}catch(e){document.documentElement.classList.add("dark")}`;
