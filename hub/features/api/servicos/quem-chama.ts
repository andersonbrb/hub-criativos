import "server-only";

import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { conferirChave } from "@/features/api/servicos/chaves";
import { ORGANIZACAO_DO_SKALA } from "@/features/skala/contrato";
import { chaveDoCabecalho, ehAChaveFixa } from "@/features/skala/servicos/chave";

// Quem está chamando a API do hub, pela chave em "Authorization: Bearer <chave>". Vale a chave fixa do Skala (a da
// variável do servidor, sempre da Grupo Chegou) e as chaves de API criadas na tela, cada uma da sua organização.
// null: sem chave, chave errada ou revogada.
export type QuemChama = { organizacaoId: string; organizacao: string; chaveApiId: string | null; nomeDaChave: string };

export async function quemChama(request: Request): Promise<QuemChama | null> {
  const recebida = chaveDoCabecalho(request);
  if (!recebida) return null;
  if (ehAChaveFixa(recebida)) {
    return { organizacaoId: ORGANIZACAO_DO_SKALA, organizacao: ORGANIZACAO_PADRAO.nome, chaveApiId: null, nomeDaChave: "Chave fixa do Skala" };
  }
  const chave = await conferirChave(recebida);
  return chave ? { organizacaoId: chave.organizacaoId, organizacao: chave.organizacao, chaveApiId: chave.id, nomeDaChave: chave.nome } : null;
}
