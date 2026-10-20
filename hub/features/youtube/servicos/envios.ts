import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { youtubeEnvios } from "@/db/schema";
import type { Usuario } from "@/features/acesso/contrato";
import { comOrganizacao, organizacaoAtual } from "@/features/acesso/servicos/organizacao-atual";
import { ErroDoDrive, SemEspacoNoServidor, segurarTemp, soltarTemp } from "@/features/drive/servicos/arquivos";
import { arquivoLocal } from "@/features/drive/servicos/videos";
import { cifrar, decifrar } from "@/features/integracoes/servicos/cifra";
import {
  AGENDAMENTO_MAXIMO_MS,
  ANTECEDENCIA_MINIMA_MS,
  DESCRICAO_MAXIMA,
  ehVisibilidade,
  linkDoVideo,
  MINIATURA_MAXIMA,
  TIPOS_DE_MINIATURA,
  TITULO_MAXIMO,
  VISIBILIDADES,
  type EnvioYoutube,
  type SituacaoDoEnvio,
  type Visibilidade,
} from "@/features/youtube/contrato";
import { canalConectado, ErroDoYoutube, YoutubeNaoConectado } from "@/features/youtube/servicos/conta";
import { aplicarMiniatura, situacaoNoYoutube, subirVideo, traduzirRecusa } from "@/features/youtube/servicos/subir";
import { InputError } from "@/lib/server/http";
import { pastaDeDados } from "@/lib/server/pastas";
import { getGeneration } from "@/lib/server/store";

// Envios de vídeos prontos para o canal do YouTube da organização. Cada envio é uma linha em youtube_envios.
//
// Como anda: "Enviar agora" grava o envio já como "enviando"; "Agendar" grava como "agendado" e nada vai ao YouTube
// antes da hora. A fila (rodarFila) roda a cada minuto (instrumentation.ts) e a cada pedido novo: pega o que está na
// hora e o que ficou "enviando" sem ninguém cuidando (o servidor reiniciou no meio), e sobe, no máximo 2 por vez.
// Cada envio roda dentro da organização dele (comOrganizacao): token, canal e arquivo são sempre os dela.
// Depois do envio, a lista confere se o YouTube aceitou o vídeo (repetido, longo demais, formato...).

type Linha = typeof youtubeEnvios.$inferSelect;

const SIMULTANEOS = 2;
const INTERVALO_DA_FILA_MS = 60_000;
// Cópia temporária do vídeo (vinda do Drive) segura durante o envio: vídeos grandes levam horas em internet lenta.
const SEGURA_DO_ARQUIVO_MS = 12 * 60 * 60_000;
// Depois de enviado, a lista confere no YouTube por algumas horas (o processamento pode recusar o vídeo).
const CONFERIR_POR_MS = 6 * 60 * 60_000;
const CONFERIR_A_CADA_MS = 2 * 60_000;
const LISTA_MAXIMA = 50;

function bancoOuNada(): Banco | null {
  try {
    return banco();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Estado do processo (sobrevive ao hot reload do dev)

type Estado = {
  emCurso: Map<string, AbortController>;
  rodada: Promise<void> | null;
  relogio: ReturnType<typeof setInterval> | null;
  ultimaConferencia: Map<string, number>;
};
const g = globalThis as typeof globalThis & { __hubYoutubeEnvios?: Estado };
const estado = (): Estado => (g.__hubYoutubeEnvios ??= { emCurso: new Map(), rodada: null, relogio: null, ultimaConferencia: new Map() });

// Para os testes: espera o que está rodando e esquece tudo.
export async function zerarFilaDoYoutube() {
  const e = estado();
  if (e.relogio) clearInterval(e.relogio);
  for (const c of e.emCurso.values()) c.abort();
  await e.rodada?.catch(() => undefined);
  g.__hubYoutubeEnvios = undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Para a tela

const paraTela = (l: Linha): EnvioYoutube => ({
  id: l.id,
  geracaoId: l.geracaoId,
  titulo: l.titulo,
  visibilidade: ehVisibilidade(l.visibilidade) ? l.visibilidade : "private",
  shorts: l.shorts,
  temMiniatura: Boolean(l.miniatura),
  agendadoPara: l.agendadoPara?.toISOString() ?? null,
  situacao: l.situacao as SituacaoDoEnvio,
  progresso: l.situacao === "enviando" ? l.progresso : null,
  link: l.videoId ? linkDoVideo(l.videoId) : null,
  erro: l.erro,
  aviso: l.aviso,
  canal: l.canalTitulo,
  criadoEm: l.criadoEm.toISOString(),
  enviadoEm: l.enviadoEm?.toISOString() ?? null,
});

// Envios da organização aberta, do mais novo ao mais antigo. Com `geracaoId`, só os daquele vídeo.
export async function listarEnvios(geracaoId?: string | null): Promise<EnvioYoutube[]> {
  const db = bancoOuNada();
  if (!db) return [];
  const org = await organizacaoAtual();
  const filtro = geracaoId ? and(eq(youtubeEnvios.organizacaoId, org), eq(youtubeEnvios.geracaoId, geracaoId)) : eq(youtubeEnvios.organizacaoId, org);
  const linhas = await db.select().from(youtubeEnvios).where(filtro).orderBy(desc(youtubeEnvios.criadoEm)).limit(LISTA_MAXIMA);
  // Quem olha a lista também faz a fila andar e confere os recém-enviados (sem esperar).
  void rodarFila();
  void conferirEnviados().catch((err) => console.error("[youtube] conferência:", err instanceof Error ? err.message : err));
  return linhas.map(paraTela);
}

async function lerEnvio(id: string): Promise<Linha | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [linha] = await banco()
    .select()
    .from(youtubeEnvios)
    .where(and(eq(youtubeEnvios.id, id), eq(youtubeEnvios.organizacaoId, await organizacaoAtual())))
    .limit(1);
  return linha ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido de envio

export type PedidoDeEnvio = {
  geracaoId: unknown;
  titulo: unknown;
  descricao?: unknown;
  visibilidade: unknown;
  // ISO (o navegador converte a hora local). Vazio: enviar agora.
  agendadoPara?: unknown;
  shorts?: unknown;
  paraCriancas?: unknown;
};

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const marcado = (v: unknown) => v === true || v === "true" || v === "1" || v === "on";
const SINAIS_PROIBIDOS = /[<>]/;

function validarTitulo(v: unknown): string {
  const titulo = texto(v).replace(/\s+/g, " ").trim();
  if (!titulo) throw new InputError("Escreva o título do vídeo.");
  if ([...titulo].length > TITULO_MAXIMO) throw new InputError(`O título pode ter até ${TITULO_MAXIMO} caracteres.`);
  if (SINAIS_PROIBIDOS.test(titulo)) throw new InputError("O YouTube não aceita os sinais < e > no título.");
  return titulo;
}

function validarDescricao(v: unknown): string {
  const descricao = texto(v).replace(/\r\n/g, "\n").trim();
  if (Buffer.byteLength(descricao, "utf8") > DESCRICAO_MAXIMA) throw new InputError(`A descrição pode ter até ${DESCRICAO_MAXIMA} caracteres.`);
  if (SINAIS_PROIBIDOS.test(descricao)) throw new InputError("O YouTube não aceita os sinais < e > na descrição.");
  return descricao;
}

function validarAgendamento(v: unknown): Date | null {
  const bruto = texto(v).trim();
  if (!bruto) return null;
  const quando = new Date(bruto);
  if (Number.isNaN(quando.getTime())) throw new InputError("A data e o horário do agendamento não estão certos.");
  const falta = quando.getTime() - Date.now();
  if (falta < ANTECEDENCIA_MINIMA_MS) throw new InputError("Agende para pelo menos 2 minutos à frente. Para agora, use Enviar agora.");
  if (falta > AGENDAMENTO_MAXIMO_MS) throw new InputError("Dá para agendar até 1 ano à frente.");
  return quando;
}

// Grava o pedido (na hora ou agendado) e põe a fila para andar. `miniatura`: imagem opcional (JPG ou PNG).
export async function criarEnvio(pedido: PedidoDeEnvio, miniatura: File | null, quem: Usuario): Promise<EnvioYoutube> {
  const geracaoId = texto(pedido.geracaoId).trim();
  const titulo = validarTitulo(pedido.titulo);
  const descricao = validarDescricao(pedido.descricao);
  if (!ehVisibilidade(pedido.visibilidade)) throw new InputError("Escolha a visibilidade: público, não listado ou privado.");
  const visibilidade: Visibilidade = pedido.visibilidade;
  const agendadoPara = validarAgendamento(pedido.agendadoPara);

  const gen = geracaoId ? await getGeneration(geracaoId) : undefined;
  if (!gen || gen.foraDoDrive) throw new InputError("Vídeo não encontrado. Ele pode ter sido apagado.");
  if (gen.kind !== "video" || gen.status !== "done" || !gen.file) throw new InputError("Só dá para enviar ao YouTube um vídeo pronto.");

  const canal = await canalConectado();
  if (!canal) throw new YoutubeNaoConectado();

  const id = randomUUID();
  const imagem = miniatura && miniatura.size > 0 ? await guardarMiniatura(id, miniatura) : null;

  const [linha] = await banco()
    .insert(youtubeEnvios)
    .values({
      id,
      organizacaoId: await organizacaoAtual(),
      geracaoId: gen.id,
      arquivo: gen.file,
      canalId: canal.id,
      canalTitulo: canal.titulo,
      titulo,
      descricao,
      visibilidade,
      paraCriancas: marcado(pedido.paraCriancas),
      shorts: marcado(pedido.shorts),
      miniatura: imagem,
      agendadoPara,
      situacao: agendadoPara ? "agendado" : "enviando",
      criadoPor: /^[0-9a-f-]{36}$/i.test(quem.id) ? quem.id : null,
    })
    .returning();
  void rodarFila();
  return paraTela(linha);
}

// Miniatura fica na pasta da organização (youtube/miniaturas) até ser aplicada ou o envio ser cancelado.
async function guardarMiniatura(id: string, arquivo: File): Promise<string> {
  const tipo = (TIPOS_DE_MINIATURA as readonly string[]).includes(arquivo.type) ? arquivo.type : null;
  if (!tipo) throw new InputError("A miniatura precisa ser uma imagem JPG ou PNG.");
  if (arquivo.size > MINIATURA_MAXIMA) throw new InputError("A miniatura pode ter até 10 MB.");
  const nome = `${id}.${tipo === "image/png" ? "png" : "jpg"}`;
  const pasta = await pastaDasMiniaturas();
  await mkdir(pasta, { recursive: true });
  await writeFile(path.join(pasta, nome), new Uint8Array(await arquivo.arrayBuffer()));
  return nome;
}

const pastaDasMiniaturas = async () => path.join(await pastaDeDados(), "youtube", "miniaturas");

async function apagarMiniatura(nome: string | null) {
  if (!nome) return;
  await unlink(path.join(await pastaDasMiniaturas(), path.basename(nome))).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Cancelar e tentar de novo

// Cancela um envio agendado (ou um que ainda está subindo: o que já foi para o YouTube é descartado por ele).
export async function cancelarEnvio(id: string): Promise<EnvioYoutube> {
  const linha = await lerEnvio(id);
  if (!linha) throw new InputError("Envio não encontrado.");
  if (linha.situacao !== "agendado" && linha.situacao !== "enviando") {
    throw new InputError(linha.situacao === "enviado" ? "Esse vídeo já foi enviado. Para tirar do ar, apague no YouTube Studio." : "Esse envio não está mais na fila.");
  }
  const [atualizada] = await banco()
    .update(youtubeEnvios)
    .set({ situacao: "cancelado", progresso: null, sessaoCifrada: null, atualizadoEm: new Date() })
    .where(and(eq(youtubeEnvios.id, linha.id), inArray(youtubeEnvios.situacao, ["agendado", "enviando"])))
    .returning();
  if (!atualizada) throw new InputError("Esse envio acabou de terminar e não dá mais para cancelar.");
  estado().emCurso.get(linha.id)?.abort(new InputError("Envio cancelado."));
  await apagarMiniatura(linha.miniatura);
  return paraTela(atualizada);
}

// Põe de novo na fila um envio que falhou (sai na hora, mesmo que fosse agendado para antes).
export async function tentarDeNovo(id: string): Promise<EnvioYoutube> {
  const linha = await lerEnvio(id);
  if (!linha) throw new InputError("Envio não encontrado.");
  if (linha.situacao !== "falhou") throw new InputError("Só dá para tentar de novo um envio que falhou.");
  const canal = await canalConectado();
  if (!canal) throw new YoutubeNaoConectado();
  if (canal.id !== linha.canalId) throw new InputError("O canal do YouTube mudou desde este envio. Envie de novo pelo botão do vídeo.");
  const [atualizada] = await banco()
    .update(youtubeEnvios)
    .set({ situacao: "enviando", erro: null, progresso: null, atualizadoEm: new Date() })
    .where(and(eq(youtubeEnvios.id, linha.id), eq(youtubeEnvios.situacao, "falhou")))
    .returning();
  if (!atualizada) throw new InputError("Esse envio mudou de situação. Recarregue a lista.");
  void rodarFila();
  return paraTela(atualizada);
}

// ---------------------------------------------------------------------------------------------------------------
// Fila

// Começa o relógio da fila (uma vez por processo): instrumentation.ts chama ao subir o servidor.
export function iniciarFilaDoYoutube() {
  const e = estado();
  if (e.relogio || !bancoOuNada()) return;
  e.relogio = setInterval(() => void rodarFila(), INTERVALO_DA_FILA_MS);
  e.relogio.unref?.();
  void rodarFila();
}

// Uma rodada por vez. Pega os envios na hora (de todas as organizações) e começa até preencher as vagas.
export function rodarFila(): Promise<void> {
  const e = estado();
  if (!e.rodada) {
    const rodada: Promise<void> = umaRodada()
      // O motivo de verdade (banco fora, por exemplo) fica na causa; a mensagem do Drizzle traz a consulta inteira.
      .catch((err) => console.error("[youtube] fila:", err instanceof Error ? String((err.cause as Error | undefined)?.message ?? err.message).slice(0, 200) : err))
      .finally(() => {
        if (e.rodada === rodada) e.rodada = null;
      });
    e.rodada = rodada;
  }
  return e.rodada;
}

async function umaRodada(): Promise<void> {
  const db = bancoOuNada();
  const e = estado();
  if (!db || e.emCurso.size >= SIMULTANEOS) return;
  const agora = new Date();
  const candidatos = await db
    .select()
    .from(youtubeEnvios)
    .where(or(eq(youtubeEnvios.situacao, "enviando"), and(eq(youtubeEnvios.situacao, "agendado"), lte(youtubeEnvios.agendadoPara, agora))))
    .orderBy(asc(sql`coalesce(${youtubeEnvios.agendadoPara}, ${youtubeEnvios.criadoEm})`))
    .limit(20);
  for (const c of candidatos) {
    if (e.emCurso.size >= SIMULTANEOS) break;
    // "enviando" fora da memória: pedido agora ou largado por um reinício (continua da sessão guardada).
    if (e.emCurso.has(c.id)) continue;
    const [assumido] = await db
      .update(youtubeEnvios)
      .set({ situacao: "enviando", atualizadoEm: new Date() })
      .where(and(eq(youtubeEnvios.id, c.id), eq(youtubeEnvios.situacao, c.situacao)))
      .returning({ id: youtubeEnvios.id });
    if (!assumido) continue;
    const controle = new AbortController();
    e.emCurso.set(c.id, controle);
    void comOrganizacao(c.organizacaoId, () => processar(c.id, controle.signal))
      .catch((err) => console.error("[youtube] envio:", err instanceof Error ? err.message : err))
      .finally(() => {
        e.emCurso.delete(c.id);
        void rodarFila();
      });
  }
}

// Espera os envios em andamento (testes).
export async function esperarEnvios() {
  for (let i = 0; i < 200; i++) {
    const e = estado();
    if (!e.emCurso.size && !e.rodada) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const mensagemDeFalha = (err: unknown): string => {
  if (err instanceof InputError || err instanceof ErroDoYoutube || err instanceof ErroDoDrive || err instanceof SemEspacoNoServidor) return err.message;
  console.error("[youtube] falha inesperada no envio:", err);
  return "Não deu para enviar agora por um erro no hub. Use Tentar de novo.";
};

const descricaoFinal = (l: Linha) => {
  // Shorts: o YouTube decide sozinho (vídeo em pé ou quadrado de até 3 minutos); #Shorts na descrição ajuda.
  const marca = l.shorts && !/#shorts/i.test(`${l.titulo} ${l.descricao}`) ? "#Shorts" : "";
  return [l.descricao, marca].filter(Boolean).join("\n\n");
};

async function processar(id: string, signal: AbortSignal): Promise<void> {
  const db = banco();
  const linha = await lerEnvio(id);
  if (!linha || linha.situacao !== "enviando") return;
  const atualizar = (dados: Partial<typeof youtubeEnvios.$inferInsert>) =>
    db
      .update(youtubeEnvios)
      .set({ ...dados, atualizadoEm: new Date() })
      .where(and(eq(youtubeEnvios.id, id), eq(youtubeEnvios.situacao, "enviando")));

  let caminho: string | null = null;
  try {
    const canal = await canalConectado();
    if (!canal) throw new YoutubeNaoConectado();
    if (canal.id !== linha.canalId) throw new InputError("O canal do YouTube desta organização mudou depois do pedido. Envie de novo para o canal atual.");
    const gen = await getGeneration(linha.geracaoId);
    if (!gen?.file || gen.foraDoDrive) throw new InputError("O vídeo não está mais no hub (foi apagado). Não há o que enviar.");

    await atualizar({ progresso: 0 });
    caminho = await arquivoLocal(gen.file);
    segurarTemp(caminho, SEGURA_DO_ARQUIVO_MS);
    const total = await stat(caminho).then(
      (s) => s.size,
      () => {
        throw new InputError("O arquivo do vídeo não foi encontrado no hub.");
      },
    );
    if (!total) throw new InputError("O arquivo do vídeo está vazio.");

    let sessao: string | null = null;
    try {
      sessao = linha.sessaoCifrada ? decifrar(linha.sessaoCifrada) : null;
    } catch {
      sessao = null;
    }
    const video = await subirVideo(
      caminho,
      total,
      { titulo: linha.titulo, descricao: descricaoFinal(linha), visibilidade: linha.visibilidade as Visibilidade, paraCriancas: linha.paraCriancas },
      {
        sessao,
        signal,
        aoAbrirSessao: async (nova) => void (await atualizar({ sessaoCifrada: cifrar(nova) })),
        aoAvancar: async (pct) => void (await atualizar({ progresso: pct })),
      },
    );

    const avisos: string[] = [];
    const pedida = linha.visibilidade as Visibilidade;
    const ficou = video.status?.privacyStatus;
    if (ficou && ficou !== pedida && ehVisibilidade(ficou))
      avisos.push(
        `O YouTube deixou o vídeo como ${VISIBILIDADES[ficou].rotulo.toLowerCase()}, e não ${VISIBILIDADES[pedida].rotulo.toLowerCase()}. Isso acontece quando o app do hub ainda não passou pela auditoria do YouTube (veja docs/youtube.md). Confira no YouTube Studio.`,
      );
    if (linha.miniatura) {
      const aviso = await aplicarMiniatura(
        video.id,
        path.join(await pastaDasMiniaturas(), path.basename(linha.miniatura)),
        linha.miniatura.endsWith(".png") ? "image/png" : "image/jpeg",
      );
      if (aviso) avisos.push(aviso);
      await apagarMiniatura(linha.miniatura);
    }
    await atualizar({
      situacao: "enviado",
      videoId: video.id,
      progresso: 100,
      enviadoEm: new Date(),
      sessaoCifrada: null,
      erro: null,
      aviso: avisos.join(" ") || null,
      miniatura: null,
    });
  } catch (err) {
    // Cancelado no meio: a linha já está como "cancelado" (o update abaixo não pega).
    if (signal.aborted) return;
    await atualizar({ situacao: "falhou", erro: mensagemDeFalha(err), progresso: null });
  } finally {
    if (caminho) soltarTemp(caminho);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência depois do envio

// Vídeos enviados há pouco: o YouTube pode recusar no processamento (repetido, longo demais, formato). Quem recusou
// vira "falhou" com o motivo. No máximo a cada 2 minutos por organização.
export async function conferirEnviados(): Promise<void> {
  const db = bancoOuNada();
  if (!db) return;
  const org = await organizacaoAtual();
  const e = estado();
  if (Date.now() - (e.ultimaConferencia.get(org) ?? 0) < CONFERIR_A_CADA_MS) return;
  e.ultimaConferencia.set(org, Date.now());
  const recentes = await db
    .select({ id: youtubeEnvios.id, videoId: youtubeEnvios.videoId, canalId: youtubeEnvios.canalId })
    .from(youtubeEnvios)
    .where(
      and(
        eq(youtubeEnvios.organizacaoId, org),
        eq(youtubeEnvios.situacao, "enviado"),
        isNotNull(youtubeEnvios.videoId),
        gte(youtubeEnvios.enviadoEm, new Date(Date.now() - CONFERIR_POR_MS)),
      ),
    )
    .limit(50);
  const canal = await canalConectado();
  const doCanal = recentes.filter((r) => r.videoId && r.canalId === canal?.id);
  if (!doCanal.length) return;
  const situacoes = await situacaoNoYoutube(doCanal.map((r) => r.videoId!));
  for (const r of doCanal) {
    const s = situacoes.get(r.videoId!);
    const recusa = s ? traduzirRecusa(s) : null;
    if (recusa)
      await db
        .update(youtubeEnvios)
        .set({ situacao: "falhou", erro: recusa, atualizadoEm: new Date() })
        .where(and(eq(youtubeEnvios.id, r.id), eq(youtubeEnvios.organizacaoId, org), eq(youtubeEnvios.situacao, "enviado")));
  }
}
