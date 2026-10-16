import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco, usarBanco } from "@/db/cliente";
import { driveConta, drivePedidosLogin } from "@/db/schema";
import {
  CAMINHO_DE_VOLTA,
  cifrar,
  concluirLogin,
  decifrar,
  desconectar,
  DriveNaoConectado,
  DriveSemChave,
  ESCOPO_DRIVE,
  esquecerTokenDeAcesso,
  gravarPasta,
  iniciarLogin,
  oQueFaltaParaConectar,
  pastaEscolhida,
  statusDrive,
  tokenDeAcesso,
} from "@/features/drive/servicos/conta";
import { contaConectada, criarPessoa, googleFalso, json, ORIGEM, prepararConta, tokensDoGoogle } from "@/features/drive/testes/conta-apoio";

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("base64url");
const lerConta = async () => (await banco().select().from(driveConta))[0] ?? null;
const pedidos = () => banco().select().from(drivePedidosLogin);

// Rejeição de login com o código de aviso esperado (tela/avisos.ts).
async function recusaCom(promessa: Promise<unknown>, motivo: string) {
  await expect(promessa).rejects.toMatchObject({ motivo });
}

async function comecarLogin(quem?: string, volta = "/integracoes") {
  const url = new URL(await iniciarLogin(volta, ORIGEM, quem));
  return { url, state: url.searchParams.get("state")! };
}

beforeEach(prepararConta);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("drive: cifra dos segredos", () => {
  it("cifra e decifra, com um começo aleatório novo a cada vez", () => {
    const segredo = "1//0g-autorizacao-permanente-do-google";
    const a = cifrar(segredo);
    const b = cifrar(segredo);
    expect(a).not.toBe(b);
    expect(a).not.toContain(segredo);
    expect(a.startsWith("v1.")).toBe(true);
    expect(decifrar(a)).toBe(segredo);
    expect(decifrar(b)).toBe(segredo);
  });

  it("valor adulterado no banco ou chave trocada não abre", () => {
    const cifrado = cifrar("refresh-token");
    const partes = cifrado.split(".");
    partes[3] = (partes[3][0] === "A" ? "B" : "A") + partes[3].slice(1);
    expect(() => decifrar(partes.join("."))).toThrow(/HUB_CHAVE_SEGREDOS/);
    // Etiqueta encurtada: o GCM só aceita a de 16 bytes.
    const curta = cifrado.split(".");
    curta[2] = curta[2].slice(0, 8);
    expect(() => decifrar(curta.join("."))).toThrow(/HUB_CHAVE_SEGREDOS/);

    process.env.HUB_CHAVE_SEGREDOS = Buffer.alloc(32, 9).toString("base64");
    expect(() => decifrar(cifrado)).toThrow(/não é a mesma/);
  });

  it("sem a chave, ou com tamanho errado, recusa com mensagem clara", () => {
    delete process.env.HUB_CHAVE_SEGREDOS;
    expect(() => cifrar("x")).toThrow(/Falta HUB_CHAVE_SEGREDOS/);
    process.env.HUB_CHAVE_SEGREDOS = Buffer.alloc(16, 1).toString("base64");
    expect(() => cifrar("x")).toThrow(/32 bytes/);
  });
});

describe("drive: login", () => {
  it("gera o endereço do Google com PKCE S256, state, offline e consent, e guarda o pedido", async () => {
    const pessoa = await criarPessoa();
    const { url, state } = await comecarLogin(pessoa.id);

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      client_id: "cliente-teste.apps.googleusercontent.com",
      redirect_uri: `${ORIGEM}${CAMINHO_DE_VOLTA}`,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      code_challenge_method: "S256",
    });
    expect(q.scope.split(" ").sort()).toEqual([ESCOPO_DRIVE, "email", "openid", "profile"].sort());
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(url.searchParams.has("client_secret")).toBe(false);

    const [pedido] = await pedidos();
    expect(pedido.state).toBe(state);
    expect(pedido.volta).toBe("/integracoes");
    expect(pedido.iniciadoPor).toBe(pessoa.id);
    // O verificador fica cifrado e é ele que gera o desafio enviado ao Google.
    const verificador = decifrar(pedido.verifierCifrado);
    expect(pedido.verifierCifrado).not.toContain(verificador);
    expect(sha256(verificador)).toBe(q.code_challenge);
  });

  it("usa HUB_PUBLIC_URL no endereço de volta e não aceita voltar para fora do hub", async () => {
    process.env.HUB_PUBLIC_URL = "https://hub-criativos-production.up.railway.app/";
    const { url } = await comecarLogin(undefined, "//site-falso.com/entrar");
    expect(url.searchParams.get("redirect_uri")).toBe(`https://hub-criativos-production.up.railway.app${CAMINHO_DE_VOLTA}`);
    expect((await pedidos())[0].volta).toBe("/integracoes");
  });

  it("sem HUB_CHAVE_SEGREDOS recusa conectar antes de mandar ao Google", async () => {
    delete process.env.HUB_CHAVE_SEGREDOS;
    await recusaCom(iniciarLogin("/integracoes", ORIGEM), "configuracao");
    await expect(iniciarLogin("/integracoes", ORIGEM)).rejects.toThrow(/HUB_CHAVE_SEGREDOS/);
    expect(await pedidos()).toHaveLength(0);
  });

  it("volta com state errado é recusada sem falar com o Google", async () => {
    const chamadas = googleFalso({ token: () => tokensDoGoogle() });
    await comecarLogin();
    await recusaCom(concluirLogin("codigo", "state-inventado", ORIGEM), "pedido-vencido");
    await recusaCom(concluirLogin("codigo", "", ORIGEM), "pedido-vencido");
    expect(chamadas).toHaveLength(0);
    expect(await lerConta()).toBeNull();
  });

  it("o retorno vale uma vez só, por 10 minutos, e só para quem começou", async () => {
    googleFalso({ token: () => tokensDoGoogle(), perfil: () => json({ email: "videos@gmail.com" }) });
    const [quemPediu, outra] = [await criarPessoa(), await criarPessoa()];

    const primeiro = await comecarLogin(quemPediu.id);
    await recusaCom(concluirLogin("codigo", primeiro.state, ORIGEM, outra.id), "outra-pessoa");
    // O pedido foi gasto na tentativa: nem quem pediu consegue usar o mesmo retorno depois.
    await recusaCom(concluirLogin("codigo", primeiro.state, ORIGEM, quemPediu.id), "pedido-vencido");

    const vencido = await comecarLogin(quemPediu.id);
    await banco()
      .update(drivePedidosLogin)
      .set({ criadoEm: new Date(Date.now() - 11 * 60_000) })
      .where(eq(drivePedidosLogin.state, vencido.state));
    await recusaCom(concluirLogin("codigo", vencido.state, ORIGEM, quemPediu.id), "pedido-vencido");

    const certo = await comecarLogin(quemPediu.id);
    expect(await concluirLogin("codigo", certo.state, ORIGEM, quemPediu.id)).toBe("/integracoes?drive=conectado");
    await recusaCom(concluirLogin("codigo", certo.state, ORIGEM, quemPediu.id), "pedido-vencido");
  });

  it("troca o código com o verificador do PKCE e grava a conta com os tokens cifrados", async () => {
    const chamadas = googleFalso({ token: () => tokensDoGoogle(), perfil: () => json({ email: "Videos@Gmail.com", name: "Vídeos do Hub" }) });
    const pessoa = await criarPessoa();
    const { url, state } = await comecarLogin(pessoa.id, "/integracoes?aba=drive");

    expect(await concluirLogin("codigo-do-google", state, ORIGEM, pessoa.id)).toBe("/integracoes?aba=drive&drive=conectado");

    const [troca, perfil] = chamadas;
    expect(troca.tipo).toBe("token");
    expect(troca.metodo).toBe("POST");
    expect(troca.corpo).toMatchObject({
      grant_type: "authorization_code",
      code: "codigo-do-google",
      redirect_uri: `${ORIGEM}${CAMINHO_DE_VOLTA}`,
      client_id: "cliente-teste.apps.googleusercontent.com",
      client_secret: "segredo-do-cliente",
    });
    expect(sha256(troca.corpo.code_verifier)).toBe(url.searchParams.get("code_challenge"));
    expect(perfil).toMatchObject({ tipo: "perfil", autorizacao: "Bearer acesso-1" });

    const conta = (await lerConta())!;
    expect(conta).toMatchObject({ email: "videos@gmail.com", nome: "Vídeos do Hub", conectadoPor: pessoa.id });
    expect(conta.escopos).toContain(ESCOPO_DRIVE);
    expect(conta.refreshTokenCifrado).not.toContain("refresh-1");
    expect(conta.accessTokenCifrado).not.toContain("acesso-1");
    expect(decifrar(conta.refreshTokenCifrado)).toBe("refresh-1");
    expect(decifrar(conta.accessTokenCifrado!)).toBe("acesso-1");
    expect(await pedidos()).toHaveLength(0);

    // O token recém-recebido já serve, sem outra ida ao Google.
    expect(await tokenDeAcesso()).toBe("acesso-1");
    expect(chamadas).toHaveLength(2);
  });

  it("sem o Drive marcado na tela do Google, recusa e devolve a autorização", async () => {
    const chamadas = googleFalso({ token: () => tokensDoGoogle({ scope: "openid email" }), revogar: () => json({}) });
    const { state } = await comecarLogin();
    await recusaCom(concluirLogin("codigo", state, ORIGEM), "sem-drive");
    expect(chamadas.map((c) => c.tipo)).toEqual(["token", "revogar"]);
    expect(await lerConta()).toBeNull();
  });

  it("o Google recusando a troca vira aviso legível, sem gravar nada", async () => {
    googleFalso({ token: () => json({ error: "redirect_uri_mismatch", error_description: "Bad Request" }, 400) });
    const { state } = await comecarLogin();
    await expect(concluirLogin("codigo", state, ORIGEM)).rejects.toMatchObject({ motivo: "google", message: expect.stringMatching(/redirect_uri_mismatch/) });
    expect(await lerConta()).toBeNull();
  });

  it("trocar para outra conta Google revoga a antiga; reconectar a mesma, não", async () => {
    await contaConectada(30 * 60_000, { email: "antiga@gmail.com", refresh: "refresh-antigo" });
    const chamadas = googleFalso({ token: () => tokensDoGoogle(), perfil: () => json({ email: "nova@gmail.com" }), revogar: () => json({}) });

    await concluirLogin("codigo", (await comecarLogin()).state, ORIGEM);
    expect((await lerConta())!.email).toBe("nova@gmail.com");
    expect(chamadas.filter((c) => c.tipo === "revogar").map((c) => c.corpo.token)).toEqual(["refresh-antigo"]);

    // De novo com a mesma conta: substitui a linha, sem revogar nada.
    await concluirLogin("codigo", (await comecarLogin()).state, ORIGEM);
    expect(chamadas.filter((c) => c.tipo === "revogar")).toHaveLength(1);
    expect(await banco().select().from(driveConta)).toHaveLength(1);
  });

  it("a pasta escolhida continua ao reconectar a mesma conta e volta para o Meu Drive com outra conta", async () => {
    await contaConectada(30 * 60_000, { email: "antiga@gmail.com" });
    await gravarPasta({ id: "pasta-criativos", nome: "Criativos", driveId: "drive-da-empresa" });
    let email = "antiga@gmail.com";
    googleFalso({ token: () => tokensDoGoogle(), perfil: () => json({ email }), revogar: () => json({}) });

    await concluirLogin("codigo", (await comecarLogin()).state, ORIGEM);
    expect(await pastaEscolhida()).toEqual({ id: "pasta-criativos", nome: "Criativos", driveId: "drive-da-empresa" });

    email = "nova@gmail.com";
    await concluirLogin("codigo", (await comecarLogin()).state, ORIGEM);
    expect(await pastaEscolhida()).toBeNull();
  });

  it("sem conta conectada não grava pasta", async () => {
    await expect(gravarPasta({ id: "pasta-criativos", nome: "Criativos", driveId: null })).rejects.toBeInstanceOf(DriveNaoConectado);
  });
});

describe("drive: token de acesso", () => {
  it("sem conta conectada, lança DriveNaoConectado", async () => {
    await expect(tokenDeAcesso()).rejects.toBeInstanceOf(DriveNaoConectado);
  });

  it("longe de vencer, usa o token guardado sem chamar o Google", async () => {
    const chamadas = googleFalso();
    await contaConectada(30 * 60_000);
    expect(await tokenDeAcesso()).toBe("acesso-guardado");
    expect(chamadas).toHaveLength(0);
  });

  it("faltando menos de 2 minutos, renova e grava o novo token cifrado", async () => {
    const chamadas = googleFalso({ token: () => json({ access_token: "acesso-novo", expires_in: 3599 }) });
    await contaConectada(90_000);

    expect(await tokenDeAcesso()).toBe("acesso-novo");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-guardado",
      client_id: "cliente-teste.apps.googleusercontent.com",
      client_secret: "segredo-do-cliente",
    });
    const conta = (await lerConta())!;
    expect(decifrar(conta.accessTokenCifrado!)).toBe("acesso-novo");
    expect(conta.expiraEm!.getTime()).toBeGreaterThan(Date.now() + 58 * 60_000);
    // Mesma autorização permanente (o Google não mandou outra).
    expect(decifrar(conta.refreshTokenCifrado)).toBe("refresh-guardado");

    expect(await tokenDeAcesso()).toBe("acesso-novo");
    expect(chamadas).toHaveLength(1);
  });

  it("invalid_grant (acesso tirado na conta Google) desconecta e lança DriveNaoConectado", async () => {
    googleFalso({ token: () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) });
    await contaConectada(-60_000);
    await expect(tokenDeAcesso()).rejects.toBeInstanceOf(DriveNaoConectado);
    expect(await lerConta()).toBeNull();
    expect((await statusDrive()).conectado).toBe(false);
  });

  it("outra falha do Google não desconecta", async () => {
    googleFalso({ token: () => json({ error: "internal_failure" }, 503) });
    await contaConectada(-60_000);
    await expect(tokenDeAcesso()).rejects.toThrow(/não renovou/);
    expect(await lerConta()).not.toBeNull();
  });

  it("vários pedidos ao mesmo tempo fazem uma renovação só", async () => {
    const chamadas = googleFalso({
      token: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return json({ access_token: "acesso-novo", expires_in: 3599 });
      },
    });
    await contaConectada(0);
    const tokens = await Promise.all(Array.from({ length: 8 }, () => tokenDeAcesso()));
    expect(new Set(tokens)).toEqual(new Set(["acesso-novo"]));
    expect(chamadas.filter((c) => c.tipo === "token")).toHaveLength(1);
  });

  it("depois de um 401, esquecerTokenDeAcesso força uma renovação só, e um 401 atrasado não joga fora o token novo", async () => {
    const chamadas = googleFalso({
      token: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return json({ access_token: "acesso-novo", expires_in: 3599 });
      },
    });
    await contaConectada(30 * 60_000);
    expect(await tokenDeAcesso()).toBe("acesso-guardado");

    await esquecerTokenDeAcesso("acesso-guardado");
    expect((await lerConta())!.accessTokenCifrado).toBeNull();
    const tokens = await Promise.all(Array.from({ length: 4 }, () => tokenDeAcesso()));
    expect(new Set(tokens)).toEqual(new Set(["acesso-novo"]));
    expect(chamadas).toHaveLength(1);

    // Outro pedido que usava o token velho recebe o 401 agora: o novo continua valendo.
    await esquecerTokenDeAcesso("acesso-guardado");
    expect(await tokenDeAcesso()).toBe("acesso-novo");
    expect(decifrar((await lerConta())!.accessTokenCifrado!)).toBe("acesso-novo");
    expect(chamadas).toHaveLength(1);
  });

  it("401 com a autorização permanente também cortada: desconecta", async () => {
    googleFalso({ token: () => json({ error: "invalid_grant" }, 400) });
    await contaConectada(30 * 60_000);
    await esquecerTokenDeAcesso(await tokenDeAcesso());
    await expect(tokenDeAcesso()).rejects.toBeInstanceOf(DriveNaoConectado);
    expect(await lerConta()).toBeNull();
  });

  it("chave dos segredos trocada: pede um login novo sem apagar a conta", async () => {
    googleFalso();
    await contaConectada(30 * 60_000);
    process.env.HUB_CHAVE_SEGREDOS = Buffer.alloc(32, 9).toString("base64");
    await expect(tokenDeAcesso()).rejects.toBeInstanceOf(DriveSemChave);
    expect(await lerConta()).not.toBeNull();
    expect(await statusDrive()).toMatchObject({ conectado: false, conta: { email: "videos@gmail.com" } });
  });
});

describe("drive: status", () => {
  it("sem o cliente do Google, não configurado", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const chamadas = googleFalso();
    await contaConectada(30 * 60_000);
    expect(await statusDrive()).toEqual({ configurado: false, conectado: false, conta: null, espaco: null, pasta: null });
    expect(await oQueFaltaParaConectar()).toMatch(/cliente do Google/);
    expect(chamadas).toHaveLength(0);
  });

  it("configurado e sem conta: desconectado, pronto para conectar", async () => {
    expect(await statusDrive()).toEqual({ configurado: true, conectado: false, conta: null, espaco: null, pasta: null });
    expect(await oQueFaltaParaConectar()).toBeNull();
    delete process.env.HUB_CHAVE_SEGREDOS;
    expect(await oQueFaltaParaConectar()).toMatch(/HUB_CHAVE_SEGREDOS/);
  });

  it("PC sem banco: desconectado, sem quebrar a tela", async () => {
    const url = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    usarBanco(undefined);
    try {
      expect(await statusDrive()).toEqual({ configurado: true, conectado: false, conta: null, espaco: null, pasta: null });
      expect(await oQueFaltaParaConectar()).toMatch(/banco/);
      await recusaCom(iniciarLogin("/integracoes", ORIGEM), "configuracao");
    } finally {
      if (url !== undefined) process.env.DATABASE_URL = url;
    }
  });

  it("conectado: mostra a conta e o espaço, perguntando ao Google no máximo uma vez por minuto", async () => {
    const chamadas = googleFalso({
      sobre: () => json({ storageQuota: { limit: "16106127360", usage: "1073741824" }, user: { emailAddress: "videos@gmail.com" } }),
    });
    await contaConectada(30 * 60_000);

    const esperado = { configurado: true, conectado: true, conta: { email: "videos@gmail.com", nome: "Vídeos do Hub" }, espaco: { usado: 1073741824, limite: 16106127360 }, pasta: null };
    expect(await statusDrive()).toEqual(esperado);
    expect(chamadas[0]).toMatchObject({ tipo: "sobre", autorizacao: "Bearer acesso-guardado" });
    expect(new URL(chamadas[0].url).searchParams.get("fields")).toBe("storageQuota,user");

    expect(await statusDrive()).toEqual(esperado);
    expect(chamadas).toHaveLength(1);

    const agora = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(agora + 61_000);
    await statusDrive();
    expect(chamadas).toHaveLength(2);
  });

  it("pasta num Drive compartilhado: mostra a pasta e não o espaço da conta (o espaço é o da empresa)", async () => {
    const chamadas = googleFalso();
    await contaConectada(30 * 60_000);
    await gravarPasta({ id: "pasta-criativos", nome: "Criativos", driveId: "drive-da-empresa" });
    expect(await statusDrive()).toMatchObject({ conectado: true, espaco: null, pasta: { id: "pasta-criativos", nome: "Criativos", compartilhado: true } });
    expect(chamadas).toHaveLength(0);
  });

  it("conta sem limite de espaço e Google fora do ar", async () => {
    let fora = false;
    googleFalso({ sobre: () => (fora ? json({}, 503) : json({ storageQuota: { usage: "500" } })) });
    await contaConectada(30 * 60_000);
    expect((await statusDrive()).espaco).toEqual({ usado: 500, limite: null });

    fora = true;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    // Continua conectado: só o número do espaço some.
    expect(await statusDrive()).toMatchObject({ conectado: true, conta: { email: "videos@gmail.com" }, espaco: null });
  });
});

describe("drive: desconectar", () => {
  it("revoga no Google e apaga a conta", async () => {
    const chamadas = googleFalso({ revogar: () => json({}) });
    await contaConectada(30 * 60_000);
    expect(await tokenDeAcesso()).toBe("acesso-guardado");

    await desconectar();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ tipo: "revogar", metodo: "POST", corpo: { token: "refresh-guardado" } });
    expect(await lerConta()).toBeNull();
    // Nem o token que estava em memória sobrevive.
    await expect(tokenDeAcesso()).rejects.toBeInstanceOf(DriveNaoConectado);
  });

  it("Google fora do ar na revogação: sai do hub do mesmo jeito", async () => {
    googleFalso({ revogar: () => json({}, 503) });
    await contaConectada(30 * 60_000);
    await desconectar();
    expect(await lerConta()).toBeNull();
  });
});
