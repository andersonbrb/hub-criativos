import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { CABECALHO_CAMINHO, caminhoSeguro, COOKIE_SESSAO, NaoAutenticado, podeUsar, SemPermissao, type Chave, type Usuario } from "@/features/acesso/contrato";
import { DONO_LOCAL, modoLocalSemBanco } from "@/features/acesso/modo-local";
import { usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { paraUsuario, usuarioNaOrganizacao } from "@/features/acesso/servicos/usuarios";

// Funções de sessão usadas pelo resto do hub.
// Aqui ficam só os wrappers que leem o cookie e os headers do Next; a regra está em sessoes.ts (testável sem o Next).

export { paraUsuario };

// Conta pelo id, vista na organização pedida, como está AGORA no banco (o conector usa a cada chamada para
// reconferir as chaves e se a pessoa continua ativa naquela organização).
export async function buscarUsuario(id: string, organizacaoId: string | null): Promise<Usuario | null> {
  return usuarioNaOrganizacao(id, organizacaoId);
}

// Token de sessão do pedido (o cookie), para as rotas que mexem na própria sessão (trocar de organização).
export async function tokenDaSessao(): Promise<string | null> {
  return (await cookies()).get(COOKIE_SESSAO)?.value ?? null;
}

// Layout, página e rotas pedem a pessoa várias vezes no mesmo pedido: uma ida ao banco por pedido basta.
const lerSessaoDoPedido = cache(async (): Promise<Usuario | null> => {
  // Lê o cookie SEMPRE, antes do modo local: é isso que torna as páginas dinâmicas. No build (sem DATABASE_URL nem
  // RAILWAY_*) o modo local daria "sim" e o Next gravaria as páginas como HTML fixo, com o dono local dentro.
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (modoLocalSemBanco()) return DONO_LOCAL;
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

// Tela Plataforma: só quem opera a plataforma (DONOS_DA_PLATAFORMA). Não depende da organização aberta.
export async function exigirOperador(): Promise<Usuario> {
  const usuario = await exigirUsuario();
  if (!usuario.operaPlataforma) throw new SemPermissao();
  return usuario;
}
