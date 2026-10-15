import { ehAdmin } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { desconectar } from "@/features/conector/servicos/conexoes";
import { route } from "@/lib/server/http";

// Desconectar: revoga a conexão e todos os tokens dela na hora. Exige só login, de propósito: quem perdeu a chave do
// conector continua podendo cortar o Claude que deixou ligado. A pessoa desconecta as próprias; admin, qualquer uma.
export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const usuario = await exigirUsuario();
  const { id } = await params;
  const resultado = await desconectar(id, { id: usuario.id, admin: ehAdmin(usuario) });
  if (resultado === "nao_encontrada") return Response.json({ error: "Conexão não encontrada (talvez já tenha sido desconectada)." }, { status: 404 });
  return Response.json({ ok: true });
});
