import { listarMembros } from "@/features/acesso/servicos/membros";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Equipe da organização aberta.
export const GET = route(
  async () => {
    const eu = await exigirUsuario("membros");
    return Response.json({ membros: await listarMembros(eu.organizacao!.id) });
  },
  { chave: "membros" },
);
