import { criarConvite, listarConvites } from "@/features/acesso/servicos/convites";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Convites pendentes da organização aberta.
export const GET = route(
  async () => {
    const eu = await exigirUsuario("membros");
    return Response.json({ convites: await listarConvites(eu.organizacao!.id) });
  },
  { chave: "membros" },
);

// Cria o convite e devolve o link (/aceitar-convite/<token>). O link só existe nesta resposta: no banco fica o hash.
export const POST = route(
  async (request: Request) => {
    const eu = await exigirUsuario("membros");
    const { dados } = await lerCorpo(request);
    const resultado = await criarConvite({ email: dados.email, nome: dados.nome, papel: dados.papel, chaves: dados.chaves }, eu);
    return Response.json(resultado, { status: 201 });
  },
  { chave: "membros" },
);
