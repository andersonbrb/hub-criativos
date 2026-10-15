// Contrato da Memória (base de conhecimento da operação, que veio do contexto do Sávio).
// Arquivo puro (sem código de servidor): a tela pode importar. Funções em features/memoria/servicos/memoria.ts,
// erros em features/memoria/erros.ts. Quem usa: tela Memória, chat interno
// (lib/server/chat) e o conector do Claude Code (features/conector).

export const TIPOS = ["regra", "fluxo", "fato", "projeto", "licao", "decisao", "playbook"] as const;
export type TipoDoc = (typeof TIPOS)[number];

export const FRENTES = ["cod", "info", "x1", "geral"] as const;
export type Frente = (typeof FRENTES)[number];

// Quem escreveu: pessoa do hub (id) ou um processo (ex.: "Importador", com id null).
export type Autor = { id: string | null; nome: string };

export type DocResumo = {
  slug: string;
  titulo: string;
  tipo: TipoDoc;
  frente: Frente;
  mercado: string | null;
  // Entra no prompt de sistema dos agentes do hub (regras centrais e playbooks); o resto é lido sob demanda.
  noPrompt: boolean;
  precisaRevisao: boolean;
  versao: number;
  atualizadoEm: string;
  // Ex.: projeto → { status, data, mercado }; lição → { data }.
  metadados: Record<string, unknown>;
};

export type Doc = DocResumo & { conteudo: string; autor: string };

export type Versao = { versao: number; autor: string; nota: string | null; criadoEm: string; sha: string };

export type ResultadoBusca = DocResumo & { trecho: string };

export type FiltroDocs = { tipo?: TipoDoc; frente?: Frente };

export type EntradaSalvar = {
  slug: string;
  conteudo: string;
  // null = documento novo (falha se o slug já existe); número = versão que a pessoa leu (falha se mudou).
  versaoEsperada: number | null;
  titulo?: string;
  tipo?: TipoDoc;
  frente?: Frente;
  mercado?: string | null;
  noPrompt?: boolean;
  precisaRevisao?: boolean;
  metadados?: Record<string, unknown>;
  nota?: string;
};

export type EntradaProjeto = {
  slug: string;
  titulo: string;
  frente: Frente;
  mercado?: string | null;
  status: string; // entregue | pausado | validado | vencedor | em produção…
  data: string; // AAAA-MM-DD
  conteudo: string;
};

export type EntradaLicao = {
  titulo: string;
  data: string; // AAAA-MM-DD
  oQueAconteceu: string;
  regra: string;
  relacionado?: string; // slug de outro documento
};

// ---- Acrescentado na Onda 1 (agente Memória) ----

export const TIPO_ROTULO: Record<TipoDoc, string> = {
  regra: "Regras",
  fluxo: "Fluxos",
  fato: "Fatos do negócio",
  projeto: "Projetos e lotes",
  licao: "Lições",
  decisao: "Decisões",
  playbook: "Playbooks",
};

export const FRENTE_ROTULO: Record<Frente, string> = {
  cod: "COD",
  info: "Infoproduto",
  x1: "X1 After-Pay",
  geral: "Geral",
};

export const ehTipo = (v: unknown): v is TipoDoc => typeof v === "string" && (TIPOS as readonly string[]).includes(v);
export const ehFrente = (v: unknown): v is Frente => typeof v === "string" && (FRENTES as readonly string[]).includes(v);

// Slug: minúsculo, com hífen (ex.: 05-traducao-de-criativos, projeto-dewalt-ads-cl).
export const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{0,119}$/;
// Nomes usados por rotas fixas da API (/api/memoria/busca etc.): um documento com esse slug ficaria inacessível.
export const SLUGS_RESERVADOS = ["busca", "projetos", "pendentes"] as const;

// Busca: limite padrão e máximo de resultados.
export const LIMITE_BUSCA = 10;
export const LIMITE_BUSCA_MAX = 30;

// Linha do índice de projetos gerado (a partir dos documentos tipo "projeto").
export type LinhaProjeto = {
  slug: string;
  titulo: string;
  frente: Frente;
  // Como a frente aparecia na tabela original (ex.: "e-com (cartão)"), quando não bate com as quatro frentes.
  frenteOriginal: string | null;
  mercado: string | null;
  status: string | null;
  data: string | null; // AAAA-MM-DD
  precisaRevisao: boolean;
  atualizadoEm: string;
};

// Dia de hoje (AAAA-MM-DD) no fuso da operação, para datar seções e lições.
export const hojeISO = (agora = new Date()) => agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
