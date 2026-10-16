// Contrato das chaves das integrações: o que se cola na tela Integrações em vez de virar variável do servidor.
// Arquivo puro (sem código de servidor): a tela importa. Serviços em features/integracoes/servicos/chaves.ts.
//
// Ficam aqui as chaves de API (Claude, Venice), as credenciais do cliente do Google (Drive) e a escolha do modelo do
// chat na nuvem. HeyGen, FLORA, ElevenLabs e Higgsfield não têm chave: entram pelo login da conta (MCP).
// Continuam como variáveis só as que o servidor precisa antes de abrir qualquer tela (banco, chave que cifra estes
// segredos, endereço público, donos).

export const CHAVES = {
  anthropic: {
    rotulo: "Chave da API da Anthropic",
    segredo: true,
    // Variável de antes desta tela. O valor dela entra sozinho na primeira leitura e a variável pode ser apagada.
    variavelAntiga: "ANTHROPIC_API_KEY",
  },
  venice: { rotulo: "Chave da API da Venice", segredo: true, variavelAntiga: "VENICE_API_KEY" },
  "google-client-id": { rotulo: "ID do cliente do Google", segredo: false, variavelAntiga: "GOOGLE_CLIENT_ID" },
  "google-client-secret": { rotulo: "Chave secreta do cliente do Google", segredo: true, variavelAntiga: "GOOGLE_CLIENT_SECRET" },
  // Abre a janela de pastas do Google (Picker) no navegador de quem escolhe a pasta do Drive. Não é segredo de verdade
  // (o Google a expõe ao navegador), mas a tela mostra só o final, como as outras.
  "google-api-key": { rotulo: "Chave de API do Google", segredo: true, variavelAntiga: "GOOGLE_API_KEY" },
  "modelo-api": { rotulo: "Modelo do chat na nuvem", segredo: false, variavelAntiga: "HUB_API_MODEL" },
} as const satisfies Record<string, { rotulo: string; segredo: boolean; variavelAntiga: string }>;

export type NomeDaChave = keyof typeof CHAVES;

export const ehNomeDaChave = (nome: string): nome is NomeDaChave => Object.hasOwn(CHAVES, nome);

// O que a tela pode saber de uma chave. Segredo nunca volta inteiro: só os 4 últimos caracteres, para a pessoa
// reconhecer qual chave está salva.
export type ResumoDaChave = { salva: boolean; mostra: string | null };

export type ResumoDasChaves = Record<NomeDaChave, ResumoDaChave>;

// Modelos que o chat na nuvem (API da Anthropic) pode usar. O primeiro é o padrão.
export const MODELOS_DA_API = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5 (melhor)" },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5 (mais barato)" },
] as const;

export const MODELO_PADRAO = MODELOS_DA_API[0].id;

export const TAMANHO_MAXIMO = 500;
