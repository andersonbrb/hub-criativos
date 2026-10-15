import "server-only";

import { NaoAutenticado, SemPermissao } from "@/features/acesso/contrato";
import { InputError } from "@/lib/server/http";

// Erros do Acesso. O route() transforma em status: InputError 400, NaoAutenticado 401, SemPermissao 403.
// As mensagens aparecem como estão na tela, então são para quem usa, não para quem programa.

// Mesmo texto para e-mail inexistente e senha errada: não revela quem tem conta.
export class CredenciaisInvalidas extends NaoAutenticado {
  constructor() {
    super("E-mail ou senha incorretos.");
  }
}

export class ContaDesativada extends NaoAutenticado {
  constructor() {
    super("Sua conta está desativada. Fale com um admin do hub.");
  }
}

export class MuitasTentativas extends InputError {
  constructor(minutos: number) {
    super(`Muitas tentativas erradas. Espere ${minutos} minuto${minutos === 1 ? "" : "s"} e tente de novo.`);
  }
}

export class SenhaFraca extends InputError {}

export class ConviteInvalido extends InputError {}

export class MembroNaoEncontrado extends InputError {
  constructor() {
    super("Essa pessoa não existe mais na lista de membros. Recarregue a página.");
  }
}

// Regra de gestão de membros que impede a mudança (ex.: último dono, desativar a si mesmo).
export class RegraDeMembros extends InputError {}

// Permissão de gestão com texto próprio (ex.: só o dono promove a admin).
export class SoQuemPode extends SemPermissao {
  constructor(mensagem: string) {
    super("membros");
    this.message = mensagem;
  }
}
