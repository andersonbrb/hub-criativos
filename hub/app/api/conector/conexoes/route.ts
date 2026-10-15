import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { conexoesDaPessoa } from "@/features/conector/servicos/conexoes";
import { route } from "@/lib/server/http";

// As conexões ATIVAS do Claude da pessoa logada (a tela "Conector").
export const GET = route(
  async () => {
    const usuario = await exigirUsuario("conector_claude");
    return Response.json({ conexoes: await conexoesDaPessoa(usuario.id) });
  },
  { chave: "conector_claude" },
);
