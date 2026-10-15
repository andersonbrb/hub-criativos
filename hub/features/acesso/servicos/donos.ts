import "server-only";

import { eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import type { Usuario } from "@/features/acesso/contrato";
import { RegraDeMembros } from "@/features/acesso/erros";
import { gerarHashDeSenha, gerarSenhaForte } from "@/features/acesso/servicos/senha";
import { encerrarSessoesDe } from "@/features/acesso/servicos/sessoes";
import { normalizarEmail, normalizarNome, paraUsuario } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Dono da plataforma: só o script criar-dono dá esse papel (nenhuma tela dá). Com DONOS_DA_PLATAFORMA definida
// (e-mails separados por vírgula), só esses e-mails podem virar dono, mesmo com acesso ao servidor.

export function donosPermitidos(): string[] {
  return (process.env.DONOS_DA_PLATAFORMA ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const podeSerDono = (email: string) => {
  const lista = donosPermitidos();
  return lista.length === 0 || lista.includes(email.toLowerCase());
};

// Cria ou atualiza a conta como dono ativo, com uma senha nova e forte. A senha volta só aqui, uma vez: no banco
// fica apenas o hash. Conta que já existia perde as sessões abertas (a senha antiga deixou de valer).
export async function garantirDono(entrada: { email: unknown; nome?: unknown }): Promise<{ usuario: Usuario; senha: string; criado: boolean }> {
  const email = normalizarEmail(entrada.email);
  if (!email) throw new InputError("Informe um e-mail válido (--email).");
  if (!podeSerDono(email)) throw new RegraDeMembros(`O e-mail ${email} não está em DONOS_DA_PLATAFORMA. Só esses e-mails podem ser dono.`);
  const nome = entrada.nome === undefined ? null : normalizarNome(entrada.nome);
  if (entrada.nome !== undefined && !nome) throw new InputError("Nome inválido (--nome, até 100 caracteres).");

  const senha = gerarSenhaForte();
  const senhaHash = await gerarHashDeSenha(senha);
  const [existente] = await banco().select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

  if (existente) {
    const [linha] = await banco()
      .update(usuarios)
      .set({ papel: "dono", ativo: true, senhaHash, ...(nome ? { nome } : {}) })
      .where(eq(usuarios.id, existente.id))
      .returning();
    await encerrarSessoesDe(linha.id);
    return { usuario: paraUsuario(linha), senha, criado: false };
  }

  const [linha] = await banco()
    .insert(usuarios)
    .values({ email, nome: nome ?? email.split("@")[0], senhaHash, papel: "dono", ativo: true, chaves: [] })
    .returning();
  return { usuario: paraUsuario(linha), senha, criado: true };
}
