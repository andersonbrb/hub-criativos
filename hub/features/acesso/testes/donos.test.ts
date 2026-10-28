import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { sessoes, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { entrar, freio } from "@/features/acesso/servicos/login";
import { aplicarSenhaDoDonoDasVariaveis, garantirDono, VARIAVEL_DA_SENHA_DO_DONO } from "@/features/acesso/servicos/donos";
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

describe("senha do dono nas variáveis do servidor", () => {
  const SENHA = "senha-da-variavel-forte-123";
  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
    process.env.DONOS_DA_PLATAFORMA = "Vini@Exemplo.com, outro@exemplo.com";
    process.env[VARIAVEL_DA_SENHA_DO_DONO] = SENHA;
  });
  afterEach(() => {
    delete process.env.DONOS_DA_PLATAFORMA;
    delete process.env[VARIAVEL_DA_SENHA_DO_DONO];
  });

  it("sem a senha ou sem o e-mail nas variáveis, não faz nada", async () => {
    delete process.env[VARIAVEL_DA_SENHA_DO_DONO];
    expect(await aplicarSenhaDoDonoDasVariaveis()).toBe("sem variáveis");
    process.env[VARIAVEL_DA_SENHA_DO_DONO] = SENHA;
    delete process.env.DONOS_DA_PLATAFORMA;
    expect(await aplicarSenhaDoDonoDasVariaveis()).toBe("sem variáveis");
    expect(await banco().select().from(usuarios)).toHaveLength(0);
  });

  it("sem a conta, cria o dono com a senha da variável, que funciona no login", async () => {
    expect(await aplicarSenhaDoDonoDasVariaveis()).toBe("conta criada");
    const { usuario } = await entrar("vini@exemplo.com", SENHA, {});
    expect(usuario).toMatchObject({ email: "vini@exemplo.com", papel: "dono", ativo: true, operaPlataforma: true });
    // Só o primeiro e-mail da lista recebe a senha.
    expect(await banco().select().from(usuarios)).toHaveLength(1);
  });

  it("conta com outra senha passa a usar a da variável; as outras contas não mudam", async () => {
    const dono = await criarConta({ email: "vini@exemplo.com", nome: "Vini", papel: "membro" });
    const outra = await criarConta({ email: "ana@exemplo.com", nome: "Ana" });
    await criarSessao(dono.id);
    await criarSessao(outra.id);
    expect(await aplicarSenhaDoDonoDasVariaveis()).toBe("aplicada");
    await expect(entrar("vini@exemplo.com", "senha-de-teste-123", {})).rejects.toThrow();
    expect((await entrar("vini@exemplo.com", SENHA, {})).usuario).toMatchObject({ id: dono.id, nome: "Vini", papel: "dono" });
    // A outra conta continua com a senha e a sessão dela.
    expect((await entrar("ana@exemplo.com", "senha-de-teste-123", {})).usuario.id).toBe(outra.id);
    const restantes = await banco().select().from(sessoes);
    expect(restantes.filter((s) => s.usuarioId === outra.id).length).toBeGreaterThanOrEqual(1);
  });

  it("subir de novo com a mesma senha não muda nada nem derruba sessão", async () => {
    await aplicarSenhaDoDonoDasVariaveis();
    const { usuario } = await entrar("vini@exemplo.com", SENHA, {});
    const antes = (await banco().select().from(sessoes)).filter((s) => s.usuarioId === usuario.id).length;
    expect(antes).toBeGreaterThanOrEqual(1);
    expect(await aplicarSenhaDoDonoDasVariaveis()).toBe("já valia");
    expect((await banco().select().from(sessoes)).filter((s) => s.usuarioId === usuario.id)).toHaveLength(antes);
  });

  it("senha curta demais é recusada sem mexer na conta, e o erro não mostra a senha", async () => {
    await criarConta({ email: "vini@exemplo.com" });
    process.env[VARIAVEL_DA_SENHA_DO_DONO] = "curta";
    const erro = await aplicarSenhaDoDonoDasVariaveis().catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/pelo menos/);
    expect((erro as Error).message).not.toContain("curta");
    await expect(entrar("vini@exemplo.com", "senha-de-teste-123", {})).resolves.toBeTruthy();
  });
});
