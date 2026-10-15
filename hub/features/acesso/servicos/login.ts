import "server-only";

import { eq } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { usuarios } from "@/db/schema";
import { ContaDesativada, CredenciaisInvalidas, MuitasTentativas } from "@/features/acesso/erros";
import { conferirSenha, hashDeMentira } from "@/features/acesso/servicos/senha";
import { criarSessao, encerrarSessao, type MetaDaSessao } from "@/features/acesso/servicos/sessoes";
import { normalizarEmail, paraUsuario } from "@/features/acesso/servicos/usuarios";

// Login por e-mail e senha, com freio contra chute de senha: 5 erros em 10 minutos para o mesmo e-mail no mesmo
// IP bloqueiam novas tentativas até a janela passar. A contagem fica na memória do processo (o hub roda num
// processo só); reiniciar o servidor zera o freio, o que é aceitável para o tamanho da equipe.

const JANELA_MS = 10 * 60 * 1000;
const LIMITE = 5;

const erros = new Map<string, number[]>();

// atrasoMs: espera em cada erro, que torna chute em sequência lento. Os testes zeram.
export const freio = {
  atrasoMs: 600,
  zerar: () => erros.clear(),
};

const chaveDoFreio = (email: string, ip: string | null | undefined) => `${email}|${ip || "?"}`;

function errosRecentes(chave: string, agora: number) {
  const recentes = (erros.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length) erros.set(chave, recentes);
  else erros.delete(chave);
  return recentes;
}

async function esperar() {
  if (freio.atrasoMs > 0) await new Promise((r) => setTimeout(r, freio.atrasoMs));
}

async function registrarErro(chave: string, agora: number) {
  erros.set(chave, [...errosRecentes(chave, agora), agora]);
  // Muitos e-mails diferentes (robô) não podem inchar a memória: de vez em quando joga fora o que já venceu.
  if (erros.size > 5000) for (const k of [...erros.keys()]) errosRecentes(k, agora);
  await esperar();
}

export async function entrar(email: unknown, senha: unknown, meta: MetaDaSessao = {}) {
  const emailLimpo = normalizarEmail(email) ?? (typeof email === "string" ? email.trim().toLowerCase().slice(0, 200) : "");
  const chave = chaveDoFreio(emailLimpo, meta.ip);
  const agora = Date.now();

  const recentes = errosRecentes(chave, agora);
  if (recentes.length >= LIMITE) {
    await esperar();
    throw new MuitasTentativas(Math.max(1, Math.ceil((recentes[0] + JANELA_MS - agora) / 60_000)));
  }

  const [linha] = emailLimpo ? await banco().select().from(usuarios).where(eq(usuarios.email, emailLimpo)).limit(1) : [];
  // Sem conta, confere contra um hash qualquer: o tempo de resposta fica igual e não entrega quem tem conta.
  const senhaOk = await conferirSenha(typeof senha === "string" ? senha : "", linha?.senhaHash ?? (await hashDeMentira()));
  if (!linha?.senhaHash || !senhaOk) {
    await registrarErro(chave, agora);
    throw new CredenciaisInvalidas();
  }

  erros.delete(chave);
  if (!linha.ativo) throw new ContaDesativada();
  const sessao = await criarSessao(linha.id, meta);
  return { usuario: paraUsuario(linha), token: sessao.token, expiraEm: sessao.expiraEm };
}

export async function sair(token: string | null | undefined) {
  await encerrarSessao(token);
}
