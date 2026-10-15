import { revogar } from "@/features/conector/servicos/rotas-oauth";

// Revogação de token (RFC 7009): o próprio Claude soltando a conexão.
export async function POST(request: Request) {
  return revogar(request);
}
