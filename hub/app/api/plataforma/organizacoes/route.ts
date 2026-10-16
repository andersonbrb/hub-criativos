import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { criarOrganizacao, listarOrganizacoes } from "@/features/acesso/servicos/plataforma";
import { exigirOperador } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Tela Plataforma: todas as organizações. Só quem opera a plataforma (as regras ficam no serviço).
export const GET = route(async () => Response.json({ organizacoes: await listarOrganizacoes(await exigirOperador()) }));

// Cria a organização e o convite do primeiro dono (o link só existe nesta resposta).
export const POST = route(async (request: Request) => {
  const eu = await exigirOperador();
  const { dados } = await lerCorpo(request);
  const resultado = await criarOrganizacao({ nome: dados.nome, email: dados.email, nomeDoDono: dados.nomeDoDono }, eu);
  return Response.json(resultado, { status: 201 });
});
