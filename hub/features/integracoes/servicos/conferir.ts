import "server-only";

import type { NomeDaChave } from "@/features/integracoes/contrato";
import { InputError } from "@/lib/server/http";

// Antes de gravar, pergunta ao serviço se a chave vale: uma chave copiada pela metade aparece na hora, na tela
// Integrações, e não no meio de uma conversa. Sem resposta do serviço (internet, serviço fora do ar), grava assim
// mesmo: a conferência ajuda, não trava.

const PEDIDOS: Partial<Record<NomeDaChave, (valor: string) => { url: string; headers: Record<string, string>; quem: string }>> = {
  anthropic: (valor) => ({
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: { "x-api-key": valor, "anthropic-version": "2023-06-01" },
    quem: "A Anthropic",
  }),
  venice: (valor) => ({
    url: "https://api.venice.ai/api/v1/api_keys/rate_limits",
    headers: { authorization: `Bearer ${valor}` },
    quem: "A Venice",
  }),
};

export async function conferirChave(nome: NomeDaChave, valor: string): Promise<void> {
  const pedido = PEDIDOS[nome]?.(valor);
  if (!pedido) return;
  let res: Response;
  try {
    res = await fetch(pedido.url, { headers: pedido.headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    return;
  }
  if (res.status === 401 || res.status === 403) throw new InputError(`${pedido.quem} recusou essa chave. Confira se copiou a chave inteira.`);
}
