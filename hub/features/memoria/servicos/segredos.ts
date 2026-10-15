import "server-only";

import { SegredoDetectado } from "@/features/memoria/erros";

// Barreira de segredo: a Memória é lida por todos os agentes e pessoas com a chave "memoria", então chave, token e
// senha nunca entram. IDs de conta de anúncio, voice_id, ID de avatar, ID de projeto do FLORA e URLs comuns
// não são segredo (regra do arquivo 21 do Sávio) e precisam passar.
//
// Inclui a varredura do arquivo 21 do Sávio (sk-, xi-api-key, api_key/secret/token/senha/password, Bearer, ghp_,
// AKIA, EAA e CPF), com um ajuste: lá ela roda sobre o diff e aceita falso alarme (a pessoa revisa); aqui ela recusa
// a gravação, então as palavras soltas (password, xi-api-key, Bearer) só contam quando vêm acompanhadas de um valor.
// Sem isso, o próprio arquivo 21, que mostra a varredura, seria recusado.

type Padrao = { motivo: string; re: RegExp };

const PADROES: Padrao[] = [
  { motivo: "chave da Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { motivo: "chave sk-", re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{20,}/ },
  { motivo: "chave ak_", re: /\bak_[A-Za-z0-9]{16,}/ },
  { motivo: "segredo de webhook", re: /\bwhsec_[A-Za-z0-9+/=_-]{16,}/ },
  { motivo: "token do GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { motivo: "token do Slack", re: /\bxox[abp]-[A-Za-z0-9-]{10,}/ },
  { motivo: "chave da AWS", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { motivo: "chave privada", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  // JWT: cabeçalho e corpo são JSON em base64url, por isso começam com "eyJ".
  { motivo: "token JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}/ },
  { motivo: "token Bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { motivo: "token da Meta", re: /\bEAA[A-Za-z0-9]{20,}/ },
  { motivo: "chave da ElevenLabs", re: /xi-api-key["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/i },
  { motivo: "número de CPF", re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
];

// "api_key: valor", "senha=valor", "access_token=valor"... com valor de mais de 12 caracteres. Sem \b no começo,
// para pegar "access_token" e "client_secret"; o \b do fim evita "secretaria" e "tokens".
const ATRIBUICAO = /(api[_-]?key|secret|token|senha|password)\b["'*_`]*\s*[:=]\s*[*_"'`]*\s*([^\s"'`,;*)<>]{13,})/gi;

// O valor parece segredo (tem número, ou mistura maiúscula e minúscula) e não é uma frase com hífen
// ("precisa-de-revisao-manual") nem um endereço.
function pareceSegredo(valor: string): boolean {
  if (/^https?:\/\//i.test(valor)) return false;
  const temNumero = /\d/.test(valor);
  const misturaCaixa = /[a-z]/.test(valor) && /[A-Z]/.test(valor);
  return temNumero || misturaCaixa;
}

// Motivo do primeiro segredo encontrado, ou null.
export function acharSegredo(texto: string): string | null {
  for (const p of PADROES) if (p.re.test(texto)) return p.motivo;
  for (const m of texto.matchAll(ATRIBUICAO)) {
    if (pareceSegredo(m[2])) return `${m[1].toLowerCase()} com valor`;
  }
  return null;
}

// Lança SegredoDetectado se qualquer um dos textos tiver segredo.
export function barrarSegredos(...textos: (string | null | undefined)[]) {
  for (const t of textos) {
    if (!t) continue;
    const motivo = acharSegredo(t);
    if (motivo) throw new SegredoDetectado(motivo);
  }
}
