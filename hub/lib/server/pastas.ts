import "server-only";

import path from "node:path";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { ehIdDeOrganizacao, organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";

// Onde os dados do hub moram no disco. Cada organização tem a própria pasta, então uma nunca lê o arquivo da outra
// (gerações, mídias, conversas, Fluxo, editor, agentes, sessões das integrações).
// - A organização padrão (Grupo Chegou) continua na raiz de .data/, como sempre esteve: nada muda de lugar.
// - As outras ficam em .data/organizacoes/<id>/.
// - O que é de todas fica na raiz: modelos (LaMa), temporários.
// No Railway a raiz é o volume montado em /app/.data.

export const DATA_DIR = path.join(process.cwd(), ".data");

const g = globalThis as typeof globalThis & { __hubFilas?: Map<string, Promise<unknown>>; __hubRaizDosDados?: string };

// Só para testes: põe os dados das organizações numa pasta temporária (undefined volta para .data/).
export function usarRaizDosDados(pasta: string | undefined) {
  g.__hubRaizDosDados = pasta;
}
const raiz = () => g.__hubRaizDosDados ?? DATA_DIR;

export function pastaDaOrganizacao(organizacaoId: string): string {
  if (organizacaoId === ORGANIZACAO_PADRAO.id) return raiz();
  // O id vira nome de pasta: só um uuid, nada de "..".
  if (!ehIdDeOrganizacao(organizacaoId)) throw new Error("Organização inválida.");
  return path.join(raiz(), "organizacoes", organizacaoId.toLowerCase());
}

// Pasta da organização em que o código está rodando (features/acesso/servicos/organizacao-atual.ts).
export const pastaDeDados = async () => pastaDaOrganizacao(await organizacaoAtual());

// Mídias (imagens, áudios, envios e cópias locais dos vídeos), servidas por /api/media/<arquivo>.
export const pastaDeMidiaDa = (organizacaoId: string) => path.join(pastaDaOrganizacao(organizacaoId), "media");
export const pastaDeMidia = async () => pastaDeMidiaDa(await organizacaoAtual());

// Fila por arquivo: as escritas num mesmo JSON (ler, mudar, gravar) acontecem uma de cada vez, para não perder
// atualizações simultâneas. Cada organização tem os próprios arquivos, então uma não espera a outra.
const filas = (g.__hubFilas ??= new Map());

export function naFila<T>(arquivo: string, fn: () => Promise<T>): Promise<T> {
  const vez = (filas.get(arquivo) ?? Promise.resolve()).then(fn);
  const fim = vez.catch(() => undefined);
  filas.set(arquivo, fim);
  // Sem isso o mapa guardaria uma entrada por arquivo para sempre.
  void fim.then(() => {
    if (filas.get(arquivo) === fim) filas.delete(arquivo);
  });
  return vez;
}

// Espera as escritas pendentes no arquivo (leitura que precisa ver o que acabou de ser gravado).
export const esperarFila = (arquivo: string) => filas.get(arquivo) ?? Promise.resolve();
