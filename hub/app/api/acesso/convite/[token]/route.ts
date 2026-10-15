import { telaInicial } from "@/features/acesso/contrato";
import { aceitarConvite, buscarConvite } from "@/features/acesso/servicos/convites";
import { cookieDeSessao, exigirMesmoSite, lerCorpo, metaDoPedido, redirecionar } from "@/features/acesso/servicos/pedido";
import { route } from "@/lib/server/http";

type Ctx = { params: Promise<{ token: string }> };

// Abertas: quem recebe o convite ainda não tem conta. O próprio token (aleatório, uso único, 7 dias) é a proteção.

export const GET = route(async (_request: Request, { params }: Ctx) => Response.json({ convite: await buscarConvite((await params).token) }), {
  publica: true,
});

// Aceita o convite (nome + senha), cria a conta e já entra.
export const POST = route(
  async (request: Request, { params }: Ctx) => {
    exigirMesmoSite(request);
    const { dados, formulario } = await lerCorpo(request);
    const { usuario, token } = await aceitarConvite((await params).token, { nome: dados.nome, senha: dados.senha }, metaDoPedido(request));
    const proximo = telaInicial(usuario) ?? "/sem-acesso";
    if (formulario) return redirecionar(proximo, cookieDeSessao(request, token));
    return Response.json({ usuario, proximo }, { headers: { "Set-Cookie": cookieDeSessao(request, token) } });
  },
  { publica: true },
);
