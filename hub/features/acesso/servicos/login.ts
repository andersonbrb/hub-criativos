import "server-only";

import { eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { CredenciaisInvalidas, MuitasTentativas } from "@/features/acesso/erros";
import { conferirSenha, hashDeMentira } from "@/features/acesso/servicos/senha";
import { criarSessao, encerrarSessao, type MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { normalizarEmail, usuarioNaOrganizacao, type LinhaUsuario } from "@/features/acesso/servicos/usuarios";

// Login por e-mail e senha, com freio contra chute de senha. Três freios, numa janela de 10 minutos:
// - e-mail + IP: 5 (alguém errando a mesma conta do mesmo lugar);
// - IP: 30 (um robô chutando vários e-mails);
// - conta: 50 (muitos IPs chutando a mesma conta).
// A tentativa conta ANTES de a senha ser conferida, e não depois do erro: pedidos disparados ao mesmo tempo
// enxergam uns aos outros, então uma rajada em paralelo não passa do limite.
// Login certo limpa só o freio de e-mail + IP e tira a própria tentativa dos outros dois, que seguem contando os
// erros: acertar a própria senha não libera chute nas contas dos outros a partir do mesmo IP.
// A contagem fica na memória do processo (o hub roda num processo só); reiniciar o servidor zera o freio, o que é
// aceitável para o tamanho da equipe.

const JANELA_MS = 10 * 60 * 1000;

class Contador {
  private tentativas = new Map<string, number[]>();

  constructor(readonly limite: number) {}

  private recentes(chave: string, agora: number) {
    const recentes = (this.tentativas.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
    if (recentes.length) this.tentativas.set(chave, recentes);
    else this.tentativas.delete(chave);
    return recentes;
  }

  // Quanto falta (ms) para abrir vaga, ou null se ainda há vaga.
  espera(chave: string, agora: number): number | null {
    const recentes = this.recentes(chave, agora);
    return recentes.length < this.limite ? null : recentes[recentes.length - this.limite] + JANELA_MS - agora;
  }

  contar(chave: string, agora: number) {
    this.tentativas.set(chave, [...this.recentes(chave, agora), agora]);
    // Muitos e-mails ou IPs diferentes (robô) não podem inchar a memória: de vez em quando joga fora o que já venceu.
    if (this.tentativas.size > 5000) for (const k of [...this.tentativas.keys()]) this.recentes(k, agora);
  }

  // Tira uma tentativa já contada (a que acertou a senha, ou a que o servidor não conseguiu conferir).
  devolver(chave: string, momento: number) {
    const lista = this.tentativas.get(chave);
    const i = lista?.indexOf(momento) ?? -1;
    if (!lista || i < 0) return;
    lista.splice(i, 1);
    if (!lista.length) this.tentativas.delete(chave);
  }

  limpar(chave: string) {
    this.tentativas.delete(chave);
  }

  zerar() {
    this.tentativas.clear();
  }
}

const porEmailEIp = new Contador(5);
const porIp = new Contador(30);
const porConta = new Contador(50);

// Conferências de senha (scrypt) rodando agora no processo. Cada uma gasta CPU e 16 MB de memória.
let conferindo = 0;

// atrasoMs: espera em cada erro, que torna chute em sequência lento. Os testes zeram.
// senhasAoMesmoTempo: teto de scrypts simultâneos no processo (login e aceite de convite).
export const freio = {
  atrasoMs: 600,
  senhasAoMesmoTempo: 8,
  zerar: () => [porEmailEIp, porIp, porConta].forEach((c) => c.zerar()),
};

// Roda fn (que confere ou gera um hash de senha) numa das vagas do processo. Sem vaga, recusa na hora: uma rajada
// vinda de muitos IPs não pode travar o hub inteiro, e quem errou o tempo só precisa tentar de novo em instantes.
// A vaga é pega sem nenhum await antes, então pedidos simultâneos não passam juntos pela última vaga.
export async function comVagaDeSenha<T>(fn: () => Promise<T>): Promise<T> {
  if (conferindo >= freio.senhasAoMesmoTempo) {
    const erro = new MuitasTentativas(1);
    erro.message = "Muitas tentativas ao mesmo tempo. Espere um instante e tente de novo.";
    throw erro;
  }
  conferindo++;
  try {
    return await fn();
  } finally {
    conferindo--;
  }
}

async function esperar() {
  if (freio.atrasoMs > 0) await new Promise((r) => setTimeout(r, freio.atrasoMs));
}

// Confere e-mail e senha com os freios, sem abrir sessão. Devolve a conta. Serve ao login e ao aceite de convite de
// quem já tem conta (a pessoa prova que a conta é dela com a senha de sempre).
export async function conferirCredenciais(email: unknown, senha: unknown, meta: MetaDaSessao = {}): Promise<LinhaUsuario> {
  const emailLimpo = normalizarEmail(email) ?? (typeof email === "string" ? email.trim().toLowerCase().slice(0, 200) : "");
  // Sem IP conhecido (fora do proxy do Railway), todos esses pedidos dividem o mesmo freio de IP.
  const ip = meta.ip || "?";
  const emailEIp = `${emailLimpo}|${ip}`;
  const freios: [Contador, string][] = [
    [porEmailEIp, emailEIp],
    [porIp, ip],
    [porConta, emailLimpo],
  ];
  const agora = Date.now();

  // Daqui até a tentativa ser contada não há await: é isso que segura a rajada em paralelo.
  const esperas = freios.map(([contador, chave]) => contador.espera(chave, agora)).filter((ms): ms is number => ms !== null);
  if (esperas.length) {
    await esperar();
    throw new MuitasTentativas(Math.max(1, Math.ceil(Math.max(...esperas) / 60_000)));
  }

  const { linha, senhaOk } = await comVagaDeSenha(async () => {
    for (const [contador, chave] of freios) contador.contar(chave, agora);
    try {
      const [linha] = emailLimpo ? await banco().select().from(usuarios).where(eq(usuarios.email, emailLimpo)).limit(1) : [];
      // Sem conta, confere contra um hash qualquer: o tempo de resposta fica igual e não entrega quem tem conta.
      const senhaOk = await conferirSenha(typeof senha === "string" ? senha : "", linha?.senhaHash ?? (await hashDeMentira()));
      return { linha, senhaOk };
    } catch (err) {
      // Falha do servidor (ex.: banco fora) não é chute de senha: a tentativa não conta.
      for (const [contador, chave] of freios) contador.devolver(chave, agora);
      throw err;
    }
  });

  if (!linha?.senhaHash || !senhaOk) {
    await esperar();
    throw new CredenciaisInvalidas();
  }

  porEmailEIp.limpar(emailEIp);
  porIp.devolver(ip, agora);
  porConta.devolver(emailLimpo, agora);
  return linha;
}

// Entra na conta e abre a sessão na última organização usada (ou na primeira ativa). Conta sem nenhuma organização
// ativa também entra: a tela "sem acesso" explica e diz como pedir um convite.
export async function entrar(email: unknown, senha: unknown, meta: MetaDaSessao = {}) {
  const linha = await conferirCredenciais(email, senha, meta);
  const sessao = await criarSessao(linha.id, meta);
  const usuario = (await usuarioNaOrganizacao(linha.id, sessao.organizacaoId))!;
  return { usuario, token: sessao.token, expiraEm: sessao.expiraEm };
}

export async function sair(token: string | null | undefined) {
  await encerrarSessao(token);
}
