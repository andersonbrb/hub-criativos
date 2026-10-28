import { revogarChave } from "@/features/api/servicos/chaves";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Revogar uma chave de API (só dono ou admin). Vale na hora: a próxima chamada com ela recebe 401.
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const usuario = await exigirUsuario();
  const { id } = await params;
  if (!(await revogarChave(id, usuario))) return Response.json({ error: "Chave não encontrada ou já revogada." }, { status: 404 });
  return Response.json({ ok: true });
});
