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
