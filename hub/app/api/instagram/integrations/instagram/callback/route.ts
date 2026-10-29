import { repassar } from "@/features/instagram/servicos/repassar";

// Volta do login oficial do Instagram (o navegador chega aqui vindo do instagram.com). Sem login do hub: o "state" do
// pedido é a proteção, e a conta entra na organização que começou o login. É este o endereço cadastrado no app da Meta.
export async function GET(request: Request) {
  return repassar(request, "/integrations/instagram/callback", null);
}
