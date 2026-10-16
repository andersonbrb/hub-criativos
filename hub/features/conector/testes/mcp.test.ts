import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as mcpDelete, GET as mcpGet } from "@/app/mcp/route";
import { banco } from "@/db/cliente";
import { chamadasMcp, conexaoTokens, conexoes, organizacaoMembros } from "@/db/schema";
import { ORGANIZACAO_PADRAO, type Chave } from "@/features/acesso/contrato";
import { criarOrganizacao, vincular } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { LIMITE_CHAMADAS_POR_MINUTO, SEGREDO_REMOVIDO } from "@/features/conector/servicos/mcp";
import type { Doc } from "@/features/memoria/contrato";
import { ConflitoDeVersao, SegredoDetectado } from "@/features/memoria/erros";
import * as memoria from "@/features/memoria/servicos/memoria";
import {
  BASE,
  chamar,
  conectar,
  criarPessoa,
  mcp,
  mcpCru,
  mudarPessoa,
  nomesDasFerramentas,
  prepararTeste,
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
// O quadro de verdade grava em hub/.data: aqui ele fica na memória do teste.
vi.mock("@/lib/server/board", () => ({
  getBoard: vi.fn(async () => ({
    columns: [{ id: "ideias", title: "Ideias", cardIds: ["c1"] }],
    cards: { c1: { id: "c1", title: "Kit Chile", description: "roteiro", operation: "cod", product: "Kit", generationIds: [], createdAt: "", updatedAt: "" } },
  })),
  createCard: vi.fn(async (dados: Record<string, unknown>) => ({ id: "novo", ...dados })),
  updateCard: vi.fn(),
  moveCard: vi.fn(),
}));

const doc = (extra: Partial<Doc>): Doc => ({
  slug: "x",
  titulo: "X",
  tipo: "regra",
  frente: "geral",
  mercado: null,
  noPrompt: false,
  precisaRevisao: false,
  versao: 1,
  atualizadoEm: "2026-10-01T00:00:00.000Z",
  metadados: {},
  conteudo: "",
  autor: "Importador",
  ...extra,
});

const LEITURA_DA_MEMORIA = ["memoria_indice", "memoria_buscar", "memoria_ler", "memoria_historico", "memoria_pendentes"];
const GRAVACAO_DA_MEMORIA = ["memoria_salvar", "memoria_acrescentar", "memoria_restaurar", "memoria_marcar_revisado", "projeto_registrar", "licao_registrar"];
const BIBLIOTECA = ["biblioteca_listar", "link_de_envio", "link_de_download"];
const FLUXO = ["fluxo_ver", "fluxo_salvar_card"];

async function conectado(chaves: Chave[] = ["conector_claude", "memoria", "memoria_editar", "biblioteca", "fluxo"]) {
  const pessoa = await criarPessoa({ chaves });
  const tokens = await conectar(pessoa.id);
  return { pessoa, acesso: tokens.access_token };
}

describe("conector MCP: autenticação", () => {
  beforeEach(async () => {
    // Volta cada simulação ao comportamento padrão (o mockResolvedValue de um teste não vaza para o próximo).
    vi.resetAllMocks();
    await prepararTeste();
  });

  it("sem token é 401 com o endereço dos metadados e o escopo", async () => {
    const res = await mcp(null, "initialize", { protocolVersion: "2025-06-18" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="hub.memoria"`,
    );
  });

  it("token inválido é 401 invalid_token, com os metadados", async () => {
    const res = await mcp("hub_at_inventado", "ping");
    expect(res.status).toBe(401);
    const cabecalho = res.headers.get("www-authenticate")!;
    expect(cabecalho).toContain('error="invalid_token"');
    expect(cabecalho).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("token vencido é 401", async () => {
    const { acesso } = await conectado();
    await banco().update(conexaoTokens).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(conexaoTokens.tipo, "acesso"));
    expect((await mcp(acesso, "ping")).status).toBe(401);
  });

  it("token emitido para outro endereço não vale", async () => {
    const { acesso } = await conectado();
    process.env.HUB_PUBLIC_URL = "https://outro-host.teste";
    expect((await mcp(acesso, "ping")).status).toBe(401);
  });

  it("GET e DELETE são 405", async () => {
    expect((await mcpGet()).status).toBe(405);
    expect((await mcpDelete()).status).toBe(405);
    expect((await mcpGet()).headers.get("allow")).toBe("POST");
  });

  it("pessoa desativada derruba a conexão na chamada seguinte", async () => {
    const { pessoa, acesso } = await conectado();
    expect((await mcp(acesso, "ping")).status).toBe(200);
    await mudarPessoa(pessoa.id, { ativo: false });
    expect((await mcp(acesso, "ping")).status).toBe(401);
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.motivoRevogacao).toBe("usuario_inativo");
    // Reativar a conta não ressuscita a conexão: é preciso conectar de novo.
    await mudarPessoa(pessoa.id, { ativo: true });
    expect((await mcp(acesso, "ping")).status).toBe(401);
  });

  it("a conexão é da organização aberta na autorização: trabalha nela e cai se a pessoa sair de lá", async () => {
    const outra = await criarOrganizacao("Loja da Bia");
    const pessoa = await criarPessoa({ chaves: ["conector_claude"] });
    await vincular(pessoa.id, outra, { chaves: ["conector_claude"] });
    sessao.organizacao = outra;
    const { access_token } = await conectar(pessoa.id);
    sessao.organizacao = ORGANIZACAO_PADRAO.id;

    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.organizacaoId).toBe(outra);
    const inicio = await mcp(access_token, "initialize", { protocolVersion: "2025-06-18" });
    expect(JSON.stringify(await inicio.json())).toContain("Loja da Bia");
    await mcp(access_token, "tools/call", { name: "fluxo_ver", arguments: {} });
    const [chamada] = await banco().select().from(chamadasMcp);
    expect(chamada.organizacaoId).toBe(outra);

    // Sair da Loja da Bia corta o Claude dela, mesmo continuando na organização padrão.
    await banco().delete(organizacaoMembros).where(and(eq(organizacaoMembros.organizacaoId, outra), eq(organizacaoMembros.usuarioId, pessoa.id)));
    expect((await mcp(access_token, "ping")).status).toBe(401);
  });

  it("sem a chave do conector é 403 insufficient_scope", async () => {
    const { pessoa, acesso } = await conectado();
    await mudarPessoa(pessoa.id, { chaves: ["memoria"] });
    const res = await mcp(acesso, "ping");
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect((await res.json()).error).toBe("insufficient_scope");
  });

  it("conexão parada há 60 dias expira", async () => {
    const { acesso } = await conectado();
    await banco().update(conexoes).set({ ultimoUsoEm: new Date(Date.now() - 61 * 24 * 60 * 60_000) });
    expect((await mcp(acesso, "ping")).status).toBe(401);
    const [conexao] = await banco().select().from(conexoes);
    expect(conexao.motivoRevogacao).toBe("inatividade");
  });

  it(`passou de ${LIMITE_CHAMADAS_POR_MINUTO} chamadas por minuto na mesma conexão, leva 429`, async () => {
    const { acesso } = await conectado();
    for (let i = 0; i < LIMITE_CHAMADAS_POR_MINUTO; i++) expect((await mcp(acesso, "ping")).status).toBe(200);
    const res = await mcp(acesso, "ping");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("conector MCP: protocolo", () => {
  let acesso: string;
  beforeEach(async () => {
    // Volta cada simulação ao comportamento padrão (o mockResolvedValue de um teste não vaza para o próximo).
    vi.resetAllMocks();
    await prepararTeste();
    acesso = (await conectado()).acesso;
  });

  it("initialize negocia a versão e se apresenta como hub-criativos", async () => {
    for (const [pedida, esperada] of [
      ["2025-11-25", "2025-11-25"],
      ["2025-06-18", "2025-06-18"],
      ["2025-03-26", "2025-03-26"],
      ["2024-11-05", "2025-11-25"],
    ]) {
      const { result } = await (await mcp(acesso, "initialize", { protocolVersion: pedida, capabilities: {}, clientInfo: { name: "t", version: "1" } })).json();
      expect(result.protocolVersion).toBe(esperada);
      expect(result.capabilities).toEqual({ tools: {} });
      expect(result.serverInfo.name).toBe("hub-criativos");
      expect(result.instructions).toContain("instrucoes");
      expect(result.instructions).toContain("Grupo Chegou");
      expect(result.instructions).toContain("link_de_envio");
    }
    const novo = (await (await mcp(acesso, "initialize", { protocolVersion: "2025-11-25" })).json()).result.serverInfo;
    expect(novo.title).toBe("Hub de Criativos");
    const antigo = (await (await mcp(acesso, "initialize", { protocolVersion: "2025-03-26" })).json()).result.serverInfo;
    expect(Object.keys(antigo).sort()).toEqual(["name", "version"]);
  });

  it("resposta é JSON único, sem sessão; notificação é 202 sem corpo", async () => {
    const res = await mcp(acesso, "ping", undefined, "abc");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: "abc", result: {} });
    const notificacao = await mcp(acesso, "notifications/initialized", undefined, null);
    expect(notificacao.status).toBe(202);
    expect(await notificacao.text()).toBe("");
  });

  it("lote é recusado; JSON inválido é -32700; sem jsonrpc é -32600; método desconhecido é -32601", async () => {
    const lote = await mcpCru(acesso, JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]));
    expect(lote.status).toBe(400);
    expect((await lote.json()).error.code).toBe(-32600);
    const quebrado = await mcpCru(acesso, "{nao e json");
    expect(quebrado.status).toBe(400);
    expect((await quebrado.json()).error.code).toBe(-32700);
    const semVersao = await mcpCru(acesso, JSON.stringify({ id: 1, method: "ping" }));
    expect((await semVersao.json()).error.code).toBe(-32600);
    expect((await (await mcp(acesso, "resources/list")).json()).error.code).toBe(-32601);
  });

  it("ferramenta desconhecida é -32602; versão de protocolo desconhecida no cabeçalho é 400", async () => {
    expect((await (await mcp(acesso, "tools/call", { name: "apagar_tudo", arguments: {} })).json()).error.code).toBe(-32602);
    expect((await mcp(acesso, "ping", undefined, 1, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect((await mcp(acesso, "ping", undefined, 1, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);
  });

  it("mensagem acima de 1 MB é recusada", async () => {
    const res = await mcp(acesso, "tools/call", { name: "memoria_buscar", arguments: { consulta: "x".repeat(1024 * 1024) } });
    expect(res.status).toBe(413);
  });

  it("cada ferramenta tem título, descrição, esquema fechado e anotações", async () => {
    const { result } = await (await mcp(acesso, "tools/list")).json();
    for (const f of result.tools) {
      expect(f.title, f.name).toBeTruthy();
      expect(f.description.length, f.name).toBeGreaterThan(40);
      expect(f.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(f.annotations).toMatchObject({ title: f.title, openWorldHint: false });
      expect(typeof f.annotations.readOnlyHint).toBe("boolean");
      expect(typeof f.annotations.destructiveHint).toBe("boolean");
      expect(typeof f.annotations.idempotentHint).toBe("boolean");
    }
    const porNome = Object.fromEntries(result.tools.map((f: { name: string }) => [f.name, f]));
    for (const nome of [...LEITURA_DA_MEMORIA, "instrucoes", "biblioteca_listar", "fluxo_ver"]) expect(porNome[nome].annotations.readOnlyHint, nome).toBe(true);
    for (const nome of GRAVACAO_DA_MEMORIA) expect(porNome[nome].annotations.readOnlyHint, nome).toBe(false);
    expect(porNome.memoria_salvar.annotations.destructiveHint).toBe(true);
    expect(porNome.memoria_acrescentar.annotations.destructiveHint).toBe(false);
  });
});

describe("conector MCP: ferramentas por pessoa", () => {
  beforeEach(async () => {
    // Volta cada simulação ao comportamento padrão (o mockResolvedValue de um teste não vaza para o próximo).
    vi.resetAllMocks();
    await prepararTeste();
  });

  it("a lista sai das chaves da conta", async () => {
    expect(await nomesDasFerramentas((await conectado(["conector_claude"])).acesso)).toEqual(["instrucoes"]);
    expect(await nomesDasFerramentas((await conectado(["conector_claude", "memoria"])).acesso)).toEqual(["instrucoes", ...LEITURA_DA_MEMORIA]);
    expect(await nomesDasFerramentas((await conectado(["conector_claude", "memoria_editar"])).acesso)).toEqual(["instrucoes", ...GRAVACAO_DA_MEMORIA]);
    expect(await nomesDasFerramentas((await conectado(["conector_claude", "biblioteca", "fluxo"])).acesso)).toEqual(["instrucoes", ...BIBLIOTECA, ...FLUXO]);
    expect(await nomesDasFerramentas((await conectado()).acesso)).toEqual([
      "instrucoes",
      ...LEITURA_DA_MEMORIA,
      ...GRAVACAO_DA_MEMORIA,
      ...BIBLIOTECA,
      ...FLUXO,
    ]);
  });

  it("chave retirada: a ferramenta some da lista e chamá-la dá erro, com o mesmo token", async () => {
    const { pessoa, acesso } = await conectado(["conector_claude", "memoria"]);
    expect(await nomesDasFerramentas(acesso)).toContain("memoria_buscar");
    await mudarPessoa(pessoa.id, { chaves: ["conector_claude"] });
    expect(await nomesDasFerramentas(acesso)).not.toContain("memoria_buscar");
    const resultado = await chamar(acesso, "memoria_buscar", { consulta: "hook" });
    expect(resultado.isError).toBe(true);
    expect(resultado.texto).toContain("Memória (ler)");
    expect(memoria.buscar).not.toHaveBeenCalled();
  });

  it("chamada registra a auditoria e o último uso da conexão", async () => {
    const { pessoa, acesso } = await conectado();
    await banco().update(conexoes).set({ ultimoUsoEm: new Date(Date.now() - 3 * 24 * 60 * 60_000) });
    vi.mocked(memoria.buscar).mockResolvedValue([{ ...doc({ slug: "01-regras", titulo: "Regras" }), trecho: "…hook…" }]);
    const resultado = await chamar(acesso, "memoria_buscar", { consulta: "hook", frente: "cod", limite: 5 });
    expect(resultado.isError).toBe(false);
    expect(JSON.parse(resultado.texto).resultados[0]).toMatchObject({ slug: "01-regras", trecho: "…hook…" });
    expect(memoria.buscar).toHaveBeenCalledWith("hook", { tipo: undefined, frente: "cod", limite: 5 });

    const [chamada] = await banco().select().from(chamadasMcp);
    expect(chamada).toMatchObject({ usuarioId: pessoa.id, ferramenta: "memoria_buscar", erro: null });
    expect(chamada.argumentos).toContain("hook");
    const [conexao] = await banco().select().from(conexoes);
    expect(Date.now() - conexao.ultimoUsoEm!.getTime()).toBeLessThan(60_000);
  });

  it("erro de ferramenta volta como resultado com isError e texto em português, e fica na auditoria", async () => {
    const { acesso } = await conectado();
    vi.mocked(memoria.salvar).mockRejectedValue(new ConflitoDeVersao("01-regras", 3, 2));
    const resultado = await chamar(acesso, "memoria_salvar", { slug: "01-regras", conteudo: "novo", versao_esperada: 2 });
    expect(resultado.isError).toBe(true);
    expect(resultado.texto).toContain("mudou desde que você leu");
    const [chamada] = await banco().select().from(chamadasMcp);
    expect(chamada.erro).toContain("mudou desde que você leu");

    const semArgumento = await chamar(acesso, "memoria_buscar", {});
    expect(semArgumento.isError).toBe(true);
    expect(semArgumento.texto).toContain("consulta");
    const tipoErrado = await chamar(acesso, "memoria_indice", { tipo: "receita" });
    expect(tipoErrado.isError).toBe(true);
    expect(tipoErrado.texto).toContain("regra, fluxo");
  });

  it("segredo recusado pela Memória não fica gravado na auditoria", async () => {
    const { acesso } = await conectado();
    vi.mocked(memoria.salvar).mockRejectedValue(new SegredoDetectado("chave da Anthropic"));
    // Montada aqui para nenhuma chave com cara de verdade ficar escrita no repositório.
    const chave = `sk-ant-api03-${"Ab1".repeat(15)}`;
    // A chave começa perto do caractere 200, onde o resumo corta: cortada, sobraria o começo dela.
    const conteudo = `${"texto comum ".repeat(16)}${chave}`;
    const resultado = await chamar(acesso, "memoria_salvar", {
      slug: "vozes-clonadas",
      conteudo,
      versao_esperada: 1,
      nota: `xi-api-key: ${"k9".repeat(10)}`,
      // Campo inventado: "senha" só vira segredo junto com o nome.
      senha: "Abc1234567890xyz",
    });
    expect(resultado.isError).toBe(true);
    expect(resultado.texto).toContain("chave ou senha");

    const [chamada] = await banco().select().from(chamadasMcp);
    expect(JSON.parse(chamada.argumentos)).toEqual({
      slug: "vozes-clonadas",
      conteudo: SEGREDO_REMOVIDO,
      versao_esperada: 1,
      nota: SEGREDO_REMOVIDO,
      senha: SEGREDO_REMOVIDO,
    });
    expect(chamada.argumentos).not.toContain("sk-ant");
    expect(chamada.argumentos).not.toContain("Abc123");
    // O motivo da recusa continua na auditoria (ele não repete o segredo).
    expect(chamada.erro).toContain("chave da Anthropic");
  });

  it("o conector não deixa o Claude mudar o que entra no prompt dos agentes (noPrompt)", async () => {
    const { acesso } = await conectado();
    const res = await mcp(acesso, "tools/list");
    const ferramentas = ((await res.json()) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }).result.tools;
    for (const f of ferramentas) expect(Object.keys(f.inputSchema.properties).filter((p) => /prompt/i.test(p)), f.name).toEqual([]);

    // Mesmo mandando o campo por fora do esquema, ele não chega à Memória.
    vi.mocked(memoria.salvar).mockResolvedValue(doc({ slug: "02-regras", versao: 2 }));
    const resultado = await chamar(acesso, "memoria_salvar", { slug: "02-regras", conteudo: "# Regras", versao_esperada: 1, noPrompt: true, no_prompt: true });
    expect(resultado.isError).toBe(false);
    expect(vi.mocked(memoria.salvar).mock.calls[0][0]).not.toHaveProperty("noPrompt");
  });

  it("gravação sai com o autor da pessoa (Claude Code) e versao_esperada null cria", async () => {
    const { pessoa, acesso } = await conectado();
    vi.mocked(memoria.salvar).mockResolvedValue(doc({ slug: "vozes-clonadas", titulo: "Vozes", versao: 1 }));
    const resultado = await chamar(acesso, "memoria_salvar", {
      slug: "vozes-clonadas",
      conteudo: "# Vozes",
      versao_esperada: null,
      titulo: "Vozes",
      tipo: "fato",
      frente: "geral",
      precisa_revisao: true,
    });
    expect(resultado.isError).toBe(false);
    expect(memoria.salvar).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "vozes-clonadas", versaoEsperada: null, tipo: "fato", precisaRevisao: true }),
      { id: pessoa.id, nome: "Sávio (Claude Code)" },
    );
    const sem = await chamar(acesso, "memoria_salvar", { slug: "x", conteudo: "y" });
    expect(sem.isError).toBe(true);
    expect(sem.texto).toContain("versao_esperada");
  });

  it("projeto e lição exigem data absoluta", async () => {
    const { acesso } = await conectado();
    const ruim = await chamar(acesso, "licao_registrar", { titulo: "t", data: "ontem", o_que_aconteceu: "a", regra: "r" });
    expect(ruim.isError).toBe(true);
    expect(ruim.texto).toContain("AAAA-MM-DD");
    vi.mocked(memoria.registrarLicao).mockResolvedValue(doc({ slug: "22-licoes-producao-video", versao: 4 }));
    const bom = await chamar(acesso, "licao_registrar", { titulo: "t", data: "2026-10-15", o_que_aconteceu: "a", regra: "r" });
    expect(bom.isError).toBe(false);
    expect(memoria.registrarLicao).toHaveBeenCalledWith(
      { titulo: "t", data: "2026-10-15", oQueAconteceu: "a", regra: "r", relacionado: undefined },
      expect.objectContaining({ nome: "Sávio (Claude Code)" }),
    );
  });

  it("memoria_ler pagina documento longo e diz a versão para editar", async () => {
    const { acesso } = await conectado();
    const linha = "Uma regra importante da operação.\n";
    vi.mocked(memoria.ler).mockResolvedValue(doc({ slug: "longo", titulo: "Longo", versao: 7, conteudo: linha.repeat(3000) }));
    const p1 = await chamar(acesso, "memoria_ler", { slug: "longo" });
    expect(p1.texto).toContain("versao_esperada = 7");
    expect(p1.texto).toMatch(/Página 1 de 3/);
    expect(p1.texto.length).toBeLessThanOrEqual(40_000);
    const p3 = await chamar(acesso, "memoria_ler", { slug: "longo", pagina: 3 });
    expect(p3.texto).toContain("Página 3 de 3 (última)");
    vi.mocked(memoria.ler).mockResolvedValue(null);
    const nenhum = await chamar(acesso, "memoria_ler", { slug: "nao-existe" });
    expect(nenhum.isError).toBe(true);
  });

  it("instrucoes traz o como usar, as regras e fatos centrais e a lista dos outros documentos", async () => {
    const { acesso } = await conectado();
    vi.mocked(memoria.documentosDoPrompt).mockResolvedValue([
      doc({ slug: "02-fatos", titulo: "Fatos do negócio", tipo: "fato", conteudo: "Faturamento é por frente." }),
      doc({ slug: "leia-primeiro", titulo: "Leia primeiro", tipo: "regra", conteudo: "Busque antes de afirmar." }),
      doc({ slug: "playbook-copy", titulo: "Playbook de copy", tipo: "playbook", conteudo: "NÃO DEVE APARECER" }),
    ]);
    vi.mocked(memoria.listarIndice).mockResolvedValue([
      doc({ slug: "leia-primeiro", titulo: "Leia primeiro" }),
      doc({ slug: "05-traducao", titulo: "Tradução de criativos", tipo: "fluxo", frente: "info" }),
    ]);
    const { texto, isError } = await chamar(acesso, "instrucoes");
    expect(isError).toBe(false);
    expect(texto).toContain("## Como usar as ferramentas");
    expect(texto).toContain("Busque antes de afirmar.");
    expect(texto).toContain("Faturamento é por frente.");
    expect(texto).not.toContain("NÃO DEVE APARECER");
    expect(texto).toContain("`05-traducao`: Tradução de criativos (fluxo, info)");
    // leia-primeiro vem antes dos numerados.
    expect(texto.indexOf("Busque antes de afirmar.")).toBeLessThan(texto.indexOf("Faturamento é por frente."));
  });

  it("instrucoes sem a chave da memória não mostra nada da memória", async () => {
    const { acesso } = await conectado(["conector_claude"]);
    const { texto } = await chamar(acesso, "instrucoes");
    expect(texto).toContain("Esta conta não tem acesso a");
    expect(memoria.documentosDoPrompt).not.toHaveBeenCalled();
    expect(memoria.listarIndice).not.toHaveBeenCalled();
  });

  it("instrucoes longa vem em páginas", async () => {
    const { acesso } = await conectado();
    vi.mocked(memoria.documentosDoPrompt).mockResolvedValue([doc({ slug: "01-regras", tipo: "regra", conteudo: "Regra da casa.\n".repeat(6000) })]);
    const p1 = await chamar(acesso, "instrucoes");
    expect(p1.texto).toContain("Página 1 de");
    expect(p1.texto).toContain("instrucoes com pagina 2");
    expect((await chamar(acesso, "instrucoes", { pagina: 2 })).isError).toBe(false);
    expect((await chamar(acesso, "instrucoes", { pagina: 99 })).isError).toBe(true);
  });

  it("fluxo_ver e fluxo_salvar_card usam o quadro", async () => {
    const { acesso } = await conectado();
    const quadro = JSON.parse((await chamar(acesso, "fluxo_ver")).texto);
    expect(quadro.colunas[0]).toMatchObject({ id: "ideias", titulo: "Ideias", cards: [{ id: "c1", titulo: "Kit Chile", operacao: "cod" }] });
    const criado = await chamar(acesso, "fluxo_salvar_card", { titulo: "Novo criativo", coluna: "Ideias" });
    expect(criado.isError).toBe(false);
    const semColuna = await chamar(acesso, "fluxo_salvar_card", { titulo: "x", coluna: "Inexistente" });
    expect(semColuna.isError).toBe(true);
    expect(semColuna.texto).toContain("Coluna não encontrada");
  });
});
