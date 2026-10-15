import { emitirToken } from "@/features/conector/servicos/rotas-oauth";

// Troca do código por tokens (com PKCE) e renovação com rotação. Público: quem prova quem é, é o código ou o token.
export async function POST(request: Request) {
  return emitirToken(request);
}
