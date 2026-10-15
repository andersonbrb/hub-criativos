// Avisos da volta do login do Google (/integracoes?drive=conectado ou ?drive=erro&motivo=<código>).
// A URL leva só um código desta lista, nunca texto livre: assim um link montado por outra pessoa não consegue pôr
// uma mensagem qualquer na tela do hub. Arquivo puro: a rota (servidor) e o card (navegador) importam.

export const AVISOS_DO_LOGIN = {
  cancelado: "Conexão com o Google cancelada. Nada mudou.",
  "pedido-vencido": "O pedido de conexão venceu ou já foi usado. Clique em Conectar de novo.",
  "outra-pessoa": "Esse retorno do Google foi pedido por outra conta do hub. Clique em Conectar com a sua conta.",
  "sem-drive": "Faltou liberar o Google Drive. Conecte de novo e deixe marcada a opção do Drive na tela do Google.",
  "sem-renovacao": "O Google não liberou o acesso permanente. Conecte de novo.",
  configuracao: "Falta configurar o Google Drive no servidor. Veja o aviso no card do Google Drive.",
  google: "O Google recusou a conexão. Tente de novo. Se repetir, confira o cliente OAuth do Google (docs/google-drive.md).",
  erro: "Não deu para conectar o Google Drive. Tente de novo.",
} as const;

export type MotivoDoLogin = keyof typeof AVISOS_DO_LOGIN;

// hasOwn, e não "in": "toString" in {} é true.
export const ehMotivoDoLogin = (v: unknown): v is MotivoDoLogin => typeof v === "string" && Object.hasOwn(AVISOS_DO_LOGIN, v);
