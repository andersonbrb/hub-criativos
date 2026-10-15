import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

import { SENHA_MINIMA } from "@/features/acesso/contrato";
import { SenhaFraca } from "@/features/acesso/erros";

// Senha guardada como "scrypt$N$r$p$salt$hash" (salt e hash em base64url). Os parâmetros vão junto para que dê
// para endurecer o custo no futuro sem invalidar as senhas antigas.
const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 64;
// Teto de memória do scrypt bem acima do que N=16384, r=8 usa (16 MB), para não falhar em parâmetros antigos maiores.
const MEMORIA_MAXIMA = 64 * 1024 * 1024;
// Senha gigante só serve para gastar CPU do servidor.
const SENHA_MAXIMA = 200;

const derivar = (senha: string, salt: Buffer, opcoes: ScryptOptions, tamanho: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(senha.normalize("NFKC"), salt, tamanho, { ...opcoes, maxmem: MEMORIA_MAXIMA }, (err, chave) => (err ? reject(err) : resolve(chave))),
  );

export function validarSenha(senha: unknown): string {
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) throw new SenhaFraca(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  if (senha.length > SENHA_MAXIMA) throw new SenhaFraca(`A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`);
  return senha;
}

export async function gerarHashDeSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derivar(senha, salt, { N, r: R, p: P }, TAMANHO);
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function conferirSenha(senha: string, guardado: string | null | undefined): Promise<boolean> {
  if (!guardado || typeof senha !== "string" || senha.length > SENHA_MAXIMA) return false;
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [n, r, p] = partes.slice(1, 4).map(Number);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(partes[4], "base64url");
  const esperado = Buffer.from(partes[5], "base64url");
  if (!salt.length || !esperado.length) return false;
  try {
    const calculado = await derivar(senha, salt, { N: n, r, p }, esperado.length);
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

// Hash de uma senha que ninguém tem: o login confere contra ele quando o e-mail não existe, para o tempo de
// resposta não revelar quais e-mails têm conta.
let hashFalso: Promise<string> | null = null;
export const hashDeMentira = () => (hashFalso ??= gerarHashDeSenha(randomBytes(24).toString("base64url")));

// Senha forte para o script criar-dono: 24 caracteres de base64url (144 bits).
export const gerarSenhaForte = () => randomBytes(18).toString("base64url");
