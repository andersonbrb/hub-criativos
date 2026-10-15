import { describe, expect, it } from "vitest";

import { SenhaFraca } from "@/features/acesso/erros";
import { conferirSenha, gerarHashDeSenha, gerarSenhaForte, validarSenha } from "@/features/acesso/servicos/senha";

describe("senha", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const hash = await gerarHashDeSenha("cavalo-bateria-grampo");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await conferirSenha("cavalo-bateria-grampo", hash)).toBe(true);
    expect(await conferirSenha("cavalo-bateria-grampO", hash)).toBe(false);
    expect(await conferirSenha("", hash)).toBe(false);
  });

  it("cada hash tem salt próprio", async () => {
    const [a, b] = await Promise.all([gerarHashDeSenha("mesma-senha-123"), gerarHashDeSenha("mesma-senha-123")]);
    expect(a).not.toBe(b);
  });

  it("hash ausente ou estragado nunca confere", async () => {
    expect(await conferirSenha("qualquer-coisa", null)).toBe(false);
    expect(await conferirSenha("qualquer-coisa", "bcrypt$abc")).toBe(false);
    expect(await conferirSenha("qualquer-coisa", "scrypt$0$8$1$abc$def")).toBe(false);
  });

  it("exige pelo menos 10 caracteres", () => {
    expect(() => validarSenha("curta")).toThrow(SenhaFraca);
    expect(validarSenha("1234567890")).toBe("1234567890");
  });

  it("a senha gerada para o dono é longa e passa na regra", () => {
    const senha = gerarSenhaForte();
    expect(senha.length).toBeGreaterThanOrEqual(24);
    expect(() => validarSenha(senha)).not.toThrow();
  });
});
