import { autorizar } from "@/features/conector/servicos/rotas-oauth";

// Início do login do Claude: valida o pedido (retorno, PKCE, recurso) e manda a pessoa para /conectar-claude.
export async function GET(request: Request) {
  return autorizar(request);
}
