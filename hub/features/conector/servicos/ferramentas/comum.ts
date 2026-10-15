import "server-only";

import type { Chave, Usuario } from "@/features/acesso/contrato";
import type { Autor } from "@/features/memoria/contrato";
import { ErroDaFerramenta } from "@/features/conector/erros";

// O que toda ferramenta do conector compartilha: o contexto da chamada, a forma da definição, a leitura dos
// argumentos e o teto de tamanho das respostas.

// Quem está chamando, resolvido e conferido pela rota /mcp a cada requisição (conta ativa e chaves de AGORA).
export type Contexto = { usuario: Usuario; conexaoId: string; base: string };

export type Anotacoes = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type Definicao = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Anotacoes;
};

export type Ferramenta = {
  // Chave da conta que libera a ferramenta (features/acesso/contrato.ts). null = qualquer pessoa conectada.
  chave: Chave | null;
  definicao: Definicao;
  executar: (ctx: Contexto, args: Record<string, unknown>) => Promise<string>;
};

// O Claude Code corta resposta de ferramenta perto de 25 mil tokens; texto e JSON dão uns 3 caracteres por token.
export const TETO_RESPOSTA = 40_000;

export const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// destrutiva = pode substituir o que já existe (a versão anterior fica no histórico, mas o conteúdo atual muda).
export const grava = (destrutiva: boolean, idempotente = false) =>
  ({ readOnlyHint: false, destructiveHint: destrutiva, idempotentHint: idempotente, openWorldHint: false }) as const;

export function esquema(propriedades: Record<string, unknown>, obrigatorios: string[] = []) {
  return {
    type: "object",
    properties: propriedades,
    ...(obrigatorios.length ? { required: obrigatorios } : {}),
    additionalProperties: false,
  };
}

// Quem grava pelo conector aparece assim no histórico da Memória.
export const autorDe = (usuario: Usuario): Autor => ({ id: usuario.id, nome: `${usuario.nome} (Claude Code)` });

// ---- argumentos ----
// A validação do inputSchema é do cliente; aqui ela é refeita, porque o que chega é o que o modelo mandou.

export function texto(args: Record<string, unknown>, nome: string, opcoes: { obrigatorio: true; max?: number }): string;
export function texto(args: Record<string, unknown>, nome: string, opcoes?: { obrigatorio?: false; max?: number }): string | undefined;
export function texto(args: Record<string, unknown>, nome: string, { obrigatorio = false, max = 500_000 } = {}): string | undefined {
  const valor = args[nome];
  if (valor === undefined || valor === null || valor === "") {
    if (obrigatorio) throw new ErroDaFerramenta(`Informe \`${nome}\`.`);
    return undefined;
  }
  if (typeof valor !== "string") throw new ErroDaFerramenta(`\`${nome}\` precisa ser texto.`);
  if (obrigatorio && !valor.trim()) throw new ErroDaFerramenta(`Informe \`${nome}\`.`);
  if (valor.length > max) throw new ErroDaFerramenta(`\`${nome}\` é grande demais (máximo de ${max.toLocaleString("pt-BR")} caracteres).`);
  return valor;
}

export function inteiro(args: Record<string, unknown>, nome: string, { min = 1, max = Number.MAX_SAFE_INTEGER, padrao }: { min?: number; max?: number; padrao?: number } = {}) {
  const valor = args[nome];
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) {
    throw new ErroDaFerramenta(`\`${nome}\` precisa ser um número inteiro a partir de ${min}.`);
  }
  // Acima do teto não é erro: vale o teto.
  return Math.min(n, max);
}

export function booleano(args: Record<string, unknown>, nome: string): boolean | undefined {
  const valor = args[nome];
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "boolean") throw new ErroDaFerramenta(`\`${nome}\` precisa ser true ou false.`);
  return valor;
}

export function umDe<T extends string>(args: Record<string, unknown>, nome: string, opcoes: readonly T[]): T | undefined {
  const valor = args[nome];
  if (valor === undefined || valor === null || valor === "") return undefined;
  if (typeof valor !== "string" || !opcoes.includes(valor as T)) {
    throw new ErroDaFerramenta(`\`${nome}\` precisa ser um destes: ${opcoes.join(", ")}.`);
  }
  return valor as T;
}

export function data(args: Record<string, unknown>, nome: string): string {
  const valor = texto(args, nome, { obrigatorio: true, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new ErroDaFerramenta(`\`${nome}\` precisa ser uma data absoluta no formato AAAA-MM-DD (ex.: 2026-10-15).`);
  }
  return valor;
}

// ---- tamanho das respostas ----

// Lista em JSON que cabe no teto: tira itens do fim até caber e diz quantos ficaram de fora.
export function listaQueCabe<T>(itens: T[], montar: (itens: T[], cortados: number) => unknown): string {
  let n = itens.length;
  for (;;) {
    const saida = JSON.stringify(montar(itens.slice(0, n), itens.length - n));
    if (saida.length <= TETO_RESPOSTA || n === 0) return saida;
    n = Math.min(n - 1, Math.floor(n * (TETO_RESPOSTA / saida.length)));
  }
}

// Divide um texto longo em páginas de até ~38 mil caracteres, de preferência numa quebra de linha.
export function paginas(textoLongo: string, tamanho = TETO_RESPOSTA - 2_000): string[] {
  const partes: string[] = [];
  let inicio = 0;
  while (inicio < textoLongo.length) {
    let fim = Math.min(inicio + tamanho, textoLongo.length);
    if (fim < textoLongo.length) {
      const quebra = textoLongo.lastIndexOf("\n", fim);
      if (quebra > inicio + tamanho * 0.6) fim = quebra + 1;
    }
    partes.push(textoLongo.slice(inicio, fim));
    inicio = fim;
  }
  return partes.length ? partes : [""];
}

// A página pedida, com o aviso de como ler a próxima.
export function pagina(textoLongo: string, numero: number, comoContinuar: (proxima: number) => string): string {
  const todas = paginas(textoLongo);
  if (numero > todas.length) throw new ErroDaFerramenta(`Só existem ${todas.length} página(s).`);
  const trecho = todas[numero - 1];
  if (todas.length === 1) return trecho;
  const rodape =
    numero < todas.length
      ? `\n\n---\nPágina ${numero} de ${todas.length}. Ainda falta conteúdo: ${comoContinuar(numero + 1)}`
      : `\n\n---\nPágina ${numero} de ${todas.length} (última).`;
  return trecho + rodape;
}

export const cortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
