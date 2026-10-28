import { criarChave, listarChaves } from "@/features/api/servicos/chaves";
import { lerCorpo } from "@/features/acesso/servicos/pedido";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Tela "Chaves de API": a lista da organização aberta e criar uma chave nova (só dono ou admin; o serviço confere).
// A chave inteira volta só na resposta de criar.
export const GET = route(async () => {
  return Response.json({ chaves: await listarChaves(await exigirUsuario()) });
});

export const POST = route(async (request: Request) => {
  const usuario = await exigirUsuario();
  const { dados } = await lerCorpo(request);
  const { chave, registro } = await criarChave(dados.nome, usuario);
  return Response.json({ chave, registro }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
