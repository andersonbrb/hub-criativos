import { beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { sessoes } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { chavesLiberadas, podeUsar, TODAS_AS_CHAVES, type Usuario } from "@/features/acesso/contrato";
import { RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { atualizarMembro, listarMembros } from "@/features/acesso/servicos/membros";
import { criarSessao, usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

describe("permissão por chave", () => {
  beforeEach(async () => {
    await bancoDeTeste();
  });

  it("membro só usa as chaves liberadas; admin e dono passam por tudo", async () => {
    const membro = await criarConta({ email: "m@exemplo.com", chaves: ["biblioteca"] });
    const admin = await criarConta({ email: "a@exemplo.com", papel: "admin" });
    expect(podeUsar(membro, "biblioteca")).toBe(true);
    expect(podeUsar(membro, "estudios")).toBe(false);
    expect(TODAS_AS_CHAVES.every((c) => podeUsar(admin, c))).toBe(true);
    expect(chavesLiberadas(admin)).toEqual(TODAS_AS_CHAVES);
    expect(chavesLiberadas(membro)).toEqual(["biblioteca"]);
    expect(podeUsar({ ...admin, ativo: false }, "biblioteca")).toBe(false);
  });
});

describe("gestão de membros", () => {
  let dono: Usuario;
  let admin: Usuario;
  let membro: Usuario;

  beforeEach(async () => {
    await bancoDeTeste();
    dono = await criarConta({ email: "dono@exemplo.com", nome: "Dono", papel: "dono" });
    admin = await criarConta({ email: "admin@exemplo.com", nome: "Admin", papel: "admin" });
    membro = await criarConta({ email: "membro@exemplo.com", nome: "Membro", chaves: ["chat"] });
  });

  it("lista com dono primeiro e sem expor a senha", async () => {
    const lista = await listarMembros();
    expect(lista.map((m) => m.papel)).toEqual(["dono", "admin", "membro"]);
    expect(lista[0]).not.toHaveProperty("senhaHash");
    expect(lista[0].temSenha).toBe(true);
  });

  it("admin muda as chaves de um membro (limpando as desconhecidas)", async () => {
    const m = await atualizarMembro(membro.id, { chaves: ["memoria", "nada", "memoria"] }, admin);
    expect(m.chaves).toEqual(["memoria"]);
  });

  it("desativar apaga as sessões da pessoa", async () => {
    const { token } = await criarSessao(membro.id);
    await criarSessao(membro.id);
    const outra = await criarSessao(admin.id);
    await atualizarMembro(membro.id, { ativo: false }, admin);
    expect(await usuarioPeloToken(token)).toBeNull();
    const restantes = await banco().select().from(sessoes);
    expect(restantes.map((s) => s.usuarioId)).toEqual([admin.id]);
    expect(await usuarioPeloToken(outra.token)).not.toBeNull();
    // E dá para reativar.
    expect((await atualizarMembro(membro.id, { ativo: true }, admin)).ativo).toBe(true);
  });

  it("último dono protegido: o único dono não sai nem perde o papel", async () => {
    await expect(atualizarMembro(dono.id, { ativo: false }, dono)).rejects.toThrow(/pelo menos um dono ativo/);
    await expect(atualizarMembro(dono.id, { papel: "admin" }, dono)).rejects.toThrow(/pelo menos um dono ativo/);
    // Admin não mexe em dono.
    await expect(atualizarMembro(dono.id, { ativo: false }, admin)).rejects.toThrow(SoQuemPode);
  });

  it("com dois donos, um pode rebaixar o outro, e o que sobra continua protegido", async () => {
    const outro = await criarConta({ email: "dono2@exemplo.com", papel: "dono" });
    expect((await atualizarMembro(outro.id, { papel: "admin" }, dono)).papel).toBe("admin");
    await expect(atualizarMembro(dono.id, { ativo: false }, dono)).rejects.toThrow(RegraDeMembros);
  });

  it("só o dono promove a admin e rebaixa um admin", async () => {
    await expect(atualizarMembro(membro.id, { papel: "admin" }, admin)).rejects.toThrow(SoQuemPode);
    const outroAdmin = await criarConta({ email: "admin2@exemplo.com", papel: "admin" });
    await expect(atualizarMembro(outroAdmin.id, { papel: "membro" }, admin)).rejects.toThrow(SoQuemPode);
    // Desativar um admin também é com o dono.
    await expect(atualizarMembro(outroAdmin.id, { ativo: false }, admin)).rejects.toThrow(SoQuemPode);

    expect((await atualizarMembro(outroAdmin.id, { papel: "membro" }, dono)).papel).toBe("membro");
    expect((await atualizarMembro(membro.id, { papel: "admin" }, dono)).papel).toBe("admin");
  });

  it("ninguém se desativa nem muda o próprio papel; ninguém vira dono pela tela", async () => {
    await expect(atualizarMembro(admin.id, { ativo: false }, admin)).rejects.toThrow(/sua própria conta/);
    await expect(atualizarMembro(admin.id, { papel: "membro" }, admin)).rejects.toThrow(/seu próprio papel/);
    await expect(atualizarMembro(membro.id, { papel: "dono" }, dono)).rejects.toThrow(/script/);
    // Mudar o próprio nome pode.
    expect((await atualizarMembro(admin.id, { nome: "  Admin   Novo " }, admin)).nome).toBe("Admin Novo");
  });

  it("membro comum não gerencia ninguém, mesmo com a chave de membros", async () => {
    const comChave = await criarConta({ email: "c@exemplo.com", chaves: ["membros"] });
    await expect(atualizarMembro(membro.id, { chaves: [] }, comChave)).rejects.toThrow(SoQuemPode);
  });

  it("quem perdeu o cargo depois de entrar já não gerencia", async () => {
    await atualizarMembro(admin.id, { papel: "membro" }, dono);
    // O objeto "admin" é o da sessão antiga; o serviço confere o banco.
    await expect(atualizarMembro(membro.id, { chaves: [] }, admin)).rejects.toThrow(SoQuemPode);
  });
});
