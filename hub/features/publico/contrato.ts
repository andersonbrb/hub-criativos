// Páginas que abrem sem login: a apresentação do hub (a página inicial para quem não entrou) e a Política de
// Privacidade. O Google pede as duas, públicas e no domínio do hub, para liberar o login com Google (Drive e
// YouTube) em produção. Telas em features/publico/tela/.

// Quem responde pelo hub e pelos dados que ele guarda.
export const RESPONSAVEL = "Grupo Chegou";

// E-mail de contato da Política de Privacidade (dúvidas, revogação e pedidos de exclusão). Vazio até o dono escolher
// qual e-mail publicar: sem ele, a política mostra só o nome do responsável.
export const EMAIL_DE_CONTATO = "";

// Mude a data a cada mudança no texto da política (features/publico/tela/politica.tsx).
export const POLITICA_ATUALIZADA_EM = "20 de outubro de 2026";

export const CAMINHO_DA_POLITICA = "/privacidade";
