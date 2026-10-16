import { beforeEach, describe, expect, it } from "vitest";

import { bancoDeTeste } from "@/db/teste";
import { chavesLiberadas, ORGANIZACAO_PADRAO, podeUsar, TODAS_AS_CHAVES, type Usuario } from "@/features/acesso/contrato";
import { MembroNaoEncontrado, RegraDeMembros, SoQuemPode } from "@/features/acesso/erros";
import { atualizarMembro, listarMembros, removerMembro, sairDaOrganizacao } from "@/features/acesso/servicos/membros";
import { minhasOrganizacoes, renomearOrganizacao } from "@/features/acesso/servicos/organizacoes";
import { criarSessao, usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta, criarOrganizacao, vincular } from "@/features/acesso/testes/ajuda";

const ORG = ORGANIZACAO_PADRAO.id;

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
    // Organização suspensa: ninguém usa nada, nem o dono.
    expect(podeUsar({ ...admin, organizacao: { ...admin.organizacao!, situacao: "suspensa" } }, "biblioteca")).toBe(false);
    expect(podeUsar({ ...admin, organizacao: null }, "biblioteca")).toBe(false);
  });
});

describe("gestão da equipe", () => {
  let dono: Usuario;
  let admin: Usuario;
  let membro: Usuario;

  beforeEach(async () => {
    await bancoDeTeste();
    dono = await criarConta({ email: "dono@exemplo.com", nome: "Dono", papel: "dono" });
    admin = await criarConta({ email: "admin@exemplo.com", nome: "Admin", papel: "admin" });
    membro = await criarConta({ email: "membro@exemplo.com", nome: "Membro", chaves: ["chat"] });
  });

  it("lista a equipe da organização, com dono primeiro e sem expor a senha", async () => {
    const lista = await listarMembros(ORG);
    expect(lista.map((m) => m.papel)).toEqual(["dono", "admin", "membro"]);
    expect(lista[0]).not.toHaveProperty("senhaHash");
    expect(lista[0].temSenha).toBe(true);
    // Quem é de outra organização não aparece.
    await criarConta({ email: "fora@exemplo.com", organizacaoId: await criarOrganizacao() });
    expect(await listarMembros(ORG)).toHaveLength(3);
  });

  it("admin muda as chaves de um membro (limpando as desconhecidas)", async () => {
    const m = await atualizarMembro(membro.id, { chaves: ["memoria", "nada", "memoria"] }, admin);
    expect(m.chaves).toEqual(["memoria"]);
  });

  it("desativar vale na hora: a sessão continua, mas sem acesso; e dá para reativar", async () => {
    const { token } = await criarSessao(membro.id);
    await atualizarMembro(membro.id, { ativo: false }, admin);
    expect(await usuarioPeloToken(token)).toMatchObject({ ativo: false });
    expect((await atualizarMembro(membro.id, { ativo: true }, admin)).ativo).toBe(true);
    expect(await usuarioPeloToken(token)).toMatchObject({ ativo: true, chaves: ["chat"] });
  });

  it("último dono protegido: o único dono não sai nem perde o papel", async () => {
    await expect(atualizarMembro(dono.id, { ativo: false }, dono)).rejects.toThrow(/pelo menos um dono ativo/);
    await expect(atualizarMembro(dono.id, { papel: "admin" }, dono)).rejects.toThrow(/pelo menos um dono ativo/);
    await expect(sairDaOrganizacao(dono)).rejects.toThrow(/único dono/);
    // Admin não mexe em dono.
    await expect(atualizarMembro(dono.id, { ativo: false }, admin)).rejects.toThrow(SoQuemPode);
    await expect(removerMembro(dono.id, admin)).rejects.toThrow(SoQuemPode);
  });

  it("dono dá o papel de dono a outra pessoa; com dois donos, um pode rebaixar o outro", async () => {
    expect((await atualizarMembro(admin.id, { papel: "dono" }, dono)).papel).toBe("dono");
    expect((await atualizarMembro(admin.id, { papel: "admin" }, dono)).papel).toBe("admin");
    const outro = await criarConta({ email: "dono2@exemplo.com", papel: "dono" });
    expect((await atualizarMembro(outro.id, { papel: "admin" }, dono)).papel).toBe("admin");
    await expect(atualizarMembro(dono.id, { ativo: false }, dono)).rejects.toThrow(RegraDeMembros);
  });

  it("só um dono muda papéis e mexe em admins", async () => {
    await expect(atualizarMembro(membro.id, { papel: "admin" }, admin)).rejects.toThrow(SoQuemPode);
    const outroAdmin = await criarConta({ email: "admin2@exemplo.com", papel: "admin" });
    await expect(atualizarMembro(outroAdmin.id, { papel: "membro" }, admin)).rejects.toThrow(SoQuemPode);
    // Desativar ou remover um admin também é com um dono.
    await expect(atualizarMembro(outroAdmin.id, { ativo: false }, admin)).rejects.toThrow(SoQuemPode);
    await expect(removerMembro(outroAdmin.id, admin)).rejects.toThrow(SoQuemPode);

    expect((await atualizarMembro(outroAdmin.id, { papel: "membro" }, dono)).papel).toBe("membro");
    expect((await atualizarMembro(membro.id, { papel: "admin" }, dono)).papel).toBe("admin");
  });

  it("ninguém se desativa, se remove nem muda o próprio papel", async () => {
    await expect(atualizarMembro(admin.id, { ativo: false }, admin)).rejects.toThrow(/a si mesmo/);
    await expect(atualizarMembro(admin.id, { papel: "membro" }, admin)).rejects.toThrow(/seu próprio papel/);
    await expect(removerMembro(admin.id, admin)).rejects.toThrow(/Sair da organização/);
  });

  it("membro comum não gerencia ninguém, mesmo com a chave da equipe", async () => {
    const comChave = await criarConta({ email: "c@exemplo.com", chaves: ["membros"] });
    await expect(atualizarMembro(membro.id, { chaves: [] }, comChave)).rejects.toThrow(SoQuemPode);
  });

  it("quem perdeu o cargo depois de entrar já não gerencia", async () => {
    await atualizarMembro(admin.id, { papel: "membro" }, dono);
    // O objeto "admin" é o da sessão antiga; o serviço confere o banco.
    await expect(atualizarMembro(membro.id, { chaves: [] }, admin)).rejects.toThrow(SoQuemPode);
  });

  it("remover tira só desta organização: a conta e as outras organizações continuam", async () => {
    const outra = await criarOrganizacao("Loja do Membro");
    await vincular(membro.id, outra, { papel: "dono" });
    await removerMembro(membro.id, admin);
    expect((await listarMembros(ORG)).map((m) => m.email)).not.toContain("membro@exemplo.com");
    expect((await minhasOrganizacoes(membro.id)).map((o) => o.id)).toEqual([outra]);
    await expect(removerMembro(membro.id, admin)).rejects.toThrow(MembroNaoEncontrado);
  });

  it("um admin de uma organização não mexe na equipe de outra", async () => {
    const outra = await criarOrganizacao("Outra");
    const deFora = await criarConta({ email: "x@exemplo.com", organizacaoId: outra });
    await expect(atualizarMembro(deFora.id, { chaves: ["chat"] }, admin)).rejects.toThrow(MembroNaoEncontrado);
    await expect(removerMembro(deFora.id, admin)).rejects.toThrow(MembroNaoEncontrado);
  });

  it("sair da organização: a pessoa some da equipe; o dono com outro dono também sai", async () => {
    await sairDaOrganizacao(membro);
    expect((await listarMembros(ORG)).map((m) => m.email)).not.toContain("membro@exemplo.com");
    await atualizarMembro(admin.id, { papel: "dono" }, dono);
    await sairDaOrganizacao(dono);
    expect((await listarMembros(ORG)).map((m) => m.papel)).toEqual(["dono"]);
  });

  it("dono e admin mudam o nome da organização; membro não", async () => {
    expect((await renomearOrganizacao("  Grupo   Chegou Brasil ", admin)).nome).toBe("Grupo Chegou Brasil");
    await expect(renomearOrganizacao("Outro nome", membro)).rejects.toThrow(SoQuemPode);
    await expect(renomearOrganizacao("   ", dono)).rejects.toThrow(/nome da organização/);
  });
});
