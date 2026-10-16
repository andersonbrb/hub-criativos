import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco } from "@/db/cliente";
import { convites, organizacoes, usuarios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Usuario } from "@/features/acesso/contrato";
import { ConviteInvalido, SenhaFraca, SoQuemPode } from "@/features/acesso/erros";
import { aceitarConvite, buscarConvite, criarConvite, listarConvites, revogarConvite } from "@/features/acesso/servicos/convites";
import { freio } from "@/features/acesso/servicos/login";
import { minhasOrganizacoes } from "@/features/acesso/servicos/organizacoes";
import * as senha from "@/features/acesso/servicos/senha";
import { usuarioPeloToken } from "@/features/acesso/servicos/sessoes";
import { criarConta, criarOrganizacao } from "@/features/acesso/testes/ajuda";

const ORG = ORGANIZACAO_PADRAO.id;
const tokenDo = (link: string) => link.replace("/aceitar-convite/", "");

describe("convites", () => {
  let dono: Usuario;
  let admin: Usuario;

  beforeEach(async () => {
    await bancoDeTeste();
    freio.zerar();
    freio.atrasoMs = 0;
    dono = await criarConta({ email: "dono@exemplo.com", papel: "dono" });
    admin = await criarConta({ email: "admin@exemplo.com", papel: "admin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aceito: cria a conta, entra na organização com papel e chaves do convite e já abre a sessão nela", async () => {
    const { link, convite } = await criarConvite({ email: "Nova@Exemplo.com", nome: "Nova", papel: "membro", chaves: ["memoria", "chat", "xyz"] }, admin);
    expect(link).toMatch(/^\/aceitar-convite\/[\w-]{40,}$/);
    expect(convite).toMatchObject({ email: "nova@exemplo.com", chaves: ["memoria", "chat"], vencido: false, criadoPor: "admin" });
    // No banco fica só o hash.
    const [linha] = await banco().select().from(convites);
    expect(linha.tokenHash).not.toBe(tokenDo(link));
    expect(linha.organizacaoId).toBe(ORG);

    expect(await buscarConvite(tokenDo(link))).toMatchObject({ email: "nova@exemplo.com", nome: "Nova", papel: "membro", organizacao: "Grupo Chegou", contaExiste: false });

    const { usuario, token } = await aceitarConvite(tokenDo(link), { nome: "Nova Pessoa", senha: "uma-senha-boa-123" });
    expect(usuario).toMatchObject({ email: "nova@exemplo.com", nome: "Nova Pessoa", papel: "membro", ativo: true, chaves: ["memoria", "chat"], organizacao: { id: ORG } });
    expect((await usuarioPeloToken(token))?.id).toBe(usuario.id);
    expect(await listarConvites(ORG)).toHaveLength(0);
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
    expect((await listarConvites(ORG))[0].vencido).toBe(true);
  });

  it("token inventado ou revogado não serve", async () => {
    await expect(buscarConvite("a".repeat(43))).rejects.toThrow(/não existe/);
    const { link, convite } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await revogarConvite(convite.id, admin);
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "uma-senha-boa-123" })).rejects.toThrow(/não existe ou foi revogado/);
  });

  it("quem já está na equipe não é convidado: ativo edita na lista, desativado reativa na lista", async () => {
    await expect(criarConvite({ email: "admin@exemplo.com" }, dono)).rejects.toThrow(/já faz parte/);
    await criarConta({ email: "fora@exemplo.com", ativo: false });
    await expect(criarConvite({ email: "fora@exemplo.com" }, dono)).rejects.toThrow(/Reative/);
    expect(await listarConvites(ORG)).toHaveLength(0);
  });

  it("conta de outra organização: confirma com a senha dela e entra nesta, sem trocar nome nem senha", async () => {
    const loja = await criarOrganizacao("Loja da Bia");
    const bia = await criarConta({ email: "bia@exemplo.com", nome: "Bia", senha: "senha-antiga-da-bia", papel: "dono", organizacaoId: loja });
    const { link } = await criarConvite({ email: "bia@exemplo.com", chaves: ["fluxo"] }, admin);
    expect(await buscarConvite(tokenDo(link))).toMatchObject({ contaExiste: true, organizacao: "Grupo Chegou" });

    // Senha errada: não entra e o convite continua valendo.
    await expect(aceitarConvite(tokenDo(link), { senha: "chute-qualquer-xx" })).rejects.toThrow(/Senha incorreta/);
    expect(await listarConvites(ORG)).toHaveLength(1);

    const { usuario } = await aceitarConvite(tokenDo(link), { nome: "Outro Nome", senha: "senha-antiga-da-bia" });
    expect(usuario).toMatchObject({ id: bia.id, nome: "Bia", papel: "membro", chaves: ["fluxo"], organizacao: { id: ORG } });
    expect((await minhasOrganizacoes(bia.id)).map((o) => [o.nome, o.papel])).toEqual([
      ["Grupo Chegou", "membro"],
      ["Loja da Bia", "dono"],
    ]);
  });

  it("organização suspensa: o convite não vale", async () => {
    const suspensa = await criarOrganizacao("Suspensa");
    const donaDela = await criarConta({ email: "dona@exemplo.com", papel: "dono", organizacaoId: suspensa });
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, donaDela);
    await banco().update(organizacoes).set({ situacao: "suspensa" }).where(eq(organizacoes.id, suspensa));
    await expect(buscarConvite(tokenDo(link))).rejects.toThrow(/suspensa/);
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
    expect(hash).not.toHaveBeenCalled();

    // O convite bom gasta um hash só.
    const bom = await criarConvite({ email: "boa@exemplo.com" }, admin);
    await aceitarConvite(tokenDo(bom.link), dados);
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it("senha curta não cria conta nem queima o convite", async () => {
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "curta" })).rejects.toThrow(SenhaFraca);
    expect(await listarConvites(ORG)).toHaveLength(1);
  });

  it("convite novo para o mesmo e-mail substitui o anterior da mesma organização (o de outra continua)", async () => {
    const primeiro = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await criarConvite({ email: "nova@exemplo.com" }, admin);
    expect(await listarConvites(ORG)).toHaveLength(1);
    await expect(buscarConvite(tokenDo(primeiro.link))).rejects.toThrow(ConviteInvalido);

    const outra = await criarOrganizacao("Outra");
    const donaDaOutra = await criarConta({ email: "dona@exemplo.com", papel: "dono", organizacaoId: outra });
    await criarConvite({ email: "nova@exemplo.com" }, donaDaOutra);
    expect(await listarConvites(ORG)).toHaveLength(1);
    expect(await listarConvites(outra)).toHaveLength(1);
  });

  it("cada organização só vê e revoga os próprios convites", async () => {
    const { convite } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    const outra = await criarOrganizacao("Outra");
    const donaDaOutra = await criarConta({ email: "dona@exemplo.com", papel: "dono", organizacaoId: outra });
    expect(await listarConvites(outra)).toHaveLength(0);
    await expect(revogarConvite(convite.id, donaDaOutra)).rejects.toThrow(/não existe mais/);
    expect(await listarConvites(ORG)).toHaveLength(1);
  });

  it("só um dono convida como admin ou dono; membro não convida", async () => {
    await expect(criarConvite({ email: "x@exemplo.com", papel: "admin" }, admin)).rejects.toThrow(SoQuemPode);
    await expect(criarConvite({ email: "x@exemplo.com", papel: "dono" }, admin)).rejects.toThrow(SoQuemPode);
    await expect(criarConvite({ email: "x@exemplo.com", papel: "chefe" }, dono)).rejects.toThrow(/Papel inválido/);
    const { convite } = await criarConvite({ email: "x@exemplo.com", papel: "admin" }, dono);
    expect(convite.papel).toBe("admin");
    const { link } = await criarConvite({ email: "socio@exemplo.com", papel: "dono" }, dono);
    expect((await aceitarConvite(tokenDo(link), { nome: "Sócio", senha: "uma-senha-boa-123" })).usuario.papel).toBe("dono");
    const membro = await criarConta({ email: "m@exemplo.com", chaves: ["membros"] });
    await expect(criarConvite({ email: "y@exemplo.com" }, membro)).rejects.toThrow(SoQuemPode);
  });

  it("e-mail já da equipe que entra por outro caminho no meio do caminho: o convite não duplica", async () => {
    const { link } = await criarConvite({ email: "nova@exemplo.com" }, admin);
    await criarConta({ email: "nova@exemplo.com" });
    await expect(aceitarConvite(tokenDo(link), { nome: "Nova", senha: "senha-de-teste-123" })).rejects.toThrow(/já faz parte/);
    expect(await listarConvites(ORG)).toHaveLength(1);
  });
});
