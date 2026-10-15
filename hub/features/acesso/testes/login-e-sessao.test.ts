import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { sessoes, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ContaDesativada, CredenciaisInvalidas, MuitasTentativas } from "@/features/acesso/erros";
import { entrar, freio, sair } from "@/features/acesso/servicos/login";
import { criarSessao, hashDoToken, usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

const DIA = 24 * 60 * 60 * 1000;

describe("login", () => {
  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
  });

  it("entra com e-mail e senha certos (e-mail sem diferença de maiúsculas) e abre sessão", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    const { usuario, token } = await entrar("  Ana@Exemplo.com ", "senha-certa-da-ana", { ip: "1.1.1.1", navegador: "teste" });
    expect(usuario.id).toBe(conta.id);
    expect((await usuarioPeloToken(token))?.id).toBe(conta.id);
    // No banco só o hash do token.
    const [s] = await banco().select().from(sessoes);
    expect(s.tokenHash).toBe(hashDoToken(token));
    expect(s.tokenHash).not.toContain(token);
    const [u] = await banco().select().from(usuarios).where(eq(usuarios.id, conta.id));
    expect(u.ultimoAcessoEm).not.toBeNull();
  });

  it("recusa senha errada e e-mail inexistente com a mesma mensagem", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    await expect(entrar("ana@exemplo.com", "senha-errada-000", {})).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ninguem@exemplo.com", "senha-errada-000", {})).rejects.toThrow("E-mail ou senha incorretos.");
    expect(await banco().select().from(sessoes)).toHaveLength(0);
  });

  it("conta sem senha (convite não aceito) não entra", async () => {
    await criarConta({ email: "sem@exemplo.com", senha: null });
    await expect(entrar("sem@exemplo.com", "", {})).rejects.toThrow(CredenciaisInvalidas);
  });

  it("conta desativada não entra, mesmo com a senha certa", async () => {
    await criarConta({ email: "fora@exemplo.com", senha: "senha-certa-123", ativo: false });
    await expect(entrar("fora@exemplo.com", "senha-certa-123", {})).rejects.toThrow(ContaDesativada);
  });

  it("freio: depois de 5 erros em 10 minutos no mesmo e-mail e IP, recusa até a senha certa", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    for (let i = 0; i < 5; i++) await expect(entrar("ana@exemplo.com", `errada-${i}-xxxxx`, { ip: "9.9.9.9" })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "9.9.9.9" })).rejects.toThrow(MuitasTentativas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "9.9.9.9" })).rejects.toThrow(/Espere \d+ minuto/);
    // Outro IP não herda o bloqueio.
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "8.8.8.8" })).resolves.toBeTruthy();
  });

  it("acertar antes do limite zera a contagem", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    for (let i = 0; i < 4; i++) await expect(entrar("ana@exemplo.com", "errada-xxxxxx", { ip: "1.2.3.4" })).rejects.toThrow();
    await entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "1.2.3.4" });
    for (let i = 0; i < 4; i++) await expect(entrar("ana@exemplo.com", "errada-xxxxxx", { ip: "1.2.3.4" })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "1.2.3.4" })).resolves.toBeTruthy();
  });

  it("cada erro espera o atraso configurado (600 ms por padrão)", async () => {
    freio.atrasoMs = 600;
    const inicio = Date.now();
    await expect(entrar("ninguem@exemplo.com", "qualquer-senha", {})).rejects.toThrow();
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(550);
  });

  it("sair apaga a sessão", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    const { token } = await entrar("ana@exemplo.com", "senha-certa-da-ana", {});
    await sair(token);
    expect(await usuarioPeloToken(token)).toBeNull();
  });
});

describe("sessão", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("válida devolve a pessoa", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com", chaves: ["memoria"] });
    const { token } = await criarSessao(conta.id);
    expect(await usuarioPeloToken(token)).toMatchObject({ id: conta.id, chaves: ["memoria"], ativo: true });
  });

  it("token desconhecido ou malformado dá null", async () => {
    expect(await usuarioPeloToken("x".repeat(43))).toBeNull();
    expect(await usuarioPeloToken("curto")).toBeNull();
    expect(await usuarioPeloToken(undefined)).toBeNull();
  });

  it("vencida dá null", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com" });
    const { token } = await criarSessao(conta.id);
    await banco().update(sessoes).set({ expiraEm: new Date(Date.now() - 1000) });
    expect(await usuarioPeloToken(token)).toBeNull();
  });

  it("de conta desativada dá null", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com" });
    const { token } = await criarSessao(conta.id);
    await banco().update(usuarios).set({ ativo: false }).where(eq(usuarios.id, conta.id));
    expect(await usuarioPeloToken(token)).toBeNull();
  });

  it("usada depois de mais de 1 dia, renova por mais 30 dias", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com" });
    const { token } = await criarSessao(conta.id);
    const antigo = new Date(Date.now() - 2 * DIA);
    await banco().update(sessoes).set({ ultimoUsoEm: antigo, expiraEm: new Date(Date.now() + 5 * DIA) });
    await banco().update(usuarios).set({ ultimoAcessoEm: antigo });

    const agora = new Date();
    expect(await usuarioPeloToken(token, agora)).not.toBeNull();
    const [s] = await banco().select().from(sessoes);
    expect(s.ultimoUsoEm.getTime()).toBe(agora.getTime());
    expect(s.expiraEm.getTime()).toBe(agora.getTime() + 30 * DIA);
    const [u] = await banco().select().from(usuarios);
    expect(u.ultimoAcessoEm?.getTime()).toBe(agora.getTime());
  });

  it("usada há menos de 1 dia, não regrava nada", async () => {
    const conta = await criarConta({ email: "ana@exemplo.com" });
    const { token, expiraEm } = await criarSessao(conta.id);
    await usuarioPeloToken(token, new Date(Date.now() + 60_000));
    const [s] = await banco().select().from(sessoes);
    expect(s.expiraEm.getTime()).toBe(expiraEm.getTime());
  });
});
