import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { banco, type Banco } from "@/db/cliente";
import { integracoesChaves } from "@/db/schema";
import { CHAVES, MODELOS_DA_API, TAMANHO_MAXIMO, type NomeDaChave, type ResumoDaChave, type ResumoDasChaves } from "@/features/integracoes/contrato";
import { cifrar, decifrar, problemaNaChave } from "@/features/integracoes/servicos/cifra";
import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// Chaves das integrações, coladas na tela Integrações (contrato em features/integracoes/contrato.ts).
//
// Onde ficam:
// - Com banco (o hub da nuvem): tabela integracoes_chaves, cifradas com HUB_CHAVE_SEGREDOS.
// - PC sem banco: .data/integracoes.json, em texto, como as sessões do FLORA/HeyGen/ElevenLabs que já moram em .data.
//   A pasta nunca vai para o git.
//
// As variáveis de antes (ANTHROPIC_API_KEY etc.) ainda servem de ponto de partida: no banco, o valor delas é gravado
// na primeira leitura e a variável pode ser apagada do servidor. Remover a chave na tela deixa a linha vazia, então a
// variável antiga não volta sozinha. No PC sem banco, a variável do .env.local vale enquanto a tela não gravar outra.

const ARQUIVO = path.join(DATA_DIR, "integracoes.json");
// Por quanto tempo uma leitura do banco vale na memória. Gravar pela tela atualiza na hora.
const VALIDADE_MS = 60_000;

type Lembrada = { valor: string | null; quando: number };

// Memória por banco: os testes trocam o banco a cada caso, e um banco novo não pode herdar as chaves do anterior.
const g = globalThis as typeof globalThis & { __hubChaves?: WeakMap<Banco, Map<NomeDaChave, Lembrada>> };
function memoriaDo(db: Banco) {
  g.__hubChaves ??= new WeakMap();
  let m = g.__hubChaves.get(db);
  if (!m) g.__hubChaves.set(db, (m = new Map()));
  return m;
}

// Esquece o que está na memória (testes): a próxima leitura vai ao banco.
export function esquecerChavesLembradas() {
  g.__hubChaves = undefined;
}

// banco() lança quando não há DATABASE_URL (o PC sem Postgres). Aqui isso só muda o lugar das chaves.
function bancoOuNada(): Banco | null {
  try {
    return banco();
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// O dono local (PC sem banco) tem id "local", que não é uma conta do banco.
const contaDoHub = (id: string | null | undefined) => (id && UUID.test(id) ? id : null);

const variavelAntiga = (nome: NomeDaChave) => process.env[CHAVES[nome].variavelAntiga]?.trim() || null;

// ---------------------------------------------------------------------------------------------------------------
// Leitura

// Valor da chave, ou null quando ninguém colou. Nunca lança: uma falha do banco vira "sem chave" (e fica no log), para
// a tela Integrações e o chat mostrarem o aviso de configurar em vez de cair.
export async function lerChave(nome: NomeDaChave): Promise<string | null> {
  const db = bancoOuNada();
  if (!db) return lerDoArquivo(nome);
  const memoria = memoriaDo(db);
  const lembrada = memoria.get(nome);
  if (lembrada && Date.now() - lembrada.quando < VALIDADE_MS) return lembrada.valor;
  try {
    const valor = await lerDoBanco(db, nome);
    memoria.set(nome, { valor, quando: Date.now() });
    return valor;
  } catch (err) {
    console.error(`[integracoes] não deu para ler "${CHAVES[nome].rotulo}":`, err instanceof Error ? err.message : err);
    return variavelAntiga(nome);
  }
}

async function lerDoBanco(db: Banco, nome: NomeDaChave): Promise<string | null> {
  const [linha] = await db.select().from(integracoesChaves).where(eq(integracoesChaves.nome, nome)).limit(1);
  if (linha) {
    if (!linha.valorCifrado) return null;
    try {
      return decifrar(linha.valorCifrado);
    } catch {
      // HUB_CHAVE_SEGREDOS trocou depois de gravar: a chave precisa ser colada de novo (a tela mostra o campo vazio).
      console.error(`[integracoes] "${CHAVES[nome].rotulo}" não abre com a HUB_CHAVE_SEGREDOS atual; cole de novo em Integrações.`);
      return null;
    }
  }
  // Nunca gravada pela tela: traz a variável antiga do servidor, uma vez só.
  const antiga = variavelAntiga(nome);
  if (!antiga) return null;
  // Sem como cifrar, não grava (nada de chave em texto no banco): usa a variável como está.
  if (problemaNaChave()) return antiga;
  await db.insert(integracoesChaves).values({ nome, valorCifrado: cifrar(antiga) }).onConflictDoNothing();
  console.log(`[integracoes] "${CHAVES[nome].rotulo}" veio da variável ${CHAVES[nome].variavelAntiga} e agora fica no hub. A variável pode ser apagada.`);
  return antiga;
}

type Arquivo = Partial<Record<NomeDaChave, string | null>>;

async function lerArquivo(): Promise<Arquivo> {
  try {
    return JSON.parse(await readFile(ARQUIVO, "utf8")) as Arquivo;
  } catch {
    return {};
  }
}

async function lerDoArquivo(nome: NomeDaChave): Promise<string | null> {
  const arquivo = await lerArquivo();
  // Presente no arquivo (mesmo vazia, depois de remover): vale a tela. Ausente: a variável do .env.local, se houver.
  return Object.hasOwn(arquivo, nome) ? (arquivo[nome] ?? null) : variavelAntiga(nome);
}

// O que a tela Integrações mostra de cada chave (segredo só com os 4 últimos caracteres).
export async function resumoDasChaves(): Promise<ResumoDasChaves> {
  const nomes = Object.keys(CHAVES) as NomeDaChave[];
  const valores = await Promise.all(nomes.map(lerChave));
  return Object.fromEntries(nomes.map((nome, i) => [nome, resumir(nome, valores[i])])) as ResumoDasChaves;
}

function resumir(nome: NomeDaChave, valor: string | null): ResumoDaChave {
  if (!valor) return { salva: false, mostra: null };
  return { salva: true, mostra: CHAVES[nome].segredo ? `••••${valor.slice(-4)}` : valor };
}

// Por que a tela não consegue gravar chaves neste servidor (texto para a tela), ou null quando consegue.
export function problemaParaGravar(): string | null {
  return bancoOuNada() ? problemaNaChave() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Gravação (tela Integrações, chave "integracoes")

function validar(nome: NomeDaChave, bruto: unknown): string {
  const valor = typeof bruto === "string" ? bruto.trim() : "";
  if (!valor) throw new InputError("Cole a chave antes de salvar.");
  if (valor.length > TAMANHO_MAXIMO || /\s/.test(valor)) throw new InputError("Isso não parece uma chave. Copie de novo, sem espaços nem quebras de linha.");
  if (nome === "modelo-api" && !MODELOS_DA_API.some((m) => m.id === valor)) throw new InputError("Modelo desconhecido.");
  return valor;
}

// Grava (ou troca) a chave. `quem`: id da conta do hub que colou.
export async function gravarChave(nome: NomeDaChave, bruto: unknown, quem?: string | null): Promise<ResumoDaChave> {
  const valor = validar(nome, bruto);
  await guardar(nome, valor, quem);
  return resumir(nome, valor);
}

// Tira a chave do hub. Quem usava (o chat, o Drive) passa a mostrar o aviso de configurar.
export async function apagarChave(nome: NomeDaChave, quem?: string | null): Promise<ResumoDaChave> {
  await guardar(nome, null, quem);
  return resumir(nome, null);
}

async function guardar(nome: NomeDaChave, valor: string | null, quem?: string | null) {
  const db = bancoOuNada();
  if (!db) {
    const arquivo = await lerArquivo();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ARQUIVO, JSON.stringify({ ...arquivo, [nome]: valor }, null, 1));
    return;
  }
  const problema = problemaNaChave();
  if (problema && valor !== null) throw new InputError(problema);
  const campos = { valorCifrado: valor === null ? null : cifrar(valor), atualizadoPor: contaDoHub(quem), atualizadoEm: new Date() };
  await db
    .insert(integracoesChaves)
    .values({ nome, ...campos })
    .onConflictDoUpdate({ target: integracoesChaves.nome, set: campos });
  memoriaDo(db).set(nome, { valor, quando: Date.now() });
}
