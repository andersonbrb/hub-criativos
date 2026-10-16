import { atualizarMembro, removerMembro } from "@/features/acesso/servicos/membros";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// Muda papel, chaves ou se a pessoa está ativa NESTA organização. As regras (quem pode o quê) ficam no serviço.
export const PATCH = route(
  async (request: Request, { params }: Ctx) => {
    const eu = await exigirUsuario("membros");
    const { dados } = await lerCorpo(request);
    const membro = await atualizarMembro((await params).id, { papel: dados.papel, chaves: dados.chaves, ativo: dados.ativo }, eu);
    return Response.json({ membro });
  },
  { chave: "membros" },
);

// Tira a pessoa desta organização (a conta e as outras organizações dela continuam).
export const DELETE = route(
  async (_request: Request, { params }: Ctx) => {
    const eu = await exigirUsuario("membros");
    await removerMembro((await params).id, eu);
    return Response.json({ ok: true });
  },
  { chave: "membros" },
);
