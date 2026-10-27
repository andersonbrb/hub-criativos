import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { metaDoPedido } from "@/features/acesso/servicos/pedido";
import { basePublica } from "@/features/conector/servicos/config";
import { json, lerCorpo, SEM_CACHE } from "@/features/conector/servicos/http";
import { TETO_DO_CORPO } from "@/features/skala/contrato";
import { chaveConfigurada, chaveDoPedidoConfere } from "@/features/skala/servicos/chave";
import { registrarEntrega } from "@/features/skala/servicos/entregas";
import { lerEntrega } from "@/features/skala/servicos/validar";
import { InputError, route } from "@/lib/server/http";

// Porta do Skala: o SERVIDOR dele manda os criativos do botão "Gerar ganchos" e recebe o link que abre o chat principal
// já com eles (features/skala/contrato.ts; receita para o lado do Skala em docs/skala.md).
// Aberta sem login (é servidor falando com servidor), protegida pela chave combinada no cabeçalho
// "Authorization: Bearer <chave>". Sem a chave certa, nada é lido nem gravado. A IA só começa quando uma pessoa logada
// no hub abre o link.
export const POST = route(
  async (request: Request) => {
    if (modoLocalSemBanco() || !chaveConfigurada()) {
      return json({ error: "A conexão com o Skala está desligada neste hub." }, 503, SEM_CACHE);
    }
    if (!chaveDoPedidoConfere(request)) return json({ error: "Chave do Skala inválida." }, 401, SEM_CACHE);
    const texto = await lerCorpo(request, TETO_DO_CORPO);
    if (texto === null) return json({ error: `Pedido grande demais (máximo ${TETO_DO_CORPO / 1024} KB).` }, 413, SEM_CACHE);
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new InputError("O corpo precisa ser JSON.");
    }
    const entrega = lerEntrega(corpo);
    const { token, expiraEm } = await registrarEntrega(entrega, metaDoPedido(request).ip ?? null);
    const url = `${basePublica(request)}/chat?skala=${encodeURIComponent(token)}`;
    return json({ url, expira_em: expiraEm.toISOString(), criativos: entrega.criativos.length }, 201, SEM_CACHE);
  },
  { publica: true },
);
