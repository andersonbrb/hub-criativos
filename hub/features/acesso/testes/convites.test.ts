import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco } from "@/db/cliente";
import { convites, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import type { Usuario } from "@/features/acesso/contrato";
import { ConviteInvalido, RegraDeMembros, SenhaFraca, SoQuemPode } from "@/features/acesso/erros";
import { aceitarConvite, buscarConvite, criarConvite, listarConvites, revogarConvite } from "@/features/acesso/servicos/convites";
import * as senha from "@/features/acesso/servicos/senha";
import { usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

const tokenDo = (link: string) => link.replace("/aceitar-convite/", "");

describe("convites", () => {
  let dono: Usuario;
  let admin: Usuario;

  beforeEach(async () => {
    await bancoDeTeste();
    dono = await criarConta({ email: "dono@exemplo.com", papel: "dono" });
    admin = await criarConta({ email: "admin@exemplo.com", papel: "admin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aceito: cria a conta com papel e chaves do convite e já abre a sessão", async () => {
    const { link, convite } = await criarConvite({ email: "Nova@Exemplo.com", nome: "Nova", papel: "membro", chaves: ["memoria", "chat", "xyz"] }, admin);
    expect(link).toMatch(/^\/aceitar-convite\/[\w-]{40,}$/);
    expect(convite).toMatchObject({ email: "nova@exemplo.com", chaves: ["memoria", "chat"], vencido: false, criadoPor: "admin" });
    // No banco fica só o hash.
    const [linha] = await banco().select().from(convites);
    expect(linha.tokenHash).not.toBe(tokenDo(link));

    expect(await buscarConvite(tokenDo(link))).toMatchObject({ email: "nova@exemplo.com", nome: "Nova", papel: "membro" });

    const { usuario, token } = await aceitarConvite(tokenDo(link), { nome: "Nova Pessoa", senha: "uma-senha-boa-123" });
    expect(usuario).toMatchObject({ email: "nova@exemplo.com", nome: "Nova Pessoa", papel: "membro", ativo: true, chaves: ["memoria", "chat"] });
    expect((await usuarioPeloToken(token))?.id).toBe(usuario.id);
    expect(await listarConvites()).toHaveLength(0);
  });

  it("usado duas vezes: a segunda dá erro claro", async () => {
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await aceitarConvite(tokenDo(link), { nome: "Nova", senha: "uma-senha-boa-123" });
    await expect(aceitarConvite(tokenDo(link), { nome: "Outra", senha: "outra-senha-boa-123" })).rejects.toThrow(/já foi usado/);
    await expect(buscarConvite(tokenDo(link))).rejects.toThrow(ConviteInvalido);
    expect(await banco().select().from(usuarios).where(eq(usuarios.email, "nova@exemplo.com"))).toHaveLength(1);
  });

  it("vencido: não aceita", async () => {
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await banco().update(convites).set({ expiraEm: new Date(Date.now() - 1000) });
    await expect(buscarConvite(tokenDo(link))).rejects.toThrow(/venceu/);
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "uma-senha-boa-123" })).rejects.toThrow(/venceu/);
    expect((await listarConvites())[0].vencido).toBe(true);
  });

  it("token inventado ou revogado não serve", async () => {
    await expect(buscarConvite("a".repeat(43))).rejects.toThrow(/não existe/);
    const { link, convite } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await revogarConvite(convite.id, admin);
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "uma-senha-boa-123" })).rejects.toThrow(/não existe ou foi revogado/);
  });

  it("e-mail com conta ativa: recusa ao criar e ao aceitar", async () => {
    await expect(criarConvite({ email: "admin@exemplo.com" }, dono)).rejects.toThrow(RegraDeMembros);
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await criarConta({ email: "nova@exemplo.com" });
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "uma-senha-boa-123" })).rejects.toThrow(/conta ativa/);
    // A recusa não queima o convite.
    expect(await listarConvites()).toHaveLength(1);
  });

  it("reativa conta desativada com o mesmo e-mail, com o papel e as chaves do convite", async () => {
    const antiga = await criarConta({ email: "volta@exemplo.com", papel: "admin", ativo: false, chaves: ["integracoes"] });
    const { link } = await criarConvite({ email: "volta@exemplo.com", chaves: ["biblioteca"] }, dono);
    const { usuario } = await aceitarConvite(tokenDo(link), { nome: "De Volta", senha: "uma-senha-boa-123" });
    expect(usuario).toMatchObject({ id: antiga.id, ativo: true, papel: "membro", chaves: ["biblioteca"], nome: "De Volta" });
  });

  it("conta desativada de admin ou dono: só o dono convida de volta", async () => {
    await criarConta({ email: "ex-admin@exemplo.com", papel: "admin", ativo: false });
    await criarConta({ email: "ex-dono@exemplo.com", papel: "dono", ativo: false });
    await expect(criarConvite({ email: "ex-admin@exemplo.com" }, admin)).rejects.toThrow(SoQuemPode);
    await expect(criarConvite({ email: "ex-dono@exemplo.com" }, admin)).rejects.toThrow(SoQuemPode);
    expect(await listarConvites()).toHaveLength(0);

    // Membro desativado o admin pode chamar de volta.
    await criarConta({ email: "ex-membro@exemplo.com", ativo: false });
    const { link: doMembro } = await criarConvite({ email: "ex-membro@exemplo.com" }, admin);
    await expect(aceitarConvite(tokenDo(doMembro), { nome: "Ex Membro", senha: "uma-senha-boa-123" })).resolves.toBeTruthy();

    // Convite do admin feito quando a conta era de membro; depois ela virou admin: não vale mais, nem queima.
    const virou = await criarConta({ email: "virou@exemplo.com", ativo: false });
    const { link } = await criarConvite({ email: "virou@exemplo.com" }, admin);
    await banco().update(usuarios).set({ papel: "admin" }).where(eq(usuarios.id, virou.id));
    await expect(buscarConvite(tokenDo(link))).rejects.toThrow(/só o dono/);
    await expect(aceitarConvite(tokenDo(link), { nome: "Virou", senha: "uma-senha-boa-123" })).rejects.toThrow(/só o dono/);
    const [conta] = await banco().select().from(usuarios).where(eq(usuarios.id, virou.id));
    expect(conta).toMatchObject({ ativo: false, papel: "admin" });

    // O dono pode.
    const { link: doDono } = await criarConvite({ email: "ex-dono@exemplo.com" }, dono);
    const { usuario } = await aceitarConvite(tokenDo(doDono), { nome: "Ex Dono", senha: "uma-senha-boa-123" });
    expect(usuario).toMatchObject({ email: "ex-dono@exemplo.com", ativo: true, papel: "membro" });
  });

  it("convite que não serve é recusado sem gastar o hash da senha", async () => {
    const hash = vi.spyOn(senha, "gerarHashDeSenha");
    const dados = { nome: "Nova", senha: "uma-senha-boa-123" };
    await expect(aceitarConvite("a".repeat(43), dados)).rejects.toThrow(/não existe/);
    await expect(aceitarConvite("curto", dados)).rejects.toThrow(ConviteInvalido);

    const vencido = await criarConvite({ email: "vencido@exemplo.com" }, admin);
    await banco().update(convites).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(convites.email, "vencido@exemplo.com"));
    await expect(aceitarConvite(tokenDo(vencido.link), dados)).rejects.toThrow(/venceu/);

    const revogado = await criarConvite({ email: "revogado@exemplo.com" }, admin);
    await revogarConvite(revogado.convite.id, admin);
    await expect(aceitarConvite(tokenDo(revogado.link), dados)).rejects.toThrow(/revogado/);

    // Conta ativa criada sem senha (criarConta não gera hash nesse caso).
    const ativo = await criarConvite({ email: "ativa@exemplo.com" }, admin);
    await criarConta({ email: "ativa@exemplo.com", senha: null });
    await expect(aceitarConvite(tokenDo(ativo.link), dados)).rejects.toThrow(/conta ativa/);
    expect(hash).not.toHaveBeenCalled();

    // O convite bom gasta um hash só.
    const bom = await criarConvite({ email: "boa@exemplo.com" }, admin);
    await aceitarConvite(tokenDo(bom.link), dados);
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it("senha curta não cria conta nem queima o convite", async () => {
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "curta" })).rejects.toThrow(SenhaFraca);
    expect(await listarConvites()).toHaveLength(1);
  });

  it("convite novo para o mesmo e-mail substitui o anterior", async () => {
    const primeiro = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await criarConvite({ email: "nova@exemplo.com" }, admin);
    expect(await listarConvites()).toHaveLength(1);
    await expect(buscarConvite(tokenDo(primeiro.link))).rejects.toThrow(ConviteInvalido);
  });

  it("só o dono convida como admin; ninguém convida como dono; membro não convida", async () => {
    await expect(criarConvite({ email: "x@exemplo.com", papel: "admin" }, admin)).rejects.toThrow(SoQuemPode);
    await expect(criarConvite({ email: "x@exemplo.com", papel: "dono" }, dono)).rejects.toThrow(RegraDeMembros);
    const { convite } = await criarConvite({ email: "x@exemplo.com", papel: "admin" }, dono);
    expect(convite.papel).toBe("admin");
    const membro = await criarConta({ email: "m@exemplo.com", chaves: ["membros"] });
    await expect(criarConvite({ email: "y@exemplo.com" }, membro)).rejects.toThrow(SoQuemPode);
  });
});
