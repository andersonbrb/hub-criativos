import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as tentarDeNovoRota, DELETE as cancelarRota } from "@/app/api/youtube/envios/[id]/route";
import { GET as listarRota, POST as enviarRota } from "@/app/api/youtube/envios/route";
import { GET as estadoRota } from "@/app/api/youtube/estado/route";
import { banco } from "@/db/cliente";
import { youtubeEnvios } from "@/db/schema";
import { bancoDeTeste } from "@/db/teste";
import { ORGANIZACAO_PADRAO, type Chave, type Papel } from "@/features/acesso/contrato";
import { comOrganizacao } from "@/features/acesso/servicos/organizacao-atual";
import { criarConta, criarOrganizacao, garantirOrganizacaoPadrao } from "@/features/acesso/testes/ajuda";
import { sessao } from "@/features/conector/testes/sessao-falsa";
import { cifrar } from "@/features/integracoes/servicos/cifra";
import type { EnvioYoutube } from "@/features/youtube/contrato";
import { esperarEnvios, rodarFila, zerarFilaDoYoutube } from "@/features/youtube/servicos/envios";
import { MULTIPLO_DO_PEDACO, subirVideo } from "@/features/youtube/servicos/subir";
import { canalConectadoNoBanco, googleFalso, json, ORIGEM, prepararAmbiente, servidorDeEnvio } from "@/features/youtube/testes/apoio";
import type { Generation } from "@/lib/generations";
import { usarRaizDosDados } from "@/lib/server/pastas";

// Envios de vídeos prontos para o YouTube, pelas rotas de verdade, com um YouTube de mentira (nada sai do teste).
usarRaizDosDados(mkdtempSync(path.join(os.tmpdir(), "hub-youtube-")));

vi.mock("@/features/acesso/servicos/sessao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/acesso/servicos/sessao")>();
  const { exigirFalso } = await import("@/features/conector/testes/sessao-falsa");
  const exigir = exigirFalso(real.buscarUsuario);
  return { ...real, exigirUsuario: exigir, exigirPagina: exigir };
});

// Gerações de cada organização (o store de verdade lê o db.json da pasta dela).
const geracoes = vi.hoisted(() => new Map<string, Generation>());
vi.mock("@/lib/server/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/store")>();
  const { organizacaoAtual } = await import("@/features/acesso/servicos/organizacao-atual");
  return { ...real, getGeneration: async (id: string) => geracoes.get(`${await organizacaoAtual()}/${id}`) };
});

// O vídeo "no disco" (no hub de verdade, uma cópia vinda do Drive).
const VIDEO = path.join(mkdtempSync(path.join(os.tmpdir(), "hub-youtube-video-")), "video.mp4");
writeFileSync(VIDEO, Buffer.alloc(3 * MULTIPLO_DO_PEDACO + 1234, 9));
vi.mock("@/features/drive/servicos/videos", () => ({ arquivoLocal: async () => VIDEO }));

const pedir = (caminho: string, init?: RequestInit) => new Request(`${ORIGEM}${caminho}`, init);
const comId = (id: string) => ({ params: Promise.resolve({ id }) });
let contador = 0;

async function entrarComo(chaves: Chave[], organizacaoId: string = ORGANIZACAO_PADRAO.id, papel: Papel = "membro") {
  const pessoa = await criarConta({ email: `pessoa-${++contador}@exemplo.com`, chaves, organizacaoId, papel });
  sessao.logado = pessoa.id;
  sessao.organizacao = organizacaoId;
}

function videoPronto(organizacaoId: string, id = "gen-1") {
  geracoes.set(`${organizacaoId}/${id}`, { id, tool: "montagem", kind: "video", status: "done", prompt: "Vídeo", params: {}, file: `${id}.mp4`, createdAt: new Date().toISOString() } as Generation);
}

function formulario(campos: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ geracaoId: "gen-1", titulo: "Meu vídeo", visibilidade: "public", ...campos })) f.set(k, v);
  return f;
}

async function enviar(campos: Record<string, string | File> = {}) {
  const res = await enviarRota(pedir("/api/youtube/envios", { method: "POST", body: formulario(campos) }));
  return { status: res.status, dados: (await res.json()) as { envio?: EnvioYoutube; error?: string } };
}

async function listar(geracao?: string): Promise<EnvioYoutube[]> {
  const res = await listarRota(pedir(`/api/youtube/envios${geracao ? `?geracao=${geracao}` : ""}`));
  return ((await res.json()) as { envios: EnvioYoutube[] }).envios;
}

const linha = async (id: string) => (await banco().select().from(youtubeEnvios).where(eq(youtubeEnvios.id, id)))[0];

beforeEach(async () => {
  await zerarFilaDoYoutube();
  prepararAmbiente();
  await bancoDeTeste();
  await garantirOrganizacaoPadrao();
  geracoes.clear();
  sessao.logado = null;
  sessao.organizacao = ORGANIZACAO_PADRAO.id;
});
afterEach(async () => {
  await esperarEnvios();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("youtube: enviar vídeos prontos", () => {
  it("Enviar agora sobe o vídeo em pedaços e mostra o link", async () => {
    const servidor = servidorDeEnvio();
    const chamadas = googleFalso({ "abrir-envio": servidor["abrir-envio"], pedaco: servidor.pedaco, videos: () => json({ items: [] }) });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");

    const { status, dados } = await enviar({ titulo: "Gancho do café", descricao: "Teste", visibilidade: "unlisted" });
    expect(status).toBe(200);
    expect(dados.envio).toMatchObject({ situacao: "enviando", titulo: "Gancho do café", canal: "Canal da Empresa" });
    await esperarEnvios();

    const [envio] = await listar("gen-1");
    expect(envio).toMatchObject({ situacao: "enviado", link: "https://www.youtube.com/watch?v=video-1", erro: null, aviso: null });
    const abrir = chamadas.find((c) => c.tipo === "abrir-envio")!;
    expect(abrir.autorizacao).toBe("Bearer acesso-guardado");
    expect(abrir.cabecalhos.get("x-upload-content-length")).toBe(String(3 * MULTIPLO_DO_PEDACO + 1234));
    expect(abrir.corpo).toMatchObject({
      snippet: { title: "Gancho do café", description: "Teste", categoryId: "22" },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    expect(chamadas.filter((c) => c.tipo === "pedaco").every((c) => c.autorizacao === "Bearer acesso-guardado")).toBe(true);
  });

  it("Shorts põe #Shorts na descrição e 'para crianças' vai na declaração do YouTube", async () => {
    const servidor = servidorDeEnvio();
    const chamadas = googleFalso({ "abrir-envio": servidor["abrir-envio"], pedaco: servidor.pedaco });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    await enviar({ descricao: "Oferta", shorts: "true", paraCriancas: "true" });
    await esperarEnvios();
    expect(chamadas.find((c) => c.tipo === "abrir-envio")!.corpo).toMatchObject({
      snippet: { description: "Oferta\n\n#Shorts" },
      status: { selfDeclaredMadeForKids: true },
    });
  });

  it("agendado não vai ao YouTube antes da hora, sai depois dela, e dá para cancelar", async () => {
    const servidor = servidorDeEnvio();
    const chamadas = googleFalso({ "abrir-envio": servidor["abrir-envio"], pedaco: servidor.pedaco, videos: () => json({ items: [] }) });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");

    const quando = new Date(Date.now() + 10 * 60_000).toISOString();
    const a = (await enviar({ agendadoPara: quando })).dados.envio!;
    const b = (await enviar({ agendadoPara: quando, titulo: "Outro" })).dados.envio!;
    expect(a).toMatchObject({ situacao: "agendado", agendadoPara: quando });
    await rodarFila();
    await esperarEnvios();
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(0);

    // Cancelar o B; o A chega na hora.
    const cancelado = await cancelarRota(pedir(`/api/youtube/envios/${b.id}`, { method: "DELETE" }), comId(b.id));
    expect(((await cancelado.json()) as { envio: EnvioYoutube }).envio.situacao).toBe("cancelado");
    await banco().update(youtubeEnvios).set({ agendadoPara: new Date(Date.now() - 1000) }).where(eq(youtubeEnvios.organizacaoId, ORGANIZACAO_PADRAO.id));
    await rodarFila();
    await esperarEnvios();
    expect((await linha(a.id)).situacao).toBe("enviado");
    expect((await linha(b.id)).situacao).toBe("cancelado");
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(1);

    // Enviado não se cancela pelo hub.
    const tarde = await cancelarRota(pedir(`/api/youtube/envios/${a.id}`, { method: "DELETE" }), comId(a.id));
    expect(tarde.status).toBe(400);
    expect(((await tarde.json()) as { error: string }).error).toMatch(/YouTube Studio/);
  });

  it("uma organização não vê, não envia e não mexe nos envios da outra", async () => {
    const servidor = servidorDeEnvio();
    googleFalso({ "abrir-envio": servidor["abrir-envio"], pedaco: servidor.pedaco, videos: () => json({ items: [] }) });
    const outra = await criarOrganizacao("Outra Empresa");
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id, { canalId: "UC-a" });
    await canalConectadoNoBanco(outra, { canalId: "UC-b", titulo: "Canal B" });
    videoPronto(ORGANIZACAO_PADRAO.id, "gen-a");
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    const envioA = (await enviar({ geracaoId: "gen-a", agendadoPara: new Date(Date.now() + 3600_000).toISOString() })).dados.envio!;

    await entrarComo([], outra, "dono");
    expect(await listar()).toEqual([]);
    expect(await listar("gen-a")).toEqual([]);
    // Pelo id direto: "não encontrado", sem dizer que existe.
    const cancelar = await cancelarRota(pedir(`/api/youtube/envios/${envioA.id}`, { method: "DELETE" }), comId(envioA.id));
    expect(cancelar.status).toBe(400);
    expect(((await cancelar.json()) as { error: string }).error).toBe("Envio não encontrado.");
    const repetir = await tentarDeNovoRota(pedir(`/api/youtube/envios/${envioA.id}`, { method: "POST" }), comId(envioA.id));
    expect(repetir.status).toBe(400);
    // O vídeo da A não existe para a B.
    const { status, dados } = await enviar({ geracaoId: "gen-a" });
    expect(status).toBe(400);
    expect(dados.error).toMatch(/Vídeo não encontrado/);
    expect((await linha(envioA.id)).situacao).toBe("agendado");
  });

  it("sem a chave YouTube: o botão não aparece e as rotas recusam", async () => {
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    await entrarComo(["biblioteca", "integracoes"]);
    expect(await (await estadoRota(pedir("/api/youtube/estado"))).json()).toEqual({ podeEnviar: false, conectado: false, canal: null });
    expect((await listarRota(pedir("/api/youtube/envios"))).status).toBe(403);
    expect((await enviarRota(pedir("/api/youtube/envios", { method: "POST", body: formulario({}) }))).status).toBe(403);

    await entrarComo(["youtube"]);
    expect(await (await estadoRota(pedir("/api/youtube/estado"))).json()).toMatchObject({ podeEnviar: true, conectado: true, canal: { titulo: "Canal da Empresa" } });
  });

  it("confere o pedido antes de gravar", async () => {
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    videoPronto(ORGANIZACAO_PADRAO.id);
    expect((await enviar()).dados.error).toMatch(/YouTube não está conectado/);
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    expect((await enviar({ titulo: "  " })).dados.error).toBe("Escreva o título do vídeo.");
    expect((await enviar({ titulo: "x".repeat(101) })).dados.error).toMatch(/até 100/);
    expect((await enviar({ titulo: "a <b>" })).dados.error).toMatch(/< e >/);
    expect((await enviar({ visibilidade: "todo-mundo" })).dados.error).toMatch(/visibilidade/);
    expect((await enviar({ agendadoPara: new Date(Date.now() - 60_000).toISOString() })).dados.error).toMatch(/2 minutos/);
    expect((await enviar({ miniatura: new File(["x"], "a.gif", { type: "image/gif" }) })).dados.error).toMatch(/JPG ou PNG/);
    geracoes.set(`${ORGANIZACAO_PADRAO.id}/gen-2`, { id: "gen-2", tool: "flora", kind: "video", status: "running", prompt: "", params: {}, createdAt: "" } as Generation);
    expect((await enviar({ geracaoId: "gen-2" })).dados.error).toMatch(/vídeo pronto/);
    expect(await banco().select().from(youtubeEnvios)).toHaveLength(0);
  });

  it("falha com o motivo em linguagem simples, e Tentar de novo envia", async () => {
    const servidor = servidorDeEnvio();
    let cotaAcabou = true;
    googleFalso({
      "abrir-envio": (c) =>
        cotaAcabou ? json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403) : servidor["abrir-envio"](c),
      pedaco: servidor.pedaco,
      videos: () => json({ items: [] }),
    });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    const envio = (await enviar()).dados.envio!;
    await esperarEnvios();
    expect(await linha(envio.id)).toMatchObject({ situacao: "falhou" });
    expect((await linha(envio.id)).erro).toMatch(/cota diária/);

    cotaAcabou = false;
    const res = await tentarDeNovoRota(pedir(`/api/youtube/envios/${envio.id}`, { method: "POST" }), comId(envio.id));
    expect(res.status).toBe(200);
    await esperarEnvios();
    expect(await linha(envio.id)).toMatchObject({ situacao: "enviado", erro: null, videoId: "video-1" });
  });

  it("cliente do Google recusado falha na hora (sem ficar tentando) e diz o que conferir", async () => {
    const chamadas = googleFalso({
      "abrir-envio": () => json({ error: { code: 401, errors: [{ reason: "authError" }] } }, 401),
      token: () => json({ error: "invalid_client", error_description: "The OAuth client was not found." }, 401),
    });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    const inicio = Date.now();
    const envio = (await enviar()).dados.envio!;
    await esperarEnvios();
    expect(Date.now() - inicio).toBeLessThan(1500);
    expect(await linha(envio.id)).toMatchObject({ situacao: "falhou" });
    expect((await linha(envio.id)).erro).toMatch(/recusou o cliente do Google/);
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(1);
  });

  it("avisa quando o YouTube deixa o vídeo privado e quando a miniatura não pode ser aplicada", async () => {
    const servidor = servidorDeEnvio({ privacidade: "private" });
    const chamadas = googleFalso({
      "abrir-envio": servidor["abrir-envio"],
      pedaco: servidor.pedaco,
      miniatura: () => json({ error: { code: 403, errors: [{ reason: "forbidden" }] } }, 403),
      videos: () => json({ items: [] }),
    });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    const envio = (await enviar({ miniatura: new File([new Uint8Array([1, 2, 3])], "capa.png", { type: "image/png" }) })).dados.envio!;
    expect(envio.temMiniatura).toBe(true);
    await esperarEnvios();

    const depois = await linha(envio.id);
    expect(depois.situacao).toBe("enviado");
    expect(depois.aviso).toMatch(/deixou o vídeo como privado/);
    expect(depois.aviso).toMatch(/verificado por telefone/);
    const miniatura = chamadas.find((c) => c.tipo === "miniatura")!;
    expect(miniatura.url).toContain("videoId=video-1");
    expect(miniatura.cabecalhos.get("content-type")).toBe("image/png");
    // A imagem não fica guardada depois de usada.
    expect(depois.miniatura).toBeNull();
  });

  it("continua da sessão guardada depois de um reinício, sem subir de novo", async () => {
    const servidor = servidorDeEnvio();
    const chamadas = googleFalso({ "abrir-envio": servidor["abrir-envio"], pedaco: servidor.pedaco });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    // Sessão aberta antes do reinício, com 2 pedaços já recebidos pelo YouTube.
    const total = 3 * MULTIPLO_DO_PEDACO + 1234;
    servidor.sessoes.set("https://upload.falso/sessao/antiga", { total, recebidos: 2 * MULTIPLO_DO_PEDACO, metadados: { status: { privacyStatus: "public" } } });
    const progresso: number[] = [];
    const video = await comOrganizacao(ORGANIZACAO_PADRAO.id, () =>
      subirVideo(
        VIDEO,
        total,
        { titulo: "t", descricao: "", visibilidade: "public", paraCriancas: false },
        { sessao: "https://upload.falso/sessao/antiga", aoAbrirSessao: async () => undefined, aoAvancar: async (p) => void progresso.push(p), tamanhoDoPedaco: MULTIPLO_DO_PEDACO },
      ),
    );
    expect(video.id).toBe("video-1");
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(0);
    const pedacos = chamadas.filter((c) => c.tipo === "pedaco");
    expect(pedacos[0].cabecalhos.get("content-range")).toBe(`bytes */${total}`);
    expect(pedacos[1].cabecalhos.get("content-range")).toBe(`bytes ${2 * MULTIPLO_DO_PEDACO}-${3 * MULTIPLO_DO_PEDACO - 1}/${total}`);
    expect(progresso.at(-1)).toBe(100);

    // Pela fila: um "enviando" largado com a sessão guardada continua dela.
    videoPronto(ORGANIZACAO_PADRAO.id);
    servidor.sessoes.set("https://upload.falso/sessao/largada", { total, recebidos: MULTIPLO_DO_PEDACO, metadados: {} });
    const [largado] = await banco()
      .insert(youtubeEnvios)
      .values({
        organizacaoId: ORGANIZACAO_PADRAO.id,
        geracaoId: "gen-1",
        arquivo: "gen-1.mp4",
        canalId: "UC-canal-1",
        canalTitulo: "Canal da Empresa",
        titulo: "Largado",
        visibilidade: "public",
        situacao: "enviando",
        progresso: 25,
        sessaoCifrada: cifrar("https://upload.falso/sessao/largada"),
      })
      .returning();
    await rodarFila();
    await esperarEnvios();
    expect(await linha(largado.id)).toMatchObject({ situacao: "enviado", sessaoCifrada: null });
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(0);
  });

  it("canal trocado depois do agendamento: o envio não vai para o canal novo", async () => {
    const chamadas = googleFalso({});
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id, { canalId: "UC-novo" });
    videoPronto(ORGANIZACAO_PADRAO.id);
    const [envio] = await banco()
      .insert(youtubeEnvios)
      .values({
        organizacaoId: ORGANIZACAO_PADRAO.id,
        geracaoId: "gen-1",
        arquivo: "gen-1.mp4",
        canalId: "UC-antigo",
        canalTitulo: "Canal Antigo",
        titulo: "x",
        visibilidade: "public",
        situacao: "agendado",
        agendadoPara: new Date(Date.now() - 1000),
      })
      .returning();
    await rodarFila();
    await esperarEnvios();
    expect(await linha(envio.id)).toMatchObject({ situacao: "falhou" });
    expect((await linha(envio.id)).erro).toMatch(/canal do YouTube desta organização mudou/);
    expect(chamadas.filter((c) => c.tipo === "abrir-envio")).toHaveLength(0);
  });

  it("depois do envio, o que o YouTube recusou (vídeo repetido) aparece como falha com o motivo", async () => {
    googleFalso({ videos: () => json({ items: [{ id: "video-9", status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }] }) });
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    const [envio] = await banco()
      .insert(youtubeEnvios)
      .values({
        organizacaoId: ORGANIZACAO_PADRAO.id,
        geracaoId: "gen-1",
        arquivo: "gen-1.mp4",
        canalId: "UC-canal-1",
        canalTitulo: "Canal da Empresa",
        titulo: "x",
        visibilidade: "public",
        situacao: "enviado",
        videoId: "video-9",
        enviadoEm: new Date(),
      })
      .returning();
    await entrarComo(["youtube"]);
    await listar();
    await vi.waitFor(async () => expect((await linha(envio.id)).situacao).toBe("falhou"));
    expect((await linha(envio.id)).erro).toMatch(/já existe no canal/);
  });

  it("a miniatura de um envio cancelado é apagada", async () => {
    await canalConectadoNoBanco(ORGANIZACAO_PADRAO.id);
    videoPronto(ORGANIZACAO_PADRAO.id);
    await entrarComo([], ORGANIZACAO_PADRAO.id, "dono");
    const envio = (
      await enviar({ agendadoPara: new Date(Date.now() + 3600_000).toISOString(), miniatura: new File([new Uint8Array([1])], "c.jpg", { type: "image/jpeg" }) })
    ).dados.envio!;
    const nome = (await linha(envio.id)).miniatura!;
    const caminho = path.join(await comOrganizacao(ORGANIZACAO_PADRAO.id, async () => (await import("@/lib/server/pastas")).pastaDeDados()), "youtube", "miniaturas", nome);
    expect(existsSync(caminho)).toBe(true);
    await cancelarRota(pedir(`/api/youtube/envios/${envio.id}`, { method: "DELETE" }), comId(envio.id));
    expect(existsSync(caminho)).toBe(false);
  });
});
