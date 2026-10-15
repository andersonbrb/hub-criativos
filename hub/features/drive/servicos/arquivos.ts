import "server-only";

import type { ArquivoDrive, PastaDoDrive, Trecho } from "@/features/drive/contrato";

// Arquivos no Drive (API v3 por fetch, com o token de conta.ts). Contrato estável: as assinaturas não mudam.
// Implementação: agente Arquivos do Drive.

// Sobe um arquivo local (em pedaços, sem carregar inteiro na memória) para a subpasta do tipo, criando
// "Hub de Criativos/<subpasta>" se faltar. Não apaga o arquivo local: quem chamou decide.
export async function enviarArquivo(caminhoLocal: string, opcoes: { nome: string; pasta: PastaDoDrive; mimeType: string }): Promise<ArquivoDrive> {
  void caminhoLocal, opcoes;
  throw new Error("Em construção: enviarArquivo.");
}

// Para o player e o download: repassa o Range pedido pelo navegador.
export async function abrirTrecho(id: string, range: string | null): Promise<Trecho> {
  void id, range;
  throw new Error("Em construção: abrirTrecho.");
}

// Baixa para uma pasta temporária (com cache por id) e devolve o caminho local. Para ffmpeg, Python e envios.
export async function baixarParaTemp(id: string, extensao: string): Promise<string> {
  void id, extensao;
  throw new Error("Em construção: baixarParaTemp.");
}

export async function moverParaLixeira(id: string): Promise<void> {
  void id;
  throw new Error("Em construção: moverParaLixeira.");
}

export async function renomear(id: string, nome: string): Promise<void> {
  void id, nome;
  throw new Error("Em construção: renomear.");
}

// Situação atual de vários arquivos de uma vez (o espelho usa para achar apagados, na lixeira e renomeados).
// Ids que o Google não encontra (apagados de vez) não vêm no resultado.
export async function situacao(ids: string[]): Promise<ArquivoDrive[]> {
  void ids;
  throw new Error("Em construção: situacao.");
}
