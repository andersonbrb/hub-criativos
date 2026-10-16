import { minhasOrganizacoes } from "@/features/acesso/servicos/organizacoes";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { route } from "@/lib/server/http";

// Organizações de que a pessoa participa (seletor do menu), com a aberta agora.
export const GET = route(async () => {
  const eu = await exigirUsuario();
  return Response.json({ organizacoes: await minhasOrganizacoes(eu.id), atual: eu.organizacao?.id ?? null });
});
