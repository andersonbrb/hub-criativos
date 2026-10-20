import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as rotaVolta } from "@/app/api/integracoes/youtube/callback/route";
import { GET as rotaEntrar } from "@/app/api/integracoes/youtube/login/route";
import { DELETE as rotaDesconectar, GET as rotaStatus } from "@/app/api/integracoes/youtube/status/route";
import { banco } from "@/db/cliente";
import { youtubeConta, youtubeEnvios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Chave } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { criarConta, criarOrganizacao, garantirOrganizacaoPadrao } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { tokenDeAcesso, YoutubeNaoConectado } from "@/features/youtube/servicos/conta";
import { canalConectadoNoBanco, canalDoGoogle, googleFalso, json, ORIGEM, prepararAmbiente, tokensDoGoogle } from "@/features/youtube/testes/apoio";

// Conexão do canal do YouTube (card em Integrações), pelas rotas de verdade, com um Google de mentira.
vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});

const pedir = (caminho: string, init?: RequestInit) => new Request(`${ORIGEM}${caminho}`, init);
const destino = (res: Response) => res.headers.get("location") ?? "";
let contador = 0;

async function entrarComo(chaves: Chave[], organizacaoId: string = ORGANIZACAO_PADRAO.id, papel: "dono" | "membro" = "membro") {
  const pessoa = await criarConta({ email: `pessoa-${++contador}@exemplo.com`, chaves, organizacaoId, papel });
  sessao.logado = pessoa.id;
  sessao.organizacao = organizacaoId;
  return pessoa;
}

// Começa o login e devolve o state que foi ao Google.
async function comecarLogin() {
  const ida = await rotaEntrar(pedir("/api/integracoes/youtube/login"));
  expect(ida.status).toBe(302);
  return new URL(destino(ida));
}

beforeEach(async () => {
  prepararAmbiente();
  await bancoDeTeste();
  await garantirOrganizacaoPadrao();
  sessao.logado = null;
  sessao.organizacao = ORGANIZACAO_PADRAO.id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("youtube: conectar o canal", () => {
  it("só quem tem a chave Integrações conecta, desconecta e lê o status", async () => {
    expect((await rotaEntrar(pedir("/api/integracoes/youtube/login"))).status).toBe(401);
    await entrarComo(["biblioteca", "youtube"]);
    expect((await rotaEntrar(pedir("/api/integracoes/youtube/login"))).status).toBe(403);
    expect((await rotaVolta(pedir("/api/integracoes/youtube/callback?code=x&state=y"))).status).toBe(403);
    expect((await rotaStatus(pedir("/api/integracoes/youtube/status"))).status).toBe(403);
    expect((await rotaDesconectar(pedir("/api/integracoes/youtube/status", { method: "DELETE" }))).status).toBe(403);
  });

  it("Conectar leva ao Google pedindo só enviar e ler o canal, com a escolha de conta e de canal", async () => {
    await entrarComo(["integracoes"]);
    const google = await comecarLogin();
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = google.searchParams;
    expect(q.get("scope")!.split(" ").sort()).toEqual(["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"]);
    expect(q.get("prompt")).toBe("consent select_account");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("redirect_uri")).toBe(`${ORIGEM}/api/integracoes/youtube/callback`);
    expect(q.get("client_id")).toBe("cliente-teste.apps.googleusercontent.com");
  });

  it("a volta grava o canal escolhido (tokens cifrados) e leva para Integrações", async () => {
    const chamadas = googleFalso({ token: () => tokensDoGoogle(), canal: () => canalDoGoogle() });
    await entrarComo(["integracoes"]);
    const state = (await comecarLogin()).searchParams.get("state")!;

    const volta = await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=codigo-1&state=${state}`));
    expect(volta.status).toBe(303);
    expect(destino(volta)).toBe("/integracoes?youtube=conectado");
    expect(chamadas.find((c) => c.tipo === "canal")?.autorizacao).toBe("Bearer acesso-1");

    const [linha] = await banco().select().from(youtubeConta);
    expect(linha).toMatchObject({ organizacaoId: ORGANIZACAO_PADRAO.id, canalId: "UC-canal-1", canalTitulo: "Canal da Empresa", canalEndereco: "@canaldaempresa" });
    expect(linha.refreshTokenCifrado).not.toContain("refresh-1");

    const status = await (await rotaStatus(pedir("/api/integracoes/youtube/status"))).json();
    expect(status).toMatchObject({ configurado: true, conectado: true, falta: null, canal: { titulo: "Canal da Empresa", endereco: "https://www.youtube.com/@canaldaempresa" } });

    // O mesmo retorno do Google não serve duas vezes.
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=codigo-1&state=${state}`)))).toBe("/integracoes?youtube=erro&motivo=pedido-vencido");
  });

  it("sem as permissões do YouTube marcadas: recusa e revoga no Google", async () => {
    const chamadas = googleFalso({ token: () => tokensDoGoogle({ scope: "https://www.googleapis.com/auth/youtube.readonly" }), revogar: () => json({}) });
    await entrarComo(["integracoes"]);
    const state = (await comecarLogin()).searchParams.get("state")!;
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=c&state=${state}`)))).toBe("/integracoes?youtube=erro&motivo=sem-permissao");
    expect(chamadas.some((c) => c.tipo === "revogar")).toBe(true);
    expect(await banco().select().from(youtubeConta)).toHaveLength(0);
  });

  it("conta Google sem canal e API do YouTube desligada viram avisos claros", async () => {
    await entrarComo(["integracoes"]);
    googleFalso({ token: () => tokensDoGoogle(), canal: () => json({ items: [] }), revogar: () => json({}) });
    let state = (await comecarLogin()).searchParams.get("state")!;
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=c&state=${state}`)))).toBe("/integracoes?youtube=erro&motivo=sem-canal");

    googleFalso({
      token: () => tokensDoGoogle(),
      canal: () => json({ error: { code: 403, message: "YouTube Data API v3 has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } }, 403),
      revogar: () => json({}),
    });
    state = (await comecarLogin()).searchParams.get("state")!;
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=c&state=${state}`)))).toBe("/integracoes?youtube=erro&motivo=api-desligada");
    expect(await banco().select().from(youtubeConta)).toHaveLength(0);
  });

  it("o mesmo canal não serve a duas organizações (e a outra não perde a conexão)", async () => {
    const outra = await criarOrganizacao("Outra Empresa");
    await canalConectadoNoBanco(outra, { canalId: "UC-canal-1" });
    const chamadas = googleFalso({ token: () => tokensDoGoogle(), canal: () => canalDoGoogle("UC-canal-1"), revogar: () => json({}) });
    await entrarComo(["integracoes"]);
    const state = (await comecarLogin()).searchParams.get("state")!;
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=c&state=${state}`)))).toBe(
      "/integracoes?youtube=erro&motivo=canal-em-outra-organizacao",
    );
    expect(chamadas.some((c) => c.tipo === "revogar")).toBe(false);
    const linhas = await banco().select().from(youtubeConta);
    expect(linhas.map((l) => l.organizacaoId)).toEqual([outra]);
  });

  it("cada organização vê só o próprio canal", async () => {
    const outra = await criarOrganizacao("Outra Empresa");
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id, { canalId: "UC-a", titulo: "Canal A" });
    await entrarComo(["integracoes"], outra);
    expect(await (await rotaStatus(pedir("/api/integracoes/youtube/status"))).json()).toMatchObject({ conectado: false, canal: null });
    // Desconectar na outra não mexe no canal da padrão.
    googleFalso({ revogar: () => json({}) });
    await rotaDesconectar(pedir("/api/integracoes/youtube/status", { method: "DELETE" }));
    expect(await banco().select().from(youtubeConta)).toHaveLength(1);
  });

  it("retorno do Google aberto por outra pessoa do hub é recusado", async () => {
    googleFalso({ token: () => tokensDoGoogle(), canal: () => canalDoGoogle() });
    await entrarComo(["integracoes"]);
    const state = (await comecarLogin()).searchParams.get("state")!;
    await entrarComo(["integracoes"]);
    expect(destino(await rotaVolta(pedir(`/api/integracoes/youtube/callback?code=c&state=${state}`)))).toBe("/integracoes?youtube=erro&motivo=outra-pessoa");
  });

  it("Desconectar revoga no Google e cancela os envios agendados do canal", async () => {
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    const [envio] = await banco()
      .insert(youtubeEnvios)
      .values({
        organizacaoId: ORGANIZACAO_PADRAO.id,
        geracaoId: "g1",
        arquivo: "v.mp4",
        canalId: "UC-canal-1",
        canalTitulo: "Canal da Empresa",
        titulo: "Agendado",
        visibilidade: "public",
        situacao: "agendado",
        agendadoPara: new Date(Date.now() + 3600_000),
      })
      .returning();
    const chamadas = googleFalso({ revogar: () => json({}) });
    await entrarComo(["integracoes"]);
    const res = await rotaDesconectar(pedir("/api/integracoes/youtube/status", { method: "DELETE" }));
    expect(await res.json()).toMatchObject({ conectado: false, canal: null });
    expect(chamadas.find((c) => c.tipo === "revogar")?.corpo).toEqual({ token: "refresh-guardado" });
    const [depois] = await banco().select().from(youtubeEnvios).where(eq(youtubeEnvios.id, envio.id));
    expect(depois.situacao).toBe("cancelado");
    expect(depois.aviso).toMatch(/desconectado/);
  });

  it("autorização cortada no Google (invalid_grant) desconecta o canal", async () => {
    await banco()
      .insert(youtubeConta)
      .values({
        organizacaoId: ORGANIZACAO_PADRAO.id,
        canalId: "UC-canal-1",
        canalTitulo: "Canal",
        refreshTokenCifrado: (await import("@/features/integracoes/servicos/cifra")).cifrar("refresh-velho"),
        escopos: [],
      });
    googleFalso({ token: () => json({ error: "invalid_grant" }, 400) });
    await expect(comOrganizacao(ORGANIZACAO_PADRAO.id, () => tokenDeAcesso())).rejects.toBeInstanceOf(YoutubeNaoConectado);
    expect(await banco().select().from(youtubeConta)).toHaveLength(0);
  });
});
