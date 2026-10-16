import { beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { organizacaoMembros, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, podeUsar } from "@/features/acesso/contrato";
import { buscarUsuario } from "@/features/acesso/servicos/sessao";
import { criarOrganizacao, garantirOrganizacaoPadrao } from "@/features/acesso/testes/ajuda";

describe("banco de teste e busca de conta", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("acha a conta pelo id, vista na organização pedida, com chaves limpas", async () => {
    const org = await garantirOrganizacaoPadrao();
    const [u] = await banco().insert(usuarios).values({ email: "pessoa@exemplo.com", nome: "Pessoa" }).returning();
    await banco()
      .insert(organizacaoMembros)
      .values({ organizacaoId: org, usuarioId: u.id, chaves: ["memoria", "inexistente", "memoria"] });
    const achado = await buscarUsuario(u.id, org);
    expect(achado?.chaves).toEqual(["memoria"]);
    expect(achado?.organizacao).toEqual({ id: ORGANIZACAO_PADRAO.id, nome: "Grupo Chegou", situacao: "ativa" });
    expect(achado && podeUsar(achado, "memoria")).toBe(true);
    expect(achado && podeUsar(achado, "membros")).toBe(false);

    // Em outra organização, sem vínculo: nenhuma chave.
    const outra = await buscarUsuario(u.id, await criarOrganizacao());
    expect(outra?.organizacao).toBeNull();
    expect(outra && podeUsar(outra, "memoria")).toBe(false);
  });

  it("cada teste começa com o banco vazio", async () => {
    expect(await banco().select().from(usuarios)).toHaveLength(0);
  });
});
