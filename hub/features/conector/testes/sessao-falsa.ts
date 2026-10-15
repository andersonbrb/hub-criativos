import { NaoAutenticado, SemPermissao, podeUsar, type Chave, type Usuario } from "@/features/acesso/contrato";

// Login de mentira para os testes: o "cookie" é só o id da pessoa guardado aqui. A conta e as chaves são lidas do
// banco de teste de verdade, então tirar uma chave ou desativar a conta vale na hora, como no hub.
// Sem imports de módulos simulados: o vi.mock da sessão carrega este arquivo de dentro da fábrica.

export const sessao = { logado: null as string | null };

export function exigirFalso(buscarUsuario: (id: string) => Promise<Usuario | null>) {
  return async (chave?: Chave | Chave[]): Promise<Usuario> => {
    const usuario = sessao.logado ? await buscarUsuario(sessao.logado) : null;
    if (!usuario?.ativo) throw new NaoAutenticado();
    const chaves = chave === undefined ? [] : Array.isArray(chave) ? chave : [chave];
    if (chaves.length && !chaves.some((c) => podeUsar(usuario, c))) throw new SemPermissao(chaves[0]);
    return usuario;
  };
}
