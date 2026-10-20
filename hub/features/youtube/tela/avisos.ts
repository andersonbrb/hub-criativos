// Avisos da volta do login do YouTube (/integracoes?youtube=conectado ou ?youtube=erro&motivo=<código>).
// Como no Drive, a URL leva só um código desta lista, nunca texto livre. Arquivo puro: a rota e o card importam.

export const AVISOS_DO_LOGIN = {
  cancelado: "Conexão com o YouTube cancelada. Nada mudou.",
  "pedido-vencido": "O pedido de conexão venceu ou já foi usado. Clique em Conectar de novo.",
  "outra-pessoa": "Esse retorno do Google foi pedido por outra conta do hub. Clique em Conectar com a sua conta.",
  "outra-organizacao": "Você trocou de organização no meio da conexão. Clique em Conectar de novo nesta organização.",
  "canal-em-outra-organizacao": "Esse canal já está conectado em outra organização do hub. Escolha outro canal.",
  "sem-permissao": "Faltou liberar o YouTube. Conecte de novo e deixe marcadas as permissões do YouTube na tela do Google.",
  "sem-canal": "Essa conta Google não tem canal no YouTube. Crie o canal no YouTube (ou escolha a conta do canal) e conecte de novo.",
  "sem-renovacao": "O Google não liberou o acesso permanente. Conecte de novo.",
  "api-desligada": "A API do YouTube não está ativada no projeto do Google Cloud do hub. Ative a YouTube Data API v3 e conecte de novo.",
  configuracao: "Falta configurar o cliente do Google. Veja o aviso no card do YouTube.",
  google: "O Google recusou a conexão. Tente de novo. Se repetir, confira o cliente OAuth do Google (docs/youtube.md).",
  erro: "Não deu para conectar o YouTube. Tente de novo.",
} as const;

export type MotivoDoLogin = keyof typeof AVISOS_DO_LOGIN;

export const ehMotivoDoLogin = (v: unknown): v is MotivoDoLogin => typeof v === "string" && Object.hasOwn(AVISOS_DO_LOGIN, v);
