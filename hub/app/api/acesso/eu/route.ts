import { chavesLiberadas } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Quem está logado e as chaves que a pessoa usa de fato (admin e dono: todas).
export const GET = route(async () => {
  const usuario = await exigirUsuario();
  return Response.json({ usuario, chaves: chavesLiberadas(usuario) });
});
