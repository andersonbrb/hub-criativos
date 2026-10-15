import "server-only";

import { eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { limparChaves, type Chave, type Usuario } from "@/features/acesso/contrato";

// Funções de sessão usadas pelo resto do hub. Contrato estável: as assinaturas abaixo não mudam.
// usuarioDaSessao e exigirUsuario são implementadas na Onda 1 (agente Acesso).

type LinhaUsuario = typeof usuarios.$inferSelect;

export const paraUsuario = (l: LinhaUsuario): Usuario => ({
  id: l.id,
  email: l.email,
  nome: l.nome,
  papel: l.papel,
  ativo: l.ativo,
  chaves: limparChaves(l.chaves),
});

// Conta pelo id, como está AGORA no banco (o conector usa a cada chamada para reconferir chaves e se está ativa).
export async function buscarUsuario(id: string): Promise<Usuario | null> {
  const [linha] = await banco().select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
  return linha ? paraUsuario(linha) : null;
}

// Pessoa logada no site (cookie de sessão), ou null.
export async function usuarioDaSessao(): Promise<Usuario | null> {
  throw new Error("Em construção: usuarioDaSessao (Onda 1, agente Acesso).");
}

// Pessoa logada com a chave pedida. Lança NaoAutenticado (401) ou SemPermissao (403).
export async function exigirUsuario(chave?: Chave): Promise<Usuario> {
  void chave;
  throw new Error("Em construção: exigirUsuario (Onda 1, agente Acesso).");
}

// Para páginas (componentes de servidor): sem login vai para /entrar (e volta para a mesma página depois);
// sem a chave mostra a tela de "sem acesso". Devolve a pessoa logada.
export async function exigirPagina(chave?: Chave): Promise<Usuario> {
  void chave;
  throw new Error("Em construção: exigirPagina (Onda 1, agente Acesso).");
}
