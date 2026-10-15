import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { banco } from "@/db/cliente";
import { convites, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import type { Usuario } from "@/features/acesso/contrato";
import { ConviteInvalido, RegraDeMembros, SenhaFraca, SoQuemPode } from "@/features/acesso/erros";
import { aceitarConvite, buscarConvite, criarConvite, listarConvites, revogarConvite } from "@/features/acesso/servicos/convites";
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
    const { link } = await criarConvite({ email: "volta@exemplo.com", chaves: ["biblioteca"] }, admin);
    const { usuario } = await aceitarConvite(tokenDo(link), { nome: "De Volta", senha: "uma-senha-boa-123" });
    expect(usuario).toMatchObject({ id: antiga.id, ativo: true, papel: "membro", chaves: ["biblioteca"], nome: "De Volta" });
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
