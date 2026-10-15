import { atualizarMembro } from "@/features/acesso/servicos/membros";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Muda papel, chaves, nome ou se a conta está ativa. As regras (quem pode o quê) ficam no serviço.
export const PATCH = route(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const eu = await exigirUsuario("membros");
    const { dados } = await lerCorpo(request);
    const membro = await atualizarMembro((await params).id, { papel: dados.papel, chaves: dados.chaves, ativo: dados.ativo, nome: dados.nome }, eu);
    return Response.json({ membro });
  },
  { chave: "membros" },
);
