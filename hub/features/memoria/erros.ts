import "server-only";

import { InputError } from "@/lib/server/http";

// Erros: viram 400 na API (InputError) e texto legível para o agente.
export class DocNaoEncontrado extends InputError {
  constructor(slug: string) {
    super(`Não existe documento "${slug}" na Memória. Use a busca ou o índice para achar o certo.`);
  }
}

export class ConflitoDeVersao extends InputError {
  // A rota devolve 409 com a versão atual, para a tela oferecer recarregar sem perder o texto digitado.
  versaoAtual: number;
  constructor(slug: string, atual: number, esperada: number | null) {
    super(
      esperada === null
        ? `Já existe um documento "${slug}". Leia ele e acrescente ou edite, em vez de criar outro.`
        : `O documento "${slug}" mudou desde que você leu (você leu a versão ${esperada}, agora é a ${atual}). Leia de novo e reaplique só a sua mudança.`,
    );
    this.versaoAtual = atual;
  }
}

export class SegredoDetectado extends InputError {
  constructor(motivo: string) {
    super(`Não gravei: o texto parece conter uma chave ou senha (${motivo}). Tire o segredo e tente de novo.`);
  }
}
