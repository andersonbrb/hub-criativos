import { registrarCliente } from "@/features/conector/servicos/rotas-oauth";

// Registro dinâmico de cliente (RFC 7591), público. Só cliente público e só os endereços de retorno do Claude.
export async function POST(request: Request) {
  return registrarCliente(request);
}
