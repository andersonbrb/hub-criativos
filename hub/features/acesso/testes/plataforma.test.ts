import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, SemPermissao, type Usuario } from "@/features/acesso/contrato";
import { aceitarConvite } from "@/features/acesso/servicos/convites";
import { freio } from "@/features/acesso/servicos/login";
import { minhasOrganizacoes } from "@/features/acesso/servicos/organizacoes";
import { alterarOrganizacao, convidarDono, criarOrganizacao, listarOrganizacoes } from "@/features/acesso/servicos/plataforma";
import { usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta } from "@/features/acesso/testes/ajuda";

// Tela Plataforma: quem opera a plataforma cria organizações (com o convite do primeiro dono), muda o nome e suspende.

const tokenDo = (link: string) => link.replace("/aceitar-convite/", "");

describe("plataforma", () => {
  let operador: Usuario;

  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
    delete process.env.DONOS_DA_PLATAFORMA;
    operador = await criarConta({ email: "vini@exemplo.com", nome: "Vini", papel: "dono", operaPlataforma: true, senha: "senha-do-vini-123" });
  });
  afterEach(() => {
    delete process.env.DONOS_DA_PLATAFORMA;
  });

  it("cria a organização vazia e o convite do primeiro dono; o dono entra nela", async () => {
    const { organizacao, link } = await criarOrganizacao({ nome: "  Loja   da Bia ", email: "Bia@Exemplo.com", nomeDoDono: "Bia" }, operador);
    expect(organizacao).toMatchObject({ nome: "Loja da Bia", situacao: "ativa", membros: 0, donos: [], convitesPendentes: 1, padrao: false });

    const { usuario, token } = await aceitarConvite(tokenDo(link), { senha: "senha-boa-da-bia" });
    expect(usuario).toMatchObject({ email: "bia@exemplo.com", nome: "Bia", papel: "dono", organizacao: { id: organizacao.id } });
    expect((await usuarioPeloToken(token))?.organizacao?.id).toBe(organizacao.id);

    const lista = await listarOrganizacoes(operador);
    expect(lista.map((o) => [o.nome, o.membros, o.donos])).toEqual([
      ["Grupo Chegou", 1, ["Vini"]],
      ["Loja da Bia", 1, ["Bia"]],
    ]);
    // O operador não entra nas organizações dos outros: só vê a lista.
    expect((await minhasOrganizacoes(operador.id)).map((o) => o.nome)).toEqual(["Grupo Chegou"]);
  });

  it("o operador pode se convidar como primeiro dono (confirma com a senha dele)", async () => {
    const { organizacao, link } = await criarOrganizacao({ nome: "Teste", email: "vini@exemplo.com" }, operador);
    const { usuario } = await aceitarConvite(tokenDo(link), { senha: "senha-do-vini-123" });
    expect(usuario).toMatchObject({ id: operador.id, papel: "dono", organizacao: { id: organizacao.id } });
  });

  it("suspende e reativa; a organização padrão não é suspensa", async () => {
    const { organizacao } = await criarOrganizacao({ nome: "Loja", email: "bia@exemplo.com" }, operador);
    expect((await alterarOrganizacao(organizacao.id, { situacao: "suspensa" }, operador)).situacao).toBe("suspensa");
    expect((await alterarOrganizacao(organizacao.id, { situacao: "ativa", nome: "Loja Nova" }, operador)).nome).toBe("Loja Nova");
    await expect(alterarOrganizacao(ORGANIZACAO_PADRAO.id, { situacao: "suspensa" }, operador)).rejects.toThrow(/não pode ser suspensa/);
    await expect(alterarOrganizacao(organizacao.id, { situacao: "apagada" }, operador)).rejects.toThrow(/Situação inválida/);
  });

  it("novo link de dono; recusa quem já é da organização", async () => {
    const { organizacao } = await criarOrganizacao({ nome: "Loja", email: "bia@exemplo.com" }, operador);
    const { link } = await convidarDono(organizacao.id, { email: "socio@exemplo.com" }, operador);
    await aceitarConvite(tokenDo(link), { nome: "Sócio", senha: "senha-do-socio-1" });
    await expect(convidarDono(organizacao.id, { email: "socio@exemplo.com" }, operador)).rejects.toThrow(/já faz parte/);
  });

  it("só quem opera a plataforma (e está em DONOS_DA_PLATAFORMA, se ela existir)", async () => {
    const dono = await criarConta({ email: "dono@exemplo.com", papel: "dono" });
    await expect(listarOrganizacoes(dono)).rejects.toThrow(SemPermissao);
    await expect(criarOrganizacao({ nome: "X", email: "x@exemplo.com" }, dono)).rejects.toThrow(SemPermissao);
    process.env.DONOS_DA_PLATAFORMA = "outra@exemplo.com";
    await expect(listarOrganizacoes(operador)).rejects.toThrow(SemPermissao);
  });
});
