// Idiomas dos criativos (lista única, usada no chat, nos estúdios e na montagem).
// Para acrescentar um idioma, inclua aqui: id = código ISO usado pelo Whisper/ElevenLabs.

export type CreativeLanguage = {
  id: "pt" | "es" | "fr" | "en";
  label: string;
  // Como o agente deve escrever (vai na nota da mensagem do chat).
  prompt: string;
  // Fala nos prompts de vídeo (FLORA), em inglês.
  speech: string;
  // Nome no HeyGen (filtro de vozes).
  heygen: string;
};

export const CREATIVE_LANGUAGES: CreativeLanguage[] = [
  { id: "pt", label: "Português", prompt: "português do Brasil", speech: "Brazilian Portuguese", heygen: "Portuguese" },
  { id: "es", label: "Espanhol", prompt: "espanhol latino-americano (com o sotaque e as gírias do país do mercado, se ele for informado)", speech: "Latin American Spanish", heygen: "Spanish" },
  { id: "fr", label: "Francês", prompt: "francês", speech: "French", heygen: "French" },
  { id: "en", label: "Inglês", prompt: "inglês americano", speech: "American English", heygen: "English" },
];

export const getLanguage = (id: unknown) => CREATIVE_LANGUAGES.find((l) => l.id === id);

// Nota anexada à mensagem do chat quando o usuário escolhe o idioma do criativo (o chat esconde da bolha).
export const LANG_NOTE = "\n\n[Idioma do criativo: ";

export const languageNote = (id: unknown) => {
  const lang = getLanguage(id);
  return lang
    ? `${LANG_NOTE}${lang.label}. Tudo que vai para o anúncio (ganchos, falas, roteiro, texto na tela, narração, legendas e a fala nos prompts de vídeo) sai em ${lang.prompt}. Continue conversando comigo em português.]`
    : "";
};
