import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { convidarDono } from "@/features/acesso/servicos/plataforma";
import { exigirOperador } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Novo link de dono para a organização (o link só existe nesta resposta).
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const eu = await exigirOperador();
  const { dados } = await lerCorpo(request);
  return Response.json(await convidarDono((await params).id, { email: dados.email, nome: dados.nome }, eu), { status: 201 });
});
