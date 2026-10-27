import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as enviarMensagem } from "@/app/api/chat/route";
import { POST as receberDoSkala } from "@/app/api/skala/criativos/route";
import { banco } from "@/db/cliente";
import { skalaEntregas } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { criarConta, criarOrganizacao } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { driveConectado } from "@/features/drive/servicos/conta";
import { guardarNoDriveEmSegundoPlano } from "@/features/drive/servicos/videos";
import { VARIAVEL_DA_CHAVE } from "@/features/skala/contrato";
import { situacaoDaEntrega } from "@/features/skala/servicos/entregas";
import { runChatTurn } from "@/lib/server/chat/run";
import { getChat } from "@/lib/server/chat/store";
import { usarRaizDosDados } from "@/lib/server/pastas";
import { getGeneration } from "@/lib/server/store";

// A conexão com o Skala (features/skala): o servidor do Skala manda o criativo com a chave, o hub devolve o link, e
// a primeira mensagem do chat baixa o vídeo do CDN e começa a conversa. Nada sai para a internet: o CDN do TikTok,
// o Drive e a Anthropic são simulados.

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});
vi.mock("@/lib/server/chat/run", () => ({ runChatTurn: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/chat/claude-code", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/chat/claude-code")>();
  return { ...real, usesApiBrain: () => true };
});
vi.mock("@/features/drive/servicos/conta", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/drive/servicos/conta")>();
  return { ...real, driveConectado: vi.fn(async () => true) };
});
vi.mock("@/features/drive/servicos/videos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/drive/servicos/videos")>();
  return { ...real, guardarNoDriveEmSegundoPlano: vi.fn() };
});

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "hub-skala-"));
usarRaizDosDados(DATA_DIR);

const BASE = "https://hub.teste";
const CHAVE = "chave-combinada-de-teste-com-mais-de-32-letras";
const VIDEO_URL = "https://v16m.tiktokcdn.com/abc/video.mp4?x-expires=1";
const CAPA_URL = "https://p16-sign.tiktokcdn.com/capa.jpeg";
const original = { url: process.env.DATABASE_URL, anthropic: process.env.ANTHROPIC_API_KEY, chave: process.env[VARIAVEL_DA_CHAVE] };

// Bytes de mentira com o começo certo de cada formato (o hub confere o tipo pelos primeiros bytes).
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(2000, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 2)]);

type Rota = (url: string) => Response;
const cdn: { rotas: Record<string, Rota>; pedidos: string[] } = { rotas: {}, pedidos: [] };
const binario = (bytes: Buffer, tipo = "application/octet-stream") => () => new Response(new Uint8Array(bytes), { headers: { "content-type": tipo, "content-length": String(bytes.length) } });

const criativo = (extra: Record<string, unknown> = {}) => ({
  id: "7430000000000000001",
  nome: "CAMERA - AD03 susto",
  plataforma: "TikTok",
  produto: "Câmera Wi-Fi",
  paises: ["CL", "MX"],
  periodo: "01/10/2026 a 26/10/2026",
  video_url: VIDEO_URL,
  capa_url: CAPA_URL,
  metricas: { Gasto: "US$ 1.234,56", Vendas: 87, CPA: "US$ 14,19" },
  anuncios: [{ campanha: "CL | CAMERA | ABO", conta: "Conta 1", pais: "CL", gasto: 800, vendas: 60 }],
  ...extra,
});

function pedidoDoSkala(corpo: unknown, chave: string | null = CHAVE) {
  return receberDoSkala(
    new Request(`${BASE}/api/skala/criativos`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
}

async function novoLink(corpo: unknown = { criativos: [criativo()] }) {
  const r = await pedidoDoSkala(corpo);
  expect(r.status).toBe(201);
  const dados = (await r.json()) as { url: string; expira_em: string };
  return { ...dados, token: new URL(dados.url).searchParams.get("skala")! };
}

async function abrirNoChat(token: string) {
  const form = new FormData();
  form.set("text", "");
  form.set("skala", token);
  const r = await enviarMensagem(new Request(`${BASE}/api/chat`, { method: "POST", body: form }));
  const corpo = await r.text();
  if (r.status !== 200) return { status: r.status, erro: (JSON.parse(corpo) as { error: string }).error };
  const eventos = corpo.trim().split("\n").map((l) => JSON.parse(l) as { type: string; chat?: { id: string; title: string }; item?: { text: string; attachments: { kind: string; name: string }[] } });
  return { status: r.status, eventos, chatId: eventos.find((e) => e.type === "chat")!.chat!.id };
}

// Fora de uma rota, com banco, quem lê arquivo diz a organização.
const naPadrao = <T,>(fn: () => Promise<T>) => comOrganizacao(ORGANIZACAO_PADRAO.id, fn);

const textosDaMensagem = async (chatId: string) => {
  const chat = (await naPadrao(() => getChat(chatId)))!;
  const conteudo = chat.messages[0].content as { type: string; text?: string }[];
  return { chat, textos: conteudo.filter((b) => b.type === "text").map((b) => b.text!), conteudo };
};

describe("conexão com o Skala", () => {
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.DATABASE_URL = "postgres://banco-de-teste";
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    process.env[VARIAVEL_DA_CHAVE] = CHAVE;
    await bancoDeTeste();
    const pessoa = await criarConta({ email: `ana-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves: ["chat"], senha: null });
    sessao.logado = pessoa.id;
    vi.mocked(runChatTurn).mockClear();
    vi.mocked(guardarNoDriveEmSegundoPlano).mockClear();
    vi.mocked(driveConectado).mockResolvedValue(true);
    cdn.rotas = { [VIDEO_URL]: binario(MP4, "video/mp4"), [CAPA_URL]: binario(JPEG, "image/jpeg") };
    cdn.pedidos = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: string | URL | Request) => {
        const url = String(entrada instanceof Request ? entrada.url : entrada);
        cdn.pedidos.push(url);
        const rota = cdn.rotas[url];
        return rota ? rota(url) : new Response("não existe", { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    for (const [nome, valor] of [["DATABASE_URL", original.url], ["ANTHROPIC_API_KEY", original.anthropic], [VARIAVEL_DA_CHAVE, original.chave]] as const) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("sem a chave certa não grava nada; sem a variável a conexão fica desligada", async () => {
    expect((await pedidoDoSkala({ criativos: [criativo()] }, null)).status).toBe(401);
    expect((await pedidoDoSkala({ criativos: [criativo()] }, "chave-errada-mas-comprida-o-bastante-123")).status).toBe(401);
    process.env[VARIAVEL_DA_CHAVE] = "curta";
    expect((await pedidoDoSkala({ criativos: [criativo()] }, "curta")).status).toBe(503);
    delete process.env[VARIAVEL_DA_CHAVE];
    expect((await pedidoDoSkala({ criativos: [criativo()] })).status).toBe(503);
    expect(await banco().select().from(skalaEntregas)).toHaveLength(0);
  });

  it("confere o que chega: id obrigatório, mídia só do Skala e dos CDNs, corpo com teto", async () => {
    const semId = await pedidoDoSkala({ criativos: [{ nome: "x" }] });
    expect(semId.status).toBe(400);
    expect(((await semId.json()) as { error: string }).error).toContain('falta o "id"');
    const deFora = await pedidoDoSkala({ criativos: [criativo({ video_url: "https://servidor-qualquer.com/v.mp4" })] });
    expect(deFora.status).toBe(400);
    expect(((await deFora.json()) as { error: string }).error).toContain("servidor-qualquer.com");
    expect((await pedidoDoSkala({ criativos: [criativo({ video_url: "https://127.0.0.1/v.mp4" })] })).status).toBe(400);
    expect((await pedidoDoSkala({ criativos: Array.from({ length: 6 }, (_, i) => criativo({ id: String(i) })) })).status).toBe(400);
    expect((await pedidoDoSkala("não é json")).status).toBe(400);
    expect((await pedidoDoSkala({ criativos: [criativo({ texto: "a".repeat(300 * 1024) })] })).status).toBe(413);
    expect(await banco().select().from(skalaEntregas)).toHaveLength(0);
  });

  it("devolve o link de uso único; o banco guarda só o hash do token", async () => {
    const { url, token, expira_em } = await novoLink();
    expect(url).toBe(`${BASE}/chat?skala=${token}`);
    expect(token).toMatch(/^hub_sk_[\w-]{40,}$/);
    expect(new Date(expira_em).getTime() - Date.now()).toBeGreaterThan(115 * 60_000);
    const [linha] = await banco().select().from(skalaEntregas);
    expect(linha.tokenHash).not.toContain(token);
    expect(JSON.stringify(linha)).not.toContain(token);
    expect(linha.criativos[0]).toMatchObject({ id: "7430000000000000001", videoUrl: VIDEO_URL, metricas: { Vendas: 87 } });
    expect(linha.pedido).toBe("Me dê ganchos baseados neste criativo.");
    expect((await situacaoDaEntrega(token)).estado).toBe("pendente");
    expect((await situacaoDaEntrega("hub_sk_inventado")).estado).toBe("invalida");
  });

  it("abrir o link começa a conversa com o vídeo (que vai para o Drive), a ficha e o pedido; o link não serve de novo", async () => {
    const { token } = await novoLink();
    const aberto = await abrirNoChat(token);
    expect(aberto.status).toBe(200);
    expect(runChatTurn).toHaveBeenCalledTimes(1);

    const usuario = aberto.eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toBe('Me dê ganchos baseados neste criativo.\n\nCriativo do Skala: "CAMERA - AD03 susto".');
    expect(usuario.attachments.map((a) => [a.kind, a.name])).toEqual([
      ["video", "CAMERA - AD03 susto.mp4"],
      ["text", "Ficha do Skala - CAMERA - AD03 susto.md"],
    ]);
    expect(aberto.eventos!.find((e) => e.type === "chat")!.chat!.title).toBe("Ganchos: CAMERA - AD03 susto");

    const { textos, chat } = await textosDaMensagem(aberto.chatId!);
    const ficha = textos.find((t) => t.startsWith("<arquivo"))!;
    for (const trecho of ["# CAMERA - AD03 susto", "**Produto:** Câmera Wi-Fi", "**Países:** CL, MX", "**Vendas:** 87", "| campanha | conta | pais | gasto | vendas |", "| CL / CAMERA / ABO | Conta 1 | CL | 800 | 60 |"]) {
      expect(ficha).toContain(trecho);
    }
    // O agente recebe o vídeo como geração do hub (para assistir), e o vídeo segue para o Drive.
    const idDoVideo = chat.attachments![0][0].generationId!;
    expect(textos.at(-1)).toContain(`vídeo "CAMERA - AD03 susto.mp4" → generation_id ${idDoVideo}`);
    const video = await naPadrao(() => getGeneration(idDoVideo));
    expect(video).toMatchObject({ kind: "video", tool: "upload", status: "done" });
    expect(video!.params.prazoNoHub).toBeTruthy();
    expect(guardarNoDriveEmSegundoPlano).toHaveBeenCalledWith(expect.objectContaining({ id: idDoVideo }));
    // Com o vídeo, a capa nem é baixada.
    expect(cdn.pedidos).toEqual([VIDEO_URL]);

    const [linha] = await banco().select().from(skalaEntregas);
    expect(linha).toMatchObject({ chatId: aberto.chatId, usadoPor: sessao.logado });
    expect((await situacaoDaEntrega(token)).estado).toBe("usada");
    const deNovo = await abrirNoChat(token);
    expect(deNovo).toMatchObject({ status: 400, erro: "Este link do Skala já foi usado ou venceu. Volte ao Skala e clique de novo em Gerar ganchos." });
    expect(runChatTurn).toHaveBeenCalledTimes(1);
  });

  it("vídeo que não dá para trazer não trava: entra a capa e o aviso aparece na bolha", async () => {
    cdn.rotas[VIDEO_URL] = () => new Response("expirou", { status: 403 });
    const aberto = await abrirNoChat((await novoLink()).token);
    const usuario = aberto.eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toContain('Aviso: não deu para trazer o vídeo de "CAMERA - AD03 susto": o link do arquivo no CDN venceu ou não existe mais.');
    expect(usuario.attachments.map((a) => a.kind)).toEqual(["image", "text"]);
    expect(cdn.pedidos).toEqual([VIDEO_URL, CAPA_URL]);
    expect(runChatTurn).toHaveBeenCalledTimes(1);
  });

  it("download confere o redirecionamento, o tipo pelos bytes e o tamanho", async () => {
    // Redireciona para fora dos CDNs: não segue.
    cdn.rotas[VIDEO_URL] = () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    let usuario = (await abrirNoChat((await novoLink()).token)).eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toContain("o arquivo veio de um endereço que o hub não aceita (169.254.169.254)");
    expect(cdn.pedidos).not.toContain("http://169.254.169.254/latest/meta-data");

    // Diz que é vídeo, mas é uma página.
    cdn.rotas[VIDEO_URL] = binario(Buffer.from("<html>login</html>"), "video/mp4");
    usuario = (await abrirNoChat((await novoLink()).token)).eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toContain("o arquivo baixado não é um vídeo");

    // Grande demais pelo cabeçalho.
    cdn.rotas[VIDEO_URL] = () => new Response("x", { headers: { "content-length": String(400 * 1024 * 1024) } });
    usuario = (await abrirNoChat((await novoLink()).token)).eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toContain("o arquivo passa de 300 MB");

    // Redirecionamento dentro dos CDNs é seguido (o http vira https).
    const OUTRO = "https://v16m-default.akamaized.net/tos/video.mp4";
    cdn.rotas[VIDEO_URL] = () => new Response(null, { status: 302, headers: { location: "http://v16m-default.akamaized.net/tos/video.mp4" } });
    cdn.rotas[OUTRO] = binario(MP4);
    usuario = (await abrirNoChat((await novoLink()).token)).eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.attachments.map((a) => a.kind)).toEqual(["video", "text"]);

    // Nenhum arquivo parcial fica para trás na pasta de mídia.
    const midia = await readdir(path.join(DATA_DIR, "media")).catch(() => [] as string[]);
    expect(midia.filter((n) => n.endsWith(".skala-parcial"))).toEqual([]);
  });

  it("sem Google Drive o vídeo não entra (regra do dono) e a conversa segue com a capa", async () => {
    vi.mocked(driveConectado).mockResolvedValue(false);
    const usuario = (await abrirNoChat((await novoLink()).token)).eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toContain("o Google Drive não está conectado");
    expect(usuario.attachments.map((a) => a.kind)).toEqual(["image", "text"]);
    expect(cdn.pedidos).toEqual([CAPA_URL]);
  });

  it("link vencido, de outra organização ou sem a chave do chat não começa nada", async () => {
    const { token } = await novoLink();
    await banco().update(skalaEntregas).set({ expiraEm: new Date(Date.now() - 1000) });
    expect((await situacaoDaEntrega(token)).estado).toBe("invalida");
    expect(await abrirNoChat(token)).toMatchObject({ status: 400 });

    // Sessão aberta em outra organização: a reserva só vale na organização da entrega.
    const outro = await novoLink();
    const outra = await criarOrganizacao();
    const pessoa = await criarConta({ email: `beto-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves: ["chat"], senha: null, organizacaoId: outra });
    sessao.logado = pessoa.id;
    sessao.organizacao = outra;
    try {
      expect(await abrirNoChat(outro.token)).toMatchObject({ status: 400 });
    } finally {
      sessao.organizacao = ORGANIZACAO_PADRAO.id;
    }
    expect((await situacaoDaEntrega(outro.token)).estado).toBe("pendente");

    // Conta sem a chave do chat.
    const semChat = await criarConta({ email: `caio-${crypto.randomUUID().slice(0, 6)}@exemplo.com`, chaves: ["biblioteca"], senha: null });
    sessao.logado = semChat.id;
    expect(await abrirNoChat(outro.token)).toMatchObject({ status: 403 });
    expect((await situacaoDaEntrega(outro.token)).estado).toBe("pendente");
    expect(runChatTurn).not.toHaveBeenCalled();
  });

  it("vários criativos de uma vez, e estático com imagem", async () => {
    const IMAGEM = "https://scontent.xx.fbcdn.net/v/anuncio.jpg";
    cdn.rotas[IMAGEM] = binario(JPEG, "image/jpeg");
    const { token } = await novoLink({
      criativos: [criativo(), { id: "999", nome: "Estático 01", imagem_url: IMAGEM, texto: "Só hoje: frete grátis", titulo: "Câmera que avisa no celular" }],
    });
    const aberto = await abrirNoChat(token);
    const usuario = aberto.eventos!.find((e) => e.type === "user")!.item!;
    expect(usuario.text).toBe('Me dê ganchos baseados nestes criativos.\n\nCriativos do Skala: "CAMERA - AD03 susto", "Estático 01".');
    expect(usuario.attachments.map((a) => a.kind)).toEqual(["video", "text", "image", "text"]);
    const { textos } = await textosDaMensagem(aberto.chatId!);
    expect(textos.find((t) => t.includes("# Estático 01"))).toContain("## Texto do anúncio\n\nSó hoje: frete grátis");
  });
});
