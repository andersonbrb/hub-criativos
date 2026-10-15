import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco } from "@/db/cliente";
import { sessoes, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ContaDesativada, CredenciaisInvalidas, MuitasTentativas } from "@/features/acesso/erros";
import { entrar, freio, sair } from "@/features/acesso/servicos/login";
import * as senha from "@/features/acesso/servicos/senha";
import { criarSessao, hashDoToken, usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

const DIA = 24 * 60 * 60 * 1000;

// Quantos pedidos terminaram com cada erro.
function placar(resultados: PromiseSettledResult<unknown>[]) {
  const motivos = resultados.map((r) => (r.status === "rejected" ? r.reason : null));
  return {
    erradas: motivos.filter((m) => m instanceof CredenciaisInvalidas).length,
    freadas: motivos.filter((m) => m instanceof MuitasTentativas).length,
  };
}

describe("login", () => {
  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("rajada de 20 senhas erradas em paralelo: só 5 chegam a conferir a senha", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    const conferir = vi.spyOn(senha, "conferirSenha");
    const resultados = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => entrar("ana@exemplo.com", `errada-${i}-xxxxx`, { ip: "7.7.7.7" })));
    expect(placar(resultados)).toEqual({ erradas: 5, freadas: 15 });
    expect(conferir).toHaveBeenCalledTimes(5);
    // Nem a senha certa passa depois da rajada.
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "7.7.7.7" })).rejects.toThrow(MuitasTentativas);
  });

  it("no máximo 8 conferências de senha ao mesmo tempo; as vagas voltam depois", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    const conferir = vi.spyOn(senha, "conferirSenha");
    // E-mails e IPs diferentes: nenhum dos três freios segura, só o teto do processo.
    const resultados = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => entrar(`p${i}@exemplo.com`, "qualquer-senha", { ip: `10.0.0.${i}` })));
    expect(placar(resultados)).toEqual({ erradas: 8, freadas: 12 });
    expect(conferir).toHaveBeenCalledTimes(8);
    const freada = resultados.find((r) => r.status === "rejected" && r.reason instanceof MuitasTentativas) as PromiseRejectedResult;
    expect(freada.reason.message).toMatch(/^Muitas tentativas/);
    // As vagas voltam: passada a rajada, o login entra normalmente.
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "10.0.0.19" })).resolves.toBeTruthy();
  });

  it("freio por IP: 30 erros em e-mails diferentes bloqueiam o IP, não a conta", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    for (let i = 0; i < 30; i++) await expect(entrar(`robo-${i}@exemplo.com`, "chute-xxxxxx", { ip: "5.5.5.5" })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "5.5.5.5" })).rejects.toThrow(MuitasTentativas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "6.6.6.6" })).resolves.toBeTruthy();
  });

  it("freio por conta: 50 erros vindos de IPs diferentes bloqueiam a conta em qualquer IP", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    for (let i = 0; i < 50; i++) await expect(entrar("ana@exemplo.com", "chute-xxxxxx", { ip: `20.0.0.${i}` })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "30.0.0.1" })).rejects.toThrow(MuitasTentativas);
    // Outra conta no mesmo IP segue normal.
    await criarConta({ email: "bia@exemplo.com", senha: "senha-certa-da-bia" });
    await expect(entrar("bia@exemplo.com", "senha-certa-da-bia", { ip: "20.0.0.1" })).resolves.toBeTruthy();
  });

  it("login certo não limpa o freio do IP: só não conta a si mesmo", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    for (let i = 0; i < 29; i++) await expect(entrar(`robo-${i}@exemplo.com`, "chute-xxxxxx", { ip: "4.4.4.4" })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "4.4.4.4" })).resolves.toBeTruthy();
    // Os 29 erros continuam valendo: mais um completa os 30 e o IP trava.
    await expect(entrar("robo-x@exemplo.com", "chute-xxxxxx", { ip: "4.4.4.4" })).rejects.toThrow(CredenciaisInvalidas);
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "4.4.4.4" })).rejects.toThrow(MuitasTentativas);
  });

  it("falha do servidor não conta como tentativa", async () => {
    await criarConta({ email: "ana@exemplo.com", senha: "senha-certa-da-ana" });
    vi.spyOn(senha, "conferirSenha").mockRejectedValue(new Error("falhou"));
    for (let i = 0; i < 6; i++) await expect(entrar("ana@exemplo.com", "qualquer-senha", { ip: "3.3.3.3" })).rejects.toThrow("falhou");
    vi.restoreAllMocks();
    await expect(entrar("ana@exemplo.com", "senha-certa-da-ana", { ip: "3.3.3.3" })).resolves.toBeTruthy();
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
