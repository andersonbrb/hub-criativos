import { metadadosDoRecurso } from "@/features/conector/servicos/rotas-oauth";

// Metadados do recurso protegido (RFC 9728): é aqui que o Claude descobre onde fazer login no Hub.
// Rota pública (sem login do site); a lógica fica em features/conector/servicos/rotas-oauth.ts.
export async function GET(request: Request) {
  return metadadosDoRecurso(request);
}
