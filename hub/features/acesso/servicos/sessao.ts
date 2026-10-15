import "server-only";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { CABECALHO_CAMINHO, caminhoSeguro, COOKIE_SESSAO, NaoAutenticado, podeUsar, SemPermissao, type Chave, type Usuario } from "@/features/acesso/contrato";
import { DONO_LOCAL, modoLocalSemBanco } from "@/features/acesso/modo-local";
import { usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { paraUsuario } from "@/features/acesso/servicos/usuarios";

// Funções de sessão usadas pelo resto do hub. Contrato estável: as assinaturas abaixo não mudam.
// Aqui ficam só os wrappers que leem o cookie e os headers do Next; a regra está em sessoes.ts (testável sem o Next).

export { paraUsuario };

// Conta pelo id, como está AGORA no banco (o conector usa a cada chamada para reconferir chaves e se está ativa).
export async function buscarUsuario(id: string): Promise<Usuario | null> {
  const [linha] = await banco().select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
  return linha ? paraUsuario(linha) : null;
}

// Layout, página e rotas pedem a pessoa várias vezes no mesmo pedido: uma ida ao banco por pedido basta.
const lerSessaoDoPedido = cache(async (): Promise<Usuario | null> => {
  if (modoLocalSemBanco()) return DONO_LOCAL;
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  return token ? usuarioPeloToken(token) : null;
});

// Pessoa logada no site (cookie de sessão), ou null.
export async function usuarioDaSessao(): Promise<Usuario | null> {
  return lerSessaoDoPedido();
}

// Pessoa logada com a chave pedida. Lança NaoAutenticado (401) ou SemPermissao (403).
export async function exigirUsuario(chave?: Chave): Promise<Usuario> {
  const usuario = await usuarioDaSessao();
  if (!usuario) throw new NaoAutenticado();
  if (chave && !podeUsar(usuario, chave)) throw new SemPermissao(chave);
  return usuario;
}

// Para páginas (componentes de servidor): sem login vai para /entrar (e volta para a mesma página depois);
// sem a chave mostra a tela de "sem acesso". Devolve a pessoa logada.
export async function exigirPagina(chave?: Chave): Promise<Usuario> {
  // Import tardio: next/navigation quebra fora do Next, e scripts (criar-dono, importar-memoria) chegam a este
  // arquivo pelo InputError de lib/server/http.ts.
  const { redirect } = await import("next/navigation");
  const usuario = await usuarioDaSessao();
  if (!usuario) {
    // O proxy grava o caminho pedido neste header; a página sozinha não sabe a própria URL.
    const caminho = caminhoSeguro((await headers()).get(CABECALHO_CAMINHO));
    return redirect(`/entrar?proximo=${encodeURIComponent(caminho)}`);
  }
  if (chave && !podeUsar(usuario, chave)) return redirect(`/sem-acesso?chave=${encodeURIComponent(chave)}`);
  return usuario;
}
