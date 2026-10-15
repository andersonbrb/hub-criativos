import "server-only";

import type {
  Autor,
  Doc,
  DocResumo,
  EntradaLicao,
  EntradaProjeto,
  EntradaSalvar,
  FiltroDocs,
  ResultadoBusca,
  Versao,
} from "@/features/memoria/contrato";

// Serviços da Memória. Contrato estável: as assinaturas abaixo não mudam.
// Implementação na Onda 1 (agente Memória).

const pendente = (nome: string): never => {
  throw new Error(`Em construção: ${nome} (Onda 1, agente Memória).`);
};

export async function listarIndice(filtro?: FiltroDocs): Promise<DocResumo[]> {
  void filtro;
  return pendente("listarIndice");
}

export async function buscar(consulta: string, filtro?: FiltroDocs & { limite?: number }): Promise<ResultadoBusca[]> {
  void consulta, filtro;
  return pendente("buscar");
}

// versao ausente = a mais recente.
export async function ler(slug: string, versao?: number): Promise<Doc | null> {
  void slug, versao;
  return pendente("ler");
}

export async function salvar(entrada: EntradaSalvar, autor: Autor): Promise<Doc> {
  void entrada, autor;
  return pendente("salvar");
}

// Acrescenta uma seção no fim (regra do contexto: acrescentar em vez de reescrever).
export async function acrescentarSecao(slug: string, secao: { titulo: string; conteudo: string }, autor: Autor, nota?: string): Promise<Doc> {
  void slug, secao, autor, nota;
  return pendente("acrescentarSecao");
}

export async function registrarProjeto(entrada: EntradaProjeto, autor: Autor): Promise<Doc> {
  void entrada, autor;
  return pendente("registrarProjeto");
}

export async function registrarLicao(entrada: EntradaLicao, autor: Autor): Promise<Doc> {
  void entrada, autor;
  return pendente("registrarLicao");
}

export async function historico(slug: string): Promise<Versao[]> {
  void slug;
  return pendente("historico");
}

// Restaurar cria uma versão NOVA com o conteúdo antigo (nada é apagado).
export async function restaurar(slug: string, versao: number, autor: Autor): Promise<Doc> {
  void slug, versao, autor;
  return pendente("restaurar");
}

export async function pendentesDeRevisao(): Promise<DocResumo[]> {
  return pendente("pendentesDeRevisao");
}

export async function marcarRevisado(slug: string, autor: Autor): Promise<Doc> {
  void slug, autor;
  return pendente("marcarRevisado");
}

// Documentos que entram no prompt de sistema dos agentes do hub (noPrompt = true), na versão mais recente.
export async function documentosDoPrompt(): Promise<Doc[]> {
  return pendente("documentosDoPrompt");
}
