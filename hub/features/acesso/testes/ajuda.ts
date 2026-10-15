import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import type { Chave, Papel } from "@/features/acesso/contrato";
import { gerarHashDeSenha } from "@/features/acesso/servicos/senha";
import { paraUsuario } from "@/features/acesso/servicos/usuarios";

// Conta pronta para os testes, gravada direto no banco.
export async function criarConta(dados: { email: string; nome?: string; papel?: Papel; chaves?: Chave[]; senha?: string | null; ativo?: boolean }) {
  const [linha] = await banco()
    .insert(usuarios)
    .values({
      email: dados.email,
      nome: dados.nome ?? dados.email.split("@")[0],
      papel: dados.papel ?? "membro",
      chaves: dados.chaves ?? [],
      ativo: dados.ativo ?? true,
      senhaHash: dados.senha === null ? null : await gerarHashDeSenha(dados.senha ?? "senha-de-teste-123"),
    })
    .returning();
  return paraUsuario(linha);
}
