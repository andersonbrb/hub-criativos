import "server-only";

import { usuarios } from "@/db/schema";
import { limparChaves, type Usuario } from "@/features/acesso/contrato";

// Conversão da linha do banco para o Usuario do contrato. Fica separada de sessao.ts para os serviços puros
// (sessões, login, convites, membros) não dependerem dos wrappers que leem o cookie.

export type LinhaUsuario = typeof usuarios.$inferSelect;

export const paraUsuario = (l: LinhaUsuario): Usuario => ({
  id: l.id,
  email: l.email,
  nome: l.nome,
  papel: l.papel,
  ativo: l.ativo,
  chaves: limparChaves(l.chaves),
});

const FORMATO_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// E-mail sempre em minúsculas e sem espaços nas pontas (a coluna é única e a busca é exata).
export function normalizarEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const limpo = email.trim().toLowerCase();
  return limpo.length <= 200 && FORMATO_DE_EMAIL.test(limpo) ? limpo : null;
}

export function normalizarNome(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const limpo = nome.trim().replace(/\s+/g, " ");
  return limpo && limpo.length <= 100 ? limpo : null;
}
