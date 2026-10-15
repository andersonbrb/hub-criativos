import "server-only";

// Tetos contra enxurrada, contados na memória do processo (o hub roda num processo só).
//
// Nenhum deles é a segurança do fluxo: quem decide é o endereço de retorno, o PKCE, o consentimento e o token. São o
// que impede alguém de encher as tabelas com registro e pedido de autorização (rotas públicas que gravam), e o que
// segura um token vazado em laço batendo no /mcp. Reiniciar o servidor zera os contadores, e tudo bem.

const contadores = new Map<string, { inicio: number; total: number }>();

// Janela fixa por chave. Conta a tentativa e diz se ela passou do teto.
export function passouDoLimite(chave: string, teto: number, janelaMs: number): boolean {
  const agora = Date.now();
  if (contadores.size > 10_000) {
    for (const [k, v] of contadores) if (agora - v.inicio >= janelaMs) contadores.delete(k);
  }
  const atual = contadores.get(chave);
  if (!atual || agora - atual.inicio >= janelaMs) {
    contadores.set(chave, { inicio: agora, total: 1 });
    return teto < 1;
  }
  if (atual.total >= teto) return true;
  atual.total++;
  return false;
}

// Só para testes.
export function zerarLimites() {
  contadores.clear();
}
