import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { pessoaDoInstagram, repassar } from "@/features/instagram/servicos/repassar";
import { route } from "@/lib/server/http";

// As rotas do Instagram (features/instagram/servidor/http), atrás do login do hub e da tela Instagram. Cada pedido
// roda na organização aberta: mercados, contas, posts, peças e publicações são dela. Dono e admin da organização
// fazem o que era do administrador (mercados, contas do Instagram, publicação real, Padrão de Edição).

type Contexto = { params: Promise<{ caminho: string[] }> };

const repassarComLogin = route(async (request: Request, { params }: Contexto) => {
  const usuario = await exigirUsuario("instagram");
  const { caminho } = await params;
  return repassar(request, `/${caminho.map(encodeURIComponent).join("/")}`, pessoaDoInstagram(usuario));
}, { chave: "instagram" });

export const GET = repassarComLogin;
export const POST = repassarComLogin;
export const PUT = repassarComLogin;
export const PATCH = repassarComLogin;
export const DELETE = repassarComLogin;
