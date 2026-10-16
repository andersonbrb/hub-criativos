import "server-only";

import { eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { organizacaoMembros, organizacoes, usuarios } from "@/db/schema";
import { ORGANIZACAO_PADRAO, type Usuario } from "@/features/acesso/contrato";
import { RegraDeMembros } from "@/features/acesso/erros";
import { gerarHashDeSenha, gerarSenhaForte } from "@/features/acesso/servicos/senha";
import { encerrarSessoesDe } from "@/features/acesso/servicos/sessoes";
import { donosPermitidos, normalizarEmail, normalizarNome, podeSerDono, usuarioNaOrganizacao } from "@/features/acesso/servicos/usuarios";
import { InputError } from "@/lib/server/http";

// Dono da plataforma: só o script criar-dono dá esse papel (nenhuma tela dá). Com DONOS_DA_PLATAFORMA definida
// (e-mails separados por vírgula), só esses e-mails podem virar dono, mesmo com acesso ao servidor.
// O dono da plataforma opera a plataforma (tela Plataforma) e é dono da organização padrão (Grupo Chegou).

export { donosPermitidos, podeSerDono };

// Cria ou atualiza a conta como dono, com uma senha nova e forte. A senha volta só aqui, uma vez: no banco fica
// apenas o hash. Conta que já existia perde as sessões abertas (a senha antiga deixou de valer).
export async function garantirDono(entrada: { email: unknown; nome?: unknown }): Promise<{ usuario: Usuario; senha: string; criado: boolean }> {
  const email = normalizarEmail(entrada.email);
  if (!email) throw new InputError("Informe um e-mail válido (--email).");
  if (!podeSerDono(email)) throw new RegraDeMembros(`O e-mail ${email} não está em DONOS_DA_PLATAFORMA. Só esses e-mails podem ser dono.`);
  const nome = entrada.nome === undefined ? null : normalizarNome(entrada.nome);
  if (entrada.nome !== undefined && !nome) throw new InputError("Nome inválido (--nome, até 100 caracteres).");

  const senha = gerarSenhaForte();
  const senhaHash = await gerarHashDeSenha(senha);

  const { id, criado } = await banco().transaction(async (tx) => {
    // Banco novo (sem a migração que cria a organização padrão, como nos testes): cria aqui.
    await tx.insert(organizacoes).values({ id: ORGANIZACAO_PADRAO.id, nome: ORGANIZACAO_PADRAO.nome }).onConflictDoNothing();
    const [existente] = await tx.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    const [conta] = existente
      ? await tx
          .update(usuarios)
          .set({ operaPlataforma: true, senhaHash, ...(nome ? { nome } : {}) })
          .where(eq(usuarios.id, existente.id))
          .returning()
      : await tx
          .insert(usuarios)
          .values({ email, nome: nome ?? email.split("@")[0], senhaHash, operaPlataforma: true })
          .returning();
    await tx
      .insert(organizacaoMembros)
      .values({ organizacaoId: ORGANIZACAO_PADRAO.id, usuarioId: conta.id, papel: "dono", ativo: true })
      .onConflictDoUpdate({ target: [organizacaoMembros.organizacaoId, organizacaoMembros.usuarioId], set: { papel: "dono", ativo: true } });
    return { id: conta.id, criado: !existente };
  });

  if (!criado) await encerrarSessoesDe(id);
  const usuario = (await usuarioNaOrganizacao(id, ORGANIZACAO_PADRAO.id))!;
  return { usuario, senha, criado };
}
