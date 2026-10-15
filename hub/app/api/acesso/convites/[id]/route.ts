import { revogarConvite } from "@/features/acesso/servicos/convites";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

export const DELETE = route(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const eu = await exigirUsuario("membros");
    await revogarConvite((await params).id, eu);
    return Response.json({ ok: true });
  },
  { chave: "membros" },
);
