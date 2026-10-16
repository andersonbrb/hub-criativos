import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { sessoes } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { entrar, freio } from "@/features/acesso/servicos/login";
import { garantirDono } from "@/features/acesso/servicos/donos";
import { criarSessao } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

describe("criar dono (script)", () => {
  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
    delete process.env.DONOS_DA_PLATAFORMA;
  });
  afterEach(() => {
    delete process.env.DONOS_DA_PLATAFORMA;
  });

  it("cria a conta de dono com uma senha forte que funciona no login", async () => {
    const { usuario, senha, criado } = await garantirDono({ email: "Vini@Exemplo.com", nome: "Vinícius" });
    expect(criado).toBe(true);
    expect(usuario).toMatchObject({ email: "vini@exemplo.com", nome: "Vinícius", papel: "dono", ativo: true, operaPlataforma: true });
    expect(usuario.organizacao?.nome).toBe("Grupo Chegou");
    expect(senha.length).toBeGreaterThanOrEqual(24);
    expect((await entrar("vini@exemplo.com", senha, {})).usuario.id).toBe(usuario.id);
  });

  it("conta existente vira dono ativo, com senha nova, e perde as sessões antigas", async () => {
    const antiga = await criarConta({ email: "vini@exemplo.com", nome: "Vini", papel: "membro", ativo: false });
    await criarSessao(antiga.id);
    const { usuario, senha, criado } = await garantirDono({ email: "vini@exemplo.com" });
    expect(criado).toBe(false);
    expect(usuario).toMatchObject({ id: antiga.id, nome: "Vini", papel: "dono", ativo: true });
    expect(await banco().select().from(sessoes)).toHaveLength(0);
    await expect(entrar("vini@exemplo.com", "senha-de-teste-123", {})).rejects.toThrow();
    await expect(entrar("vini@exemplo.com", senha, {})).resolves.toBeTruthy();
  });

  it("com DONOS_DA_PLATAFORMA, só os e-mails da lista viram dono", async () => {
    process.env.DONOS_DA_PLATAFORMA = "vini@exemplo.com, outro@exemplo.com";
    await expect(garantirDono({ email: "intruso@exemplo.com", nome: "X" })).rejects.toThrow(/DONOS_DA_PLATAFORMA/);
    await expect(garantirDono({ email: "OUTRO@exemplo.com", nome: "Outro" })).resolves.toBeTruthy();
  });

  it("e-mail inválido é recusado", async () => {
    await expect(garantirDono({ email: "sem-arroba" })).rejects.toThrow(/e-mail válido/);
  });
});
