import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as enviarMensagem } from "@/app/api/chat/route";
import { POST as novaConversa } from "@/app/api/chat/new/route";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Chave, type Usuario } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { criarConta, garantirOrganizacaoPadrao } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { salvar } from "@/features/memoria/servicos/memoria";
import type { Generation } from "@/lib/generations";
import { runFlora } from "@/lib/server/actions";
import { runChatTurn } from "@/lib/server/chat/run";
import { getChat } from "@/lib/server/chat/store";
import { buildSystemPrompt } from "@/lib/server/chat/system";
import { ferramentasDaPessoa, runTool, TOOL_NAMES } from "@/lib/server/chat/tools";
import { usarRaizDosDados } from "@/lib/server/pastas";
import { createProject } from "@/lib/server/providers/flora";

// Achado MÉDIO 5 da revisão de segurança: as ferramentas do chat não sabiam quem estava usando. Uma conta só com o
// "chat" lia a Memória e gerava nos estúdios (gastando crédito) pelo agente. Agora cada ferramenta confere a chave da
// pessoa, a conversa nova só leva as ferramentas e a Memória que ela pode usar.

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
// Serviços externos simulados: nada sai para o FLORA nem para a Anthropic.
vi.mock("@/lib/server/actions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/actions")>();
  return { ...real, runFlora: vi.fn() };
});
vi.mock("@/lib/server/providers/flora", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/providers/flora")>();
  return { ...real, listProjects: vi.fn(async () => []), createProject: vi.fn(async (name: string) => ({ id: "p1", name, lastModified: null })) };
});
vi.mock("@/lib/server/chat/run", () => ({ runChatTurn: vi.fn(async () => undefined) }));
// O cérebro sai da máquina: com o Claude Code instalado (o PC de quem roda os testes) o chat iria por ele. Aqui é
// sempre o da nuvem, pela API.
vi.mock("@/lib/server/chat/claude-code", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/chat/claude-code")>();
  return { ...real, usesApiBrain: () => true };
});

// As conversas ficam numa pasta temporária, não no .data de verdade.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "hub-chat-acesso-"));
usarRaizDosDados(DATA_DIR);

const urlOriginal = process.env.DATABASE_URL;
const chaveOriginal = process.env.ANTHROPIC_API_KEY;
const BASE = "https://hub.teste";
const ana = { id: null, nome: "Ana" };
const SEGREDO = "Margem real da loja: 37%.";

const conta = (chaves: Chave[], papel: Usuario["papel"] = "membro"): Usuario => ({
  id: crypto.randomUUID(),
  email: "x@exemplo.com",
  nome: "X",
  papel,
  ativo: true,
  chaves,
  organizacao: { id: ORGANIZACAO_PADRAO.id, nome: ORGANIZACAO_PADRAO.nome, situacao: "ativa" },
  operaPlataforma: false,
});
// Com DATABASE_URL (o hub da nuvem), o que roda fora de uma rota precisa dizer a organização.
const naPadrao = <T,>(fn: () => Promise<T>) => comOrganizacao(ORGANIZACAO_PADRAO.id, fn);
const soChat = conta(["chat"]);
const comTudo = conta(["chat", "memoria", "memoria_editar", "estudios", "fluxo", "editor"]);
const ctx = (usuario: Usuario) => ({ signal: new AbortController().signal, usuario });
const SEM_MEMORIA = 'Sua conta não tem acesso a "Memória (ler)". Peça a um admin.';
const SEM_ESTUDIOS = 'Sua conta não tem acesso a "Estúdios (gera no FLORA, ElevenLabs e HeyGen, gasta créditos)". Peça a um admin.';

const geracaoFalsa = { id: "g1", tool: "flora", kind: "image", status: "running", prompt: "frame", params: {}, createdAt: new Date().toISOString() } as Generation;

async function entrarCom(chaves: Chave[], papel: Usuario["papel"] = "membro") {
  const pessoa = await criarConta({ email: `${chaves.join("-") || "nada"}-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves, papel, senha: null });
  sessao.logado = pessoa.id;
  return pessoa;
}

// Memória com um documento no prompt (com o "segredo") e outro só na lista.
async function memoriaComSegredo() {
  await naPadrao(async () => {
    await salvar({ slug: "02-regras", conteudo: `# Regras gerais\n\n${SEGREDO}`, versaoEsperada: null, tipo: "regra", noPrompt: true }, ana);
    await salvar({ slug: "05-traducao", conteudo: "# Tradução de criativos\n\nPasso a passo.", versaoEsperada: null, tipo: "fluxo" }, ana);
  });
}

describe("ferramentas do chat: chave de cada uma", () => {
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    await bancoDeTeste();
    await garantirOrganizacaoPadrao();
    sessao.logado = null;
    vi.mocked(runFlora).mockReset().mockResolvedValue([geracaoFalsa]);
    vi.mocked(createProject).mockClear();
    vi.mocked(runChatTurn).mockClear();
  });
  afterAll(async () => {
    if (urlOriginal === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = urlOriginal;
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("conta só com o chat: Memória e geração recusadas, sem chamar o serviço", async () => {
    await memoriaComSegredo();
    const ler = await runTool("memoria_ler", { slug: "02-regras" }, ctx(soChat));
    expect(ler).toMatchObject({ error: true, content: SEM_MEMORIA });
    expect(String(ler.content)).not.toContain(SEGREDO);
    expect(await runTool("memoria_buscar", { consulta: "margem" }, ctx(soChat))).toMatchObject({ error: true, content: SEM_MEMORIA });

    expect(await runTool("flora_generate", { family: "x", prompt: "frame" }, ctx(soChat))).toMatchObject({ error: true, content: SEM_ESTUDIOS });
    expect(runFlora).not.toHaveBeenCalled();

    expect(await runTool("pipeline_save_card", { title: "Card" }, ctx(soChat))).toMatchObject({ error: true, content: 'Sua conta não tem acesso a "Fluxo (quadro de tarefas)". Peça a um admin.' });
    expect(await runTool("editor_render", { project_id: "p" }, ctx(soChat))).toMatchObject({ error: true, content: 'Sua conta não tem acesso a "Editor de vídeo". Peça a um admin.' });
    for (const nome of ["elevenlabs_tts", "heygen_create_video", "heygen_translate_video", "hub_montage", "hub_beat_edit", "hub_transcribe", "hub_transcript_read"]) {
      expect(await runTool(nome, {}, ctx(soChat))).toMatchObject({ error: true, content: SEM_ESTUDIOS });
    }
  });

  it("conta com as chaves (e admin sem chaves marcadas) usa normalmente", async () => {
    await memoriaComSegredo();
    for (const pessoa of [comTudo, conta([], "admin")]) {
      const ler = await runTool("memoria_ler", { slug: "02-regras" }, ctx(pessoa));
      expect(ler.error).toBe(false);
      expect(String(ler.content)).toContain(SEGREDO);
      expect(await runTool("memoria_buscar", { consulta: "traducao" }, ctx(pessoa))).toMatchObject({ error: false, summary: "1 documento" });

      const gerou = await runTool("flora_generate", { family: "x", prompt: "frame" }, ctx(pessoa));
      expect(gerou).toMatchObject({ error: false, generations: [geracaoFalsa] });
    }
    expect(runFlora).toHaveBeenCalledTimes(2);
  });

  it("conta inativa perde tudo, mesmo com as chaves", async () => {
    await memoriaComSegredo();
    expect(await runTool("memoria_ler", { slug: "02-regras" }, ctx({ ...comTudo, ativo: false }))).toMatchObject({ error: true, content: SEM_MEMORIA });
  });

  it("chave só em parte das chamadas: criar projeto no FLORA e assistir com a fala", async () => {
    expect(await runTool("flora_projects", { action: "create", name: "Novo" }, ctx(soChat))).toMatchObject({ error: true, content: SEM_ESTUDIOS });
    expect(createProject).not.toHaveBeenCalled();
    expect(await runTool("flora_projects", { action: "list" }, ctx(soChat))).toMatchObject({ error: false });
    expect(await runTool("flora_projects", { action: "create", name: "Novo" }, ctx(comTudo))).toMatchObject({ error: false, summary: "projeto criado: Novo" });

    // Assistir com a fala transcreve pelo Scribe (crédito). O erro ensina o agente a assistir sem ela.
    const comFala = await runTool("hub_view_video", { generation_id: "nao-existe" }, ctx(soChat));
    expect(comFala).toMatchObject({ error: true });
    expect(String(comFala.content)).toBe(`${SEM_ESTUDIOS} Sem a fala, dá para assistir: chame hub_view_video de novo com transcribe=false.`);
    // Sem a fala passa pela trava (e cai no erro normal: a geração não existe).
    const semFala = await runTool("hub_view_video", { generation_id: "nao-existe", transcribe: false }, ctx(soChat));
    expect(semFala.error).toBe(true);
    expect(String(semFala.content)).not.toContain("não tem acesso");
  });

  it("listagens e o que não gasta continuam livres para quem tem só o chat", () => {
    const lista = ferramentasDaPessoa(soChat);
    for (const livre of ["servico_ferramentas", "hub_list_generations", "hub_check_generations", "elevenlabs_list_voices", "heygen_list_avatars", "heygen_list_voices", "flora_list_models", "flora_quote", "hub_remove_captions", "hub_list_chats", "hub_read_chat"]) {
      expect(lista).toContain(livre);
    }
    // As que exigem a chave só em parte das chamadas ficam na lista (a trava é na chamada).
    expect(lista).toContain("flora_projects");
    expect(lista).toContain("hub_view_video");
    for (const fora of ["memoria_buscar", "memoria_ler", "memoria_salvar", "servico_chamar", "servico_importar_arquivo", "flora_generate", "elevenlabs_tts", "heygen_create_video", "heygen_translate_video", "hub_montage", "hub_beat_edit", "hub_transcribe", "hub_transcript_read", "pipeline_get", "pipeline_save_card", "editor_open", "editor_render", "editor_join"]) {
      expect(lista).not.toContain(fora);
    }
    // Só filtra: a ordem das definições não muda (prefixo cacheado).
    expect(lista).toEqual(TOOL_NAMES.filter((n) => lista.includes(n)));
    expect(ferramentasDaPessoa(comTudo)).toEqual(TOOL_NAMES);
    expect(ferramentasDaPessoa(conta([], "dono"))).toEqual(TOOL_NAMES);
  });

  it("prompt: sem a chave memoria, nada da Memória; com ela, a Memória inteira", async () => {
    await memoriaComSegredo();
    const semMemoria = await naPadrao(() => buildSystemPrompt(undefined, soChat));
    expect(semMemoria).not.toContain(SEGREDO);
    expect(semMemoria).not.toContain("# Memória da operação");
    expect(semMemoria).not.toContain("05-traducao");
    expect(semMemoria).toContain("# Playbooks");

    const comMemoria = await naPadrao(() => buildSystemPrompt(undefined, comTudo));
    expect(comMemoria).toContain(SEGREDO);
    expect(comMemoria).toContain("- 05-traducao · Tradução de criativos");
    expect(comMemoria).not.toContain("# Playbooks");
  });

  it("Nova conversa: lista de ferramentas e prompt de quem cria", async () => {
    await memoriaComSegredo();
    const criar = () => novaConversa(new Request(`${BASE}/api/chat/new`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));

    await entrarCom(["chat"]);
    const r1 = await criar();
    expect(r1.status).toBe(200);
    const id1 = ((await r1.json()) as { chat: { id: string } }).chat.id;
    const c1 = (await naPadrao(() => getChat(id1)))!;
    expect(c1.toolNames).toEqual(ferramentasDaPessoa(soChat));
    expect(c1.toolNames).not.toContain("memoria_ler");
    expect(c1.toolNames).not.toContain("flora_generate");
    expect(c1.system).not.toContain(SEGREDO);

    await entrarCom(["chat", "memoria", "memoria_editar", "estudios", "fluxo", "editor"]);
    const r2 = await criar();
    const id2 = ((await r2.json()) as { chat: { id: string } }).chat.id;
    const c2 = (await naPadrao(() => getChat(id2)))!;
    expect(c2.toolNames).toEqual(TOOL_NAMES);
    expect(c2.system).toContain(SEGREDO);
  });

  it("mensagem nova (modo API): conversa filtrada e a pessoa chega ao cérebro", async () => {
    await memoriaComSegredo();
    // A variável antiga ainda serve de ponto de partida para a chave (features/integracoes/servicos/chaves.ts).
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    try {
      const pessoa = await entrarCom(["chat"]);
      const form = new FormData();
      form.set("text", "Oi");
      const r = await enviarMensagem(new Request(`${BASE}/api/chat`, { method: "POST", body: form }));
      expect(r.status).toBe(200);
      const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; chat?: { id: string } });
      expect(linhas.at(-1)?.type).toBe("done");

      expect(runChatTurn).toHaveBeenCalledTimes(1);
      const [conversa, , , usuario] = vi.mocked(runChatTurn).mock.calls[0];
      expect(usuario).toMatchObject({ id: pessoa.id, chaves: ["chat"] });
      expect(conversa.toolNames).toEqual(ferramentasDaPessoa(pessoa));
      expect(conversa.system).not.toContain(SEGREDO);
    } finally {
      if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = chaveOriginal;
    }
  });
});
