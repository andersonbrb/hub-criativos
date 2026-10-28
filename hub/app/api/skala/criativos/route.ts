import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { metaDoPedido } from "@/features/acesso/servicos/pedido";
import { quemChama } from "@/features/api/servicos/quem-chama";
import { basePublica } from "@/features/conector/servicos/config";
import { json, lerCorpo, SEM_CACHE } from "@/features/conector/servicos/http";
import { TETO_DO_CORPO } from "@/features/skala/contrato";
import { registrarEntrega } from "@/features/skala/servicos/entregas";
import { lerEntrega } from "@/features/skala/servicos/validar";
import { InputError, route } from "@/lib/server/http";

// "Gerar ganchos" da API do hub: o SERVIDOR de outro sistema (o Skala) manda os criativos e recebe o link que abre o
// chat principal já com eles (features/skala/contrato.ts; documentação na tela "Documentação da API").
// Aberta sem login (é servidor falando com servidor), protegida pela chave no cabeçalho "Authorization: Bearer <chave>":
// uma chave de API da tela "Chaves de API" (o criativo entra na organização dela) ou a chave fixa do Skala, da variável
// do servidor (entra na Grupo Chegou). Sem chave válida, nada é lido nem gravado. A IA só começa quando uma pessoa
// logada no hub abre o link.
export const POST = route(
  async (request: Request) => {
    if (modoLocalSemBanco()) return json({ error: "A API do hub só funciona no hub da nuvem." }, 503, SEM_CACHE);
    const chamador = await quemChama(request);
    if (!chamador) return json({ error: "Chave de API inválida ou revogada." }, 401, SEM_CACHE);
    const texto = await lerCorpo(request, TETO_DO_CORPO);
    if (texto === null) return json({ error: `Pedido grande demais (máximo ${TETO_DO_CORPO / 1024} KB).` }, 413, SEM_CACHE);
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new InputError("O corpo precisa ser JSON.");
    }
    const entrega = lerEntrega(corpo);
    const { token, expiraEm } = await registrarEntrega(entrega, metaDoPedido(request).ip ?? null, chamador.organizacaoId, chamador.chaveApiId);
    const url = `${basePublica(request)}/chat?skala=${encodeURIComponent(token)}`;
    return json({ url, expira_em: expiraEm.toISOString(), criativos: entrega.criativos.length }, 201, SEM_CACHE);
  },
  { publica: true },
);
