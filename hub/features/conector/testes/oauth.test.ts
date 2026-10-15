import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as asMcp } from "@/app/.well-known/oauth-authorization-server/mcp/route";
import { GET as asRaiz } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as oidcMcp } from "@/app/.well-known/openid-configuration/mcp/route";
import { GET as oidcRaiz } from "@/app/.well-known/openid-configuration/route";
import { GET as prmMcp } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as prmRaiz } from "@/app/.well-known/oauth-protected-resource/route";
import { banco } from "@/db/cliente";
import { conexaoTokens, conexoes, oauthClientes, oauthCodigos, oauthPedidos } from "@/db/schema";
import { LIMITE_REGISTROS_POR_HORA } from "@/features/conector/servicos/rotas-oauth";
import { limparVencidos } from "@/features/conector/servicos/limpeza";
import { hashDe } from "@/features/conector/servicos/segredos";
import {
  BASE,
  ENDERECO_MCP,
  REDIRECT_CLAUDE,
  REDIRECT_CLAUDE_COM,
  REDIRECT_CODE,
  authorize,
  clientId,
  codigoAutorizado,
  conectar,
  criarPessoa,
  decidir,
  mcp,
  mudarPessoa,
  novoPedido,
  pkce,
  prepararTeste,
  query,
  registrar,
  revogar,
  token,
} from "@/features/conector/testes/apoio";

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
vi.mock("@/features/memoria/servicos/memoria", () => ({
  listarIndice: vi.fn(async () => []),
  buscar: vi.fn(async () => []),
  ler: vi.fn(async () => null),
  salvar: vi.fn(),
  acrescentarSecao: vi.fn(),
  registrarProjeto: vi.fn(),
  registrarLicao: vi.fn(),
  historico: vi.fn(async () => []),
  restaurar: vi.fn(),
  pendentesDeRevisao: vi.fn(async () => []),
  marcarRevisado: vi.fn(),
  documentosDoPrompt: vi.fn(async () => []),
  indiceDeProjetos: vi.fn(async () => []),
}));

const get = (rota: (r: Request) => Promise<Response>, caminho: string) => rota(new Request(`${BASE}${caminho}`));

describe("conector: metadados do OAuth", () => {
  beforeEach(prepararTeste);

  it("o recurso protegido é exatamente o endereço colado no Claude", async () => {
    for (const rota of [prmRaiz, prmMcp]) {
      const dados = await (await get(rota, "/.well-known/oauth-protected-resource/mcp")).json();
      expect(dados).toEqual({
        resource: ENDERECO_MCP,
        authorization_servers: [BASE],
        scopes_supported: ["hub.memoria"],
        bearer_methods_supported: ["header"],
        resource_name: "Hub de Criativos",
      });
    }
  });

  it("o servidor de autorização anuncia só o que implementa, em /oauth2, e o mesmo documento nos seis caminhos", async () => {
    const canonico = await (await get(asRaiz, "/.well-known/oauth-authorization-server")).json();
    expect(canonico).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth2/authorize`,
      token_endpoint: `${BASE}/oauth2/token`,
      registration_endpoint: `${BASE}/oauth2/register`,
      revocation_endpoint: `${BASE}/oauth2/revoke`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: ["hub.memoria", "offline_access"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(canonico).not.toHaveProperty("client_id_metadata_document_supported");
    for (const rota of [asMcp, oidcRaiz, oidcMcp]) expect(await (await get(rota, "/x")).json()).toEqual(canonico);
  });

  it("sem HUB_PUBLIC_URL, vale a origem da requisição (no PC, localhost)", async () => {
    delete process.env.HUB_PUBLIC_URL;
    const dados = await (await prmMcp(new Request("http://localhost:3000/.well-known/oauth-protected-resource/mcp"))).json();
    expect(dados.resource).toBe("http://localhost:3000/mcp");
  });
});

describe("conector: registro de cliente", () => {
  beforeEach(prepararTeste);

  it("aceita o Claude na web como cliente público, sem segredo", async () => {
    for (const redirect of [REDIRECT_CLAUDE, REDIRECT_CLAUDE_COM]) {
      const res = await registrar([redirect]);
      expect(res.status).toBe(201);
      const dados = await res.json();
      expect(dados.client_id).toBeTruthy();
      expect(dados.token_endpoint_auth_method).toBe("none");
      expect(dados).not.toHaveProperty("client_secret");
      expect(dados.redirect_uris).toEqual([redirect]);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("aceita o retorno do Claude Code no loopback, em qualquer porta", async () => {
    for (const redirect of ["http://localhost:33418/callback", "http://127.0.0.1:5173/callback", "http://localhost/callback"]) {
      expect((await registrar([redirect])).status).toBe(201);
    }
  });

  it("recusa qualquer outro retorno, e o cliente nem nasce", async () => {
    for (const redirect of [
      "https://evil.com/api/mcp/auth_callback",
      "https://claude.ai/outro/caminho",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "http://localhost:33418/outro",
      "https://localhost:33418/callback",
      "http://localhost.evil.com/callback",
      "http://user@localhost:1/callback",
      "http://localhost:33418/callback?x=1",
      "http://localhost:99999/callback",
    ]) {
      const res = await registrar([REDIRECT_CLAUDE, redirect]);
      expect(res.status, redirect).toBe(400);
      expect((await res.json()).error).toBe("invalid_redirect_uri");
    }
    expect(await banco().select().from(oauthClientes)).toHaveLength(0);
  });

  it("a lista de retornos da web vem de MCP_REDIRECTS_PERMITIDOS; o loopback vale sempre", async () => {
    process.env.MCP_REDIRECTS_PERMITIDOS = "https://outro.claude.teste/cb, https://mais.um/cb";
    expect((await registrar(["https://outro.claude.teste/cb"])).status).toBe(201);
    expect((await registrar([REDIRECT_CLAUDE])).status).toBe(400);
    expect((await registrar([REDIRECT_CODE])).status).toBe(201);
  });

  it("recusa cliente confidencial", async () => {
    const res = await registrar([REDIRECT_CLAUDE], { token_endpoint_auth_method: "client_secret_basic" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_client_metadata");
  });

  it("limita os registros por IP", async () => {
    for (let i = 0; i < LIMITE_REGISTROS_POR_HORA; i++) expect((await registrar()).status).toBe(201);
    expect((await registrar()).status).toBe(429);
  });
});

describe("conector: authorize", () => {
  beforeEach(prepararTeste);

  it("valida e manda para a tela de consentimento com o pedido", async () => {
    const res = await authorize(await clientId());
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const id = query(res.headers.get("location")!).pedido;
    const [pedido] = await banco().select().from(oauthPedidos).where(eq(oauthPedidos.id, id));
    expect(pedido).toMatchObject({ state: "estado-123", resource: ENDERECO_MCP, escopos: ["hub.memoria", "offline_access"] });
    expect(id.length).toBeGreaterThanOrEqual(40);
  });

  it("cliente desconhecido vira página de erro e não redireciona", async () => {
    const res = await authorize("nao-existe");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("retorno que não é deste cliente nunca recebe redirect", async () => {
    const cliente = await clientId([REDIRECT_CLAUDE]);
    for (const redirect of [REDIRECT_CLAUDE_COM, "https://evil.com/cb"]) {
      const res = await authorize(cliente, redirect);
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("no loopback a porta não conta, mas o host conta", async () => {
    const cliente = await clientId(["http://localhost:1111/callback"]);
    expect((await authorize(cliente, "http://localhost:2222/callback")).status).toBe(302);
    expect((await authorize(cliente, "http://127.0.0.1:2222/callback")).status).toBe(400);
  });

  const erroNoRetorno = async (res: Response, codigo: string) => {
    expect(res.status).toBe(302);
    const destino = res.headers.get("location")!;
    expect(destino.startsWith(REDIRECT_CLAUDE)).toBe(true);
    expect(query(destino)).toMatchObject({ error: codigo, state: "estado-123", iss: BASE });
    expect(await banco().select().from(oauthPedidos)).toHaveLength(0);
  };

  it("PKCE é obrigatório e só S256", async () => {
    const cliente = await clientId();
    await erroNoRetorno(await authorize(cliente, REDIRECT_CLAUDE, undefined, { code_challenge: null, code_challenge_method: null }), "invalid_request");
    await erroNoRetorno(await authorize(cliente, REDIRECT_CLAUDE, undefined, { code_challenge_method: "plain" }), "invalid_request");
  });

  it("recurso de outro endereço volta com invalid_target; barra no fim e caixa do host não importam", async () => {
    const cliente = await clientId();
    await erroNoRetorno(await authorize(cliente, REDIRECT_CLAUDE, undefined, { resource: "https://outro.teste/mcp" }), "invalid_target");
    expect((await authorize(cliente, REDIRECT_CLAUDE, undefined, { resource: "https://HUB.teste/mcp/" })).status).toBe(302);
  });

  it("response_type diferente de code é recusado", async () => {
    await erroNoRetorno(await authorize(await clientId(), REDIRECT_CLAUDE, undefined, { response_type: "token" }), "unsupported_response_type");
  });
});

describe("conector: consentimento", () => {
  beforeEach(prepararTeste);

  it("autorizar devolve o retorno com código, state e iss", async () => {
    const pessoa = await criarPessoa();
    const pedido = await novoPedido();
    const res = await decidir(pessoa.id, pedido);
    expect(res.status).toBe(200);
    const { redirect } = await res.json();
    expect(redirect.startsWith(`${REDIRECT_CLAUDE}?`)).toBe(true);
    const params = query(redirect);
    expect(params.code.startsWith("hub_ac_")).toBe(true);
    expect(params).toMatchObject({ state: "estado-123", iss: BASE });
    const [codigo] = await banco().select().from(oauthCodigos);
    expect(codigo.usuarioId).toBe(pessoa.id);
    expect(codigo.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    // Só o hash fica no banco.
    expect(codigo.codigoHash).toBe(hashDe(params.code));
  });

  it("recusar devolve access_denied com o state", async () => {
    const pessoa = await criarPessoa();
    const res = await decidir(pessoa.id, await novoPedido(), "recusar");
    const params = query((await res.json()).redirect);
    expect(params).toMatchObject({ error: "access_denied", state: "estado-123" });
    expect(params.code).toBeUndefined();
  });

  it("sem login é 401; sem a chave do conector é 403 e nenhum código nasce", async () => {
    const pedido = await novoPedido();
    expect((await decidir(null, pedido)).status).toBe(401);
    const semChave = await criarPessoa({ chaves: ["memoria"] });
    expect((await decidir(semChave.id, pedido)).status).toBe(403);
    expect(await banco().select().from(oauthCodigos)).toHaveLength(0);
  });

  it("pedido vencido é 404; já respondido é 409", async () => {
    const pessoa = await criarPessoa();
    const vencido = await novoPedido();
    await banco().update(oauthPedidos).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(oauthPedidos.id, vencido));
    expect((await decidir(pessoa.id, vencido)).status).toBe(404);
    expect((await decidir(pessoa.id, "nao-existe")).status).toBe(404);

    const pedido = await novoPedido();
    expect((await decidir(pessoa.id, pedido)).status).toBe(200);
    expect((await decidir(pessoa.id, pedido)).status).toBe(409);
    expect((await decidir(pessoa.id, pedido, "recusar")).status).toBe(409);
    expect(await banco().select().from(oauthCodigos)).toHaveLength(1);
  });
});

describe("conector: token", () => {
  beforeEach(prepararTeste);

  it("fluxo inteiro: registro, authorize, autorizar, token, chamada MCP, renovação e revogação", async () => {
    const pessoa = await criarPessoa();
    const tokens = await conectar(pessoa.id);
    expect(tokens.access_token.startsWith("hub_at_")).toBe(true);
    expect(tokens.refresh_token.startsWith("hub_rt_")).toBe(true);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "hub.memoria offline_access" });
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao).toMatchObject({ usuarioId: pessoa.id, app: "claude", audiencia: ENDERECO_MCP, revogadaEm: null });

    expect((await mcp(tokens.access_token, "ping")).status).toBe(200);

    const renovado = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.cliente });
    expect(renovado.status).toBe(200);
    const novo = await renovado.json();
    expect(novo.access_token).not.toBe(tokens.access_token);
    expect(novo.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(novo.access_token, "ping")).status).toBe(200);

    expect((await revogar({ token: novo.refresh_token, client_id: tokens.cliente })).status).toBe(200);
    const [revogada] = await banco().select().from(conexoes);
    expect(revogada.motivoRevogacao).toBe("revogada_pelo_cliente");
    expect((await mcp(novo.access_token, "ping")).status).toBe(401);
  });

  it("a resposta do token não vai para cache e nenhum segredo fica em texto no banco", async () => {
    const pessoa = await criarPessoa();
    const { cliente, verificador, codigo } = await codigoAutorizado(pessoa.id);
    const res = await token({ grant_type: "authorization_code", code: codigo, redirect_uri: REDIRECT_CLAUDE, client_id: cliente, code_verifier: verificador });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const tokens = await res.json();
    const tudo = JSON.stringify(await banco().select().from(conexaoTokens));
    expect(tudo).not.toContain(tokens.access_token);
    expect(tudo).not.toContain(tokens.refresh_token);
    expect(tudo).toContain(hashDe(tokens.access_token));
  });

  it("corpo em JSON também é aceito", async () => {
    const pessoa = await criarPessoa();
    const { cliente, verificador, codigo } = await codigoAutorizado(pessoa.id);
    const res = await token({ grant_type: "authorization_code", code: codigo, redirect_uri: REDIRECT_CLAUDE, client_id: cliente, code_verifier: verificador }, true);
    expect(res.status).toBe(200);
  });

  it("PKCE errado é recusado e a conexão não nasce", async () => {
    const pessoa = await criarPessoa();
    const { cliente, codigo } = await codigoAutorizado(pessoa.id);
    const res = await token({ grant_type: "authorization_code", code: codigo, redirect_uri: REDIRECT_CLAUDE, client_id: cliente, code_verifier: pkce().verificador });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(await banco().select().from(conexoes)).toHaveLength(0);
  });

  it("redirect diferente, código de outro cliente e cliente desconhecido são recusados", async () => {
    const pessoa = await criarPessoa();
    const a = await codigoAutorizado(pessoa.id, REDIRECT_CODE);
    const outro = await token({ grant_type: "authorization_code", code: a.codigo, redirect_uri: "http://localhost:9999/callback", client_id: a.cliente, code_verifier: a.verificador });
    expect((await outro.json()).error).toBe("invalid_grant");
    const deOutroCliente = await token({ grant_type: "authorization_code", code: a.codigo, redirect_uri: REDIRECT_CODE, client_id: await clientId(), code_verifier: a.verificador });
    expect((await deOutroCliente.json()).error).toBe("invalid_grant");
    const desconhecido = await token({ grant_type: "authorization_code", code: "x", redirect_uri: REDIRECT_CLAUDE, client_id: "nao-existe", code_verifier: pkce().verificador });
    expect(desconhecido.status).toBe(401);
    expect((await desconhecido.json()).error).toBe("invalid_client");
  });

  it("código reutilizado revoga a conexão inteira", async () => {
    const pessoa = await criarPessoa();
    const { cliente, verificador, codigo } = await codigoAutorizado(pessoa.id);
    const dados = { grant_type: "authorization_code", code: codigo, redirect_uri: REDIRECT_CLAUDE, client_id: cliente, code_verifier: verificador };
    const primeiro = await (await token(dados)).json();
    expect((await mcp(primeiro.access_token, "ping")).status).toBe(200);

    const segundo = await token(dados);
    expect(segundo.status).toBe(400);
    expect((await segundo.json()).error).toBe("invalid_grant");
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.motivoRevogacao).toBe("codigo_reusado");
    // O token que o primeiro uso emitiu morreu junto.
    expect((await mcp(primeiro.access_token, "ping")).status).toBe(401);
  });

  it("token de renovação aposentado e reapresentado revoga a conexão inteira", async () => {
    const pessoa = await criarPessoa();
    const tokens = await conectar(pessoa.id);
    const dados = { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.cliente };
    const novo = await (await token(dados)).json();

    const reuso = await token(dados);
    expect(reuso.status).toBe(400);
    expect((await reuso.json()).error).toBe("invalid_grant");
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.motivoRevogacao).toBe("renovacao_reusada");
    // O par NOVO (de quem quer que esteja com ele) também morreu.
    expect((await mcp(novo.access_token, "ping")).status).toBe(401);
    expect((await (await token({ ...dados, refresh_token: novo.refresh_token })).json()).error).toBe("invalid_grant");
  });

  it("revogar o token de acesso derruba só ele; token desconhecido responde 200", async () => {
    const pessoa = await criarPessoa();
    const tokens = await conectar(pessoa.id);
    expect((await revogar({ token: tokens.access_token })).status).toBe(200);
    expect((await mcp(tokens.access_token, "ping")).status).toBe(401);
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.revogadaEm).toBeNull();
    expect((await revogar({ token: "qualquer" })).status).toBe(200);
  });

  it("conectar pelo loopback vira conexão do Claude Code; grant_type desconhecido é recusado", async () => {
    const pessoa = await criarPessoa();
    await conectar(pessoa.id, REDIRECT_CODE);
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.app).toBe("claude_code");
    expect((await (await token({ grant_type: "password", username: "x", password: "y" })).json()).error).toBe("unsupported_grant_type");
  });

  it("renovação de conta desativada é recusada", async () => {
    const pessoa = await criarPessoa();
    const tokens = await conectar(pessoa.id);
    await mudarPessoa(pessoa.id, { ativo: false });
    const res = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    expect((await res.json()).error).toBe("invalid_grant");
  });
});

describe("conector: limpeza", () => {
  beforeEach(prepararTeste);

  it("pedido pendente vencido sai; o já decidido fica; código usado fica um dia", async () => {
    const pessoa = await criarPessoa();
    const pendente = await novoPedido();
    await conectar(pessoa.id);
    await banco().update(oauthPedidos).set({ expiraEm: new Date(Date.now() - 60_000) });
    await banco().update(oauthCodigos).set({ expiraEm: new Date(Date.now() - 2 * 60 * 60_000) });
    await limparVencidos(true);
    const restantes = await banco().select().from(oauthPedidos);
    expect(restantes.map((p) => p.id)).not.toContain(pendente);
    expect(restantes).toHaveLength(1);
    expect(await banco().select().from(oauthCodigos)).toHaveLength(1);

    await banco().update(oauthCodigos).set({ expiraEm: new Date(Date.now() - 2 * 24 * 60 * 60_000) });
    await limparVencidos(true);
    expect(await banco().select().from(oauthCodigos)).toHaveLength(0);
  });

  it("cliente sem conexão sai depois de 30 dias; com conexão fica", async () => {
    const pessoa = await criarPessoa();
    await conectar(pessoa.id);
    const abandonado = await clientId();
    await banco().update(oauthClientes).set({ criadoEm: new Date(Date.now() - 40 * 24 * 60 * 60_000) });
    await limparVencidos(true);
    const clientes = await banco().select().from(oauthClientes);
    expect(clientes.map((c) => c.clientId)).not.toContain(abandonado);
    expect(clientes).toHaveLength(1);
  });
});
