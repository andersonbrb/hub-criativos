import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { alterarOrganizacao } from "@/features/acesso/servicos/plataforma";
import { exigirOperador } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Muda o nome ou suspende/reativa uma organização.
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const eu = await exigirOperador();
  const { dados } = await lerCorpo(request);
  return Response.json({ organizacao: await alterarOrganizacao((await params).id, { nome: dados.nome, situacao: dados.situacao }, eu) });
});
