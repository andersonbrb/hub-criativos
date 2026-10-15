import { beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { podeUsar } from "@/features/acesso/contrato";
import { buscarUsuario } from "@/features/acesso/servicos/sessao";

describe("banco de teste e busca de conta", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("acha a conta pelo id, com chaves limpas", async () => {
    const [u] = await banco()
      .insert(usuarios)
      .values({ email: "pessoa@exemplo.com", nome: "Pessoa", chaves: ["memoria", "inexistente", "memoria"] })
      .returning();
    const achado = await buscarUsuario(u.id);
    expect(achado?.chaves).toEqual(["memoria"]);
    expect(achado && podeUsar(achado, "memoria")).toBe(true);
    expect(achado && podeUsar(achado, "membros")).toBe(false);
  });

  it("cada teste começa com o banco vazio", async () => {
    expect(await banco().select().from(usuarios)).toHaveLength(0);
  });
});
