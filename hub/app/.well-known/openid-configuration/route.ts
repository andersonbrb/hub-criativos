import { metadadosDoServidor } from "@/features/conector/servicos/rotas-oauth";

// Metadados do servidor de autorização (RFC 8414). O mesmo documento responde em seis caminhos (com e sem /mcp, e em
// openid-configuration): cliente de OAuth vai tentando até achar. Lógica em features/conector/servicos/rotas-oauth.ts.
export async function GET(request: Request) {
  return metadadosDoServidor(request);
}
