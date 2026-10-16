import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as mcpDoHub } from "@/app/api/mcp/route";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { comOrganizacao, organizacaoAtual, SemOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { criarConta, criarOrganizacao } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { ler, listarIndice, salvar } from "@/features/memoria/servicos/memoria";
import { createCard, getBoard } from "@/lib/server/board";
import { mcpTokenDa } from "@/lib/server/chat/claude-code";
import { getChat, listChats, newChat, saveChat } from "@/lib/server/chat/store";
import { route } from "@/lib/server/http";
import { DATA_DIR, pastaDaOrganizacao, usarRaizDosDados } from "@/lib/server/pastas";
import { createGeneration, getGeneration, listGenerations } from "@/lib/server/store";

// Cada organização tem os próprios dados: o que uma grava, a outra não lê (arquivos, Memória, MCP do hub, rotas).

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});

const RAIZ = mkdtempSync(path.join(os.tmpdir(), "hub-isolamento-"));
usarRaizDosDados(RAIZ);
const PADRAO = ORGANIZACAO_PADRAO.id;
const ana = { id: null, nome: "Ana" };

describe("isolamento entre organizações", () => {
  let outra: string;

  beforeEach(async () => {
    await bancoDeTeste();
    outra = await criarOrganizacao("Loja da Bia");
    sessao.logado = null;
    sessao.organizacao = PADRAO;
  });
  afterAll(async () => {
    usarRaizDosDados(undefined);
    await rm(RAIZ, { recursive: true, force: true });
  });

  it("pastas: a padrão continua na raiz de .data/, as outras numa subpasta só delas", () => {
    usarRaizDosDados(undefined);
    expect(pastaDaOrganizacao(PADRAO)).toBe(DATA_DIR);
    expect(pastaDaOrganizacao(outra)).toBe(path.join(DATA_DIR, "organizacoes", outra));
    expect(() => pastaDaOrganizacao("../../etc")).toThrow();
    usarRaizDosDados(RAIZ);
  });

  it("gerações, conversas e Fluxo: cada organização só vê as suas", async () => {
    const g = await comOrganizacao(PADRAO, () => createGeneration({ tool: "upload", kind: "image", status: "done", prompt: "foto", params: {}, file: "a.png" }));
    await comOrganizacao(outra, async () => {
      expect(await listGenerations()).toEqual([]);
      expect(await getGeneration(g.id)).toBeUndefined();
      const c = newChat("Conversa da Bia", "sistema");
      await saveChat(c);
      await createCard({ title: "Card da Bia" });
    });
    await comOrganizacao(PADRAO, async () => {
      expect((await listGenerations()).map((x) => x.id)).toEqual([g.id]);
      expect(await listChats()).toEqual([]);
      expect(Object.values((await getBoard()).cards)).toEqual([]);
    });
    await comOrganizacao(outra, async () => {
      expect((await listChats()).map((c) => c.title)).toEqual(["Conversa da Bia"]);
      const [id] = (await listChats()).map((c) => c.id);
      expect((await getChat(id))?.title).toBe("Conversa da Bia");
    });
    // A conversa da Bia não existe para a padrão, nem pelo id.
    const [daBia] = await comOrganizacao(outra, () => listChats());
    expect(await comOrganizacao(PADRAO, () => getChat(daBia.id))).toBeNull();
    expect(await readdir(path.join(RAIZ, "organizacoes", outra))).toEqual(expect.arrayContaining(["board.json", "chats"]));
  });

  it("Memória: o mesmo nome de documento em duas organizações, cada uma com o seu texto", async () => {
    await comOrganizacao(PADRAO, () => salvar({ slug: "02-regras", conteudo: "# Regras\n\nMargem do Grupo Chegou: 37%.", versaoEsperada: null, tipo: "regra" }, ana));
    await comOrganizacao(outra, async () => {
      expect(await ler("02-regras")).toBeNull();
      expect(await listarIndice()).toEqual([]);
      await salvar({ slug: "02-regras", conteudo: "# Regras\n\nRegras da Bia.", versaoEsperada: null, tipo: "regra" }, ana);
      expect((await ler("02-regras"))?.conteudo).toContain("Regras da Bia.");
    });
    expect((await comOrganizacao(PADRAO, () => ler("02-regras")))?.conteudo).toContain("37%");
  });

  it("fora de uma organização, com banco, nada é lido nem gravado", async () => {
    const url = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    try {
      await expect(organizacaoAtual()).rejects.toThrow(SemOrganizacao);
      await expect(listGenerations()).rejects.toThrow(SemOrganizacao);
    } finally {
      if (url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = url;
    }
  });

  it("rotas rodam na organização da sessão e recusam (409) a tela carregada em outra", async () => {
    const pessoa = await criarConta({ email: "bia@exemplo.com", papel: "dono", organizacaoId: outra });
    sessao.logado = pessoa.id;
    sessao.organizacao = outra;
    const rota = route<[Request]>(async () => Response.json({ org: await organizacaoAtual() }));

    expect(await (await rota(new Request("https://hub.teste/api/x"))).json()).toEqual({ org: outra });
    const igual = await rota(new Request("https://hub.teste/api/x", { headers: { "x-hub-organizacao": outra } }));
    expect(igual.status).toBe(200);
    const trocada = await rota(new Request("https://hub.teste/api/x", { headers: { "x-hub-organizacao": PADRAO } }));
    expect(trocada.status).toBe(409);
    expect(await trocada.json()).toMatchObject({ codigo: "organizacao_trocada" });
  });

  it("MCP do hub (cérebro Claude Code): o token vale só para a organização dele", async () => {
    const chamar = (org: string, token: string) =>
      mcpDoHub(
        new Request(`https://hub.teste/api/mcp?org=${org}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        }),
      );
    expect((await chamar(outra, mcpTokenDa(outra))).status).toBe(200);
    expect((await chamar(PADRAO, mcpTokenDa(outra))).status).toBe(401);
    expect((await chamar("nao-e-uuid", mcpTokenDa("nao-e-uuid"))).status).toBe(401);
  });
});
