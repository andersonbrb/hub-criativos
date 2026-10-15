import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { basePublica } from "@/features/conector/servicos/config";
import { ipDaRequisicao } from "@/features/conector/servicos/oauth";
import { decidirPedido } from "@/features/conector/servicos/pedidos";
import { route } from "@/lib/server/http";

// A decisão de verdade do consentimento: a pessoa logada (com a chave do conector) autoriza o Claude.
// Responde { redirect } com o endereço de volta do Claude (code, state e iss); a tela leva o navegador até lá.
export const POST = route(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const usuario = await exigirUsuario("conector_claude");
    const { id } = await params;
    const { status, corpo } = await decidirPedido(id, usuario, "autorizar", basePublica(request), ipDaRequisicao(request));
    return Response.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
  },
  { chave: "conector_claude" },
);
