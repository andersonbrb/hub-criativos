import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { basePublica } from "@/features/conector/servicos/config";
import { ipDaRequisicao } from "@/features/conector/servicos/oauth";
import { decidirPedido } from "@/features/conector/servicos/pedidos";
import { route } from "@/lib/server/http";

// A pessoa recusa o pedido: o Claude recebe error=access_denied e para de esperar.
export const POST = route(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const usuario = await exigirUsuario("conector_claude");
    const { id } = await params;
    const { status, corpo } = await decidirPedido(id, usuario, "recusar", basePublica(request), ipDaRequisicao(request));
    return Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
  },
  { chave: "conector_claude" },
);
