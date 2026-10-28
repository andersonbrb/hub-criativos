import { mkdtempSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entrada, MARCA_DA_SAIDA, VARIAVEL_DA_CHAVE, VARIAVEL_DO_ENDERECO, type Trabalho } from "@/features/edicoes/contrato";
import type { executarTrabalho } from "@/features/edicoes/servicos/executar";

// O servidor de edições (features/edicoes): o site manda os arquivos e o trabalho, acompanha o registro e baixa o vídeo
// pronto; se um dos dois reinicia no meio, a edição não se perde. Nada roda de verdade aqui: quem "edita" é uma função
// de teste que junta os arquivos de entrada (o Python, o ffmpeg e o Remotion ficam para o teste de ponta a ponta).

const DADOS = mkdtempSync(path.join(os.tmpdir(), "hub-edicoes-"));
const CHAVE = "chave-de-teste-do-servidor-de-edicoes-0123456789";
const urlOriginal = process.env.DATABASE_URL;

vi.mock("@/lib/server/pastas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/pastas")>();
  return { ...real, DATA_DIR: DADOS };
});
vi.mock("@/features/drive/servicos/videos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/drive/servicos/videos")>();
  const store = await import("@/lib/server/store");
  return {
    ...real,
    exigirDriveParaVideo: vi.fn(async () => undefined),
    arquivoLocal: vi.fn(async (file: string) => path.join(DADOS, "media", file)),
    // Pronta: a geração vira "done" (o envio ao Drive é de outro teste).
    concluirComArquivo: vi.fn(async (id: string, patch: { file: string }) => store.updateGeneration(id, { ...patch, status: "done" })),
  };
});
vi.mock("@/lib/server/video", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/video")>();
  return { ...real, palavrasDaFala: vi.fn(async () => [{ text: "hola", start: 0.1, end: 0.4 }]) };
});
// Sem o servidor de edições, a edição roda no site: aqui, a mesma função de teste.
vi.mock("@/features/edicoes/servicos/executar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/edicoes/servicos/executar")>();
  return { ...real, executarTrabalho: vi.fn(async (...args: Parameters<typeof executarTrabalho>) => editarDeMentira(...args, "site")) };
});

const { criarServidorDeEdicoes } = await import("@/features/edicoes/servicos/servidor");
const { ajustesDoServidor, FalhaNoServidorDeEdicoes, rodarNoServidor, ServidorForaDoAr } = await import("@/features/edicoes/servicos/remoto");
const { iniciarEdicao, retomarEdicoes, logPath } = await import("@/features/edicoes/servicos/rodar");
const { executarTrabalho: executarNoSite, resolverMarcadores } = await import("@/features/edicoes/servicos/executar");
const { usarRaizDosDados } = await import("@/lib/server/pastas");
const store = await import("@/lib/server/store");

// "Edita": junta o conteúdo das entradas na saída e anota no registro. `onde` diz quem rodou.
async function editarDeMentira(t: Trabalho, c: Parameters<typeof executarTrabalho>[1], log: Parameters<typeof executarTrabalho>[2], onde: string) {
  const d = resolverMarcadores(t.dados, c) as { falhar?: string; esperarMs?: number; job?: { avatar_words?: unknown } };
  log.linha(`editando no ${onde}`);
  if (d.esperarMs) await new Promise((r) => setTimeout(r, d.esperarMs));
  if (d.falhar) throw new Error(d.falhar);
  const partes = await Promise.all(t.entradas.map((nome) => readFile(c.entrada(nome), "utf8")));
  await mkdir(path.dirname(c.saida), { recursive: true });
  await writeFile(c.saida, `${onde}:${partes.join("+")}${d.job?.avatar_words ? ":com-palavras" : ""}`);
  log.bruto("DONE\n");
  return t.tipo === "transcricao" ? { resultado: `{"language":"es","onde":"${onde}"}` } : {};
}

type Servidor = { porta: number; fechar: () => Promise<void>; vezes: () => number; pasta: string };

async function subirServidor(porta = 0): Promise<Servidor> {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "hub-servidor-de-edicoes-"));
  let vezes = 0;
  const { servidor } = criarServidorDeEdicoes({
    chave: CHAVE,
    pasta,
    executar: async (...args) => {
      vezes++;
      return editarDeMentira(...args, "servidor");
    },
  });
  await new Promise<void>((resolve) => servidor.listen(porta, "127.0.0.1", resolve));
  const real = (servidor.address() as AddressInfo).port;
  return {
    porta: real,
    pasta,
    vezes: () => vezes,
    fechar: () => new Promise((resolve) => (servidor.closeAllConnections(), servidor.close(() => resolve()))),
  };
}

const apontarPara = (porta: number | null, chave = CHAVE) => {
  if (porta === null) delete process.env[VARIAVEL_DO_ENDERECO];
  else process.env[VARIAVEL_DO_ENDERECO] = `http://127.0.0.1:${porta}`;
  process.env[VARIAVEL_DA_CHAVE] = chave;
};

async function arquivoDeEntrada(nome: string, conteudo: string) {
  await mkdir(path.join(DADOS, "media"), { recursive: true });
  await writeFile(path.join(DADOS, "media", nome), conteudo);
  return path.join(DADOS, "media", nome);
}

const existe = (caminho: string) => access(caminho).then(() => true, () => false);

async function esperarGeracao(id: string, ms = 10_000) {
  const ate = Date.now() + ms;
  for (;;) {
    const g = await store.getGeneration(id);
    if (g && g.status !== "running") return g;
    if (Date.now() > ate) throw new Error(`a geração ${id} não terminou`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

const trabalhoSimples = (extra: Record<string, unknown> = {}): Trabalho => ({
  tipo: "batida",
  dados: { job: { clips: [entrada("a.mp4"), entrada("b.mp4")], out: MARCA_DA_SAIDA }, ...extra },
  entradas: ["a.mp4", "b.mp4"],
});

describe("servidor de edições", () => {
  let servidor: Servidor;
  let locais: Record<string, string>;

  beforeEach(async () => {
    delete process.env.DATABASE_URL; // PC sem banco: organização padrão, gerações em arquivo (pasta temporária)
    usarRaizDosDados(DADOS);
    ajustesDoServidor.entreConsultasMs = 20;
    ajustesDoServidor.paraAcordarMs = 400;
    ajustesDoServidor.foraDoArMs = 400;
    vi.mocked(executarNoSite).mockClear();
    servidor = await subirServidor();
    apontarPara(servidor.porta);
    locais = { "a.mp4": await arquivoDeEntrada("a.mp4", "AAA"), "b.mp4": await arquivoDeEntrada("b.mp4", "BBB") };
  });
  afterEach(async () => {
    await servidor.fechar();
    apontarPara(null);
  });
  afterAll(() => {
    usarRaizDosDados(undefined);
    if (urlOriginal !== undefined) process.env.DATABASE_URL = urlOriginal;
  });

  it("recebe as entradas, roda, mostra o registro e devolve o vídeo; depois apaga a pasta do trabalho", async () => {
    const saida = path.join(DADOS, "saida-1.mp4");
    let registro = "";
    await rodarNoServidor("t1", trabalhoSimples(), locais, { saida, registro: (t) => (registro = t) });
    expect(await readFile(saida, "utf8")).toBe("servidor:AAA+BBB");
    expect(registro).toContain("editando no servidor");
    expect(await readdir(servidor.pasta)).toEqual([]);
    expect(servidor.vezes()).toBe(1);
  });

  it("pede a chave: sem ela, nada roda", async () => {
    const res = await fetch(`http://127.0.0.1:${servidor.porta}/trabalhos/t2?desde=0`);
    expect(res.status).toBe(401);
    const saude = await fetch(`http://127.0.0.1:${servidor.porta}/api/saude`);
    expect(saude.status).toBe(200);
    apontarPara(servidor.porta, "outra-chave-qualquer-com-mais-de-trinta-e-dois");
    await expect(rodarNoServidor("t2", trabalhoSimples(), locais, { saida: path.join(DADOS, "saida-2.mp4") })).rejects.toThrow(/HTTP 401/);
    expect(servidor.vezes()).toBe(0);
  });

  it("a falha da edição volta com a frase do erro", async () => {
    const erro = await rodarNoServidor("t3", trabalhoSimples({ falhar: "a legenda não saiu (teste)" }), locais, { saida: path.join(DADOS, "saida-3.mp4") }).catch((e) => e);
    expect(erro).toBeInstanceOf(FalhaNoServidorDeEdicoes);
    expect(erro.message).toBe("a legenda não saiu (teste)");
  });

  it("o site reiniciou no meio: volta a acompanhar o mesmo trabalho, sem rodar de novo", async () => {
    const trabalho = trabalhoSimples({ esperarMs: 300 });
    const primeira = rodarNoServidor("t4", trabalho, locais, { saida: path.join(DADOS, "saida-4a.mp4") }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    // O "site novo" chega enquanto o trabalho roda e acompanha até o fim.
    await rodarNoServidor("t4", trabalho, locais, { saida: path.join(DADOS, "saida-4b.mp4") });
    await primeira;
    expect(await readFile(path.join(DADOS, "saida-4b.mp4"), "utf8")).toBe("servidor:AAA+BBB");
    expect(servidor.vezes()).toBe(1);
  });

  it("o servidor de edições reiniciou no meio: o site manda de novo e a edição sai", async () => {
    const trabalho = trabalhoSimples({ esperarMs: 300 });
    let reenvios = 0;
    ajustesDoServidor.foraDoArMs = 3000;
    const fim = rodarNoServidor("t5", trabalho, locais, { saida: path.join(DADOS, "saida-5.mp4"), aoReenviar: () => reenvios++ });
    await new Promise((r) => setTimeout(r, 100));
    // Publicação nova: o servidor velho sai (o trabalho morre junto) e um novo sobe na mesma porta.
    const porta = servidor.porta;
    await servidor.fechar();
    servidor = await subirServidor(porta);
    await fim;
    expect(await readFile(path.join(DADOS, "saida-5.mp4"), "utf8")).toBe("servidor:AAA+BBB");
    expect(reenvios).toBe(1);
  });

  it("fora do ar: avisa logo (quem chamou roda no site)", async () => {
    await servidor.fechar();
    const erro = await rodarNoServidor("t6", trabalhoSimples(), locais, { saida: path.join(DADOS, "saida-6.mp4") }).catch((e) => e);
    expect(erro).toBeInstanceOf(ServidorForaDoAr);
    servidor = await subirServidor();
  });

  it("transcrição: devolve a saída do Whisper", async () => {
    const { transcreverNoServidor } = await import("@/features/edicoes/servicos/remoto");
    const audio = await arquivoDeEntrada("audio.mp3", "som");
    expect(JSON.parse(await transcreverNoServidor(audio))).toEqual({ language: "es", onde: "servidor" });
  });

  describe("no site (rodar.ts)", () => {
    const novaGeracao = () =>
      store.createGeneration({ tool: "montagem", kind: "video", status: "running", prompt: "edição", params: {} } as never);

    it("manda para o servidor de edições, traz o vídeo para a mídia e conclui a geração", async () => {
      const g = await novaGeracao();
      await iniciarEdicao({
        id: g.id,
        rotulo: "Montagem",
        outName: "pronto-1.mp4",
        trabalho: { tipo: "montagem", dados: { job: { out: MARCA_DA_SAIDA } } },
        arquivos: { "a.mp4": "a.mp4", "b.mp4": "b.mp4" },
        palavrasDe: ["avatar"],
      });
      const pronta = await esperarGeracao(g.id);
      expect(pronta.status).toBe("done");
      expect(pronta.file).toBe("pronto-1.mp4");
      // As palavras da fala foram junto no trabalho.
      expect(await readFile(path.join(DADOS, "media", "pronto-1.mp4"), "utf8")).toBe("servidor:AAA+BBB:com-palavras");
      expect(await readFile(logPath(g.id), "utf8")).toContain("editando no servidor");
      expect(await existe(path.join(DADOS, "edicoes", `${g.id}.json`))).toBe(false);
      expect(executarNoSite).not.toHaveBeenCalled();
    });

    it("servidor de edições fora do ar: a edição roda no site e sai do mesmo jeito", async () => {
      await servidor.fechar();
      const g = await novaGeracao();
      await iniciarEdicao({ id: g.id, rotulo: "Montagem", outName: "pronto-2.mp4", trabalho: { tipo: "batida", dados: {} }, arquivos: { "a.mp4": "a.mp4" } });
      const pronta = await esperarGeracao(g.id);
      expect(pronta.status).toBe("done");
      expect(await readFile(path.join(DADOS, "media", "pronto-2.mp4"), "utf8")).toBe("site:AAA");
      expect(await readFile(logPath(g.id), "utf8")).toContain("a edição roda no servidor do site");
      servidor = await subirServidor();
    });

    it("falha da edição: a geração vira falha com o rótulo, e não sobra vídeo", async () => {
      const g = await novaGeracao();
      await iniciarEdicao({ id: g.id, rotulo: "Edição na batida", outName: "pronto-3.mp4", trabalho: { tipo: "batida", dados: { falhar: "a legenda não saiu (x)" } }, arquivos: { "a.mp4": "a.mp4" } });
      const falhou = await esperarGeracao(g.id);
      expect(falhou.status).toBe("failed");
      expect(falhou.error).toBe("Edição na batida: a legenda não saiu (x)");
      expect(await existe(path.join(DADOS, "media", "pronto-3.mp4"))).toBe(false);
    });

    it("reinício do site: o pedido gravado continua sozinho na subida", async () => {
      const g = await novaGeracao();
      // O que um site que caiu no meio deixou no disco.
      await mkdir(path.join(DADOS, "edicoes"), { recursive: true });
      await writeFile(
        path.join(DADOS, "edicoes", `${g.id}.json`),
        JSON.stringify({
          id: g.id,
          rotulo: "Montagem",
          outName: "pronto-4.mp4",
          trabalho: { tipo: "batida", dados: {}, entradas: ["b.mp4"] },
          arquivos: { "b.mp4": "b.mp4" },
          organizacao: null,
          criadoEm: new Date().toISOString(),
        }),
      );
      expect(await retomarEdicoes()).toBe(1);
      const pronta = await esperarGeracao(g.id);
      expect(pronta.status).toBe("done");
      expect(await readFile(path.join(DADOS, "media", "pronto-4.mp4"), "utf8")).toBe("servidor:BBB");
      expect(await readFile(logPath(g.id), "utf8")).toContain("o servidor do site reiniciou");
    });

    it("sem o endereço do servidor de edições, roda no site como antes", async () => {
      apontarPara(null);
      const g = await novaGeracao();
      await iniciarEdicao({ id: g.id, rotulo: "Montagem", outName: "pronto-5.mp4", trabalho: { tipo: "batida", dados: {} }, arquivos: { "a.mp4": "a.mp4" } });
      expect((await esperarGeracao(g.id)).status).toBe("done");
      expect(await readFile(path.join(DADOS, "media", "pronto-5.mp4"), "utf8")).toBe("site:AAA");
      expect(servidor.vezes()).toBe(0);
    });
  });
});
