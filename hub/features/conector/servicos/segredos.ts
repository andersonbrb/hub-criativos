import "server-only";

import { createHash, randomBytes } from "node:crypto";

// Geração e hash dos segredos do conector (código, tokens e links).
//
// SÓ O HASH VAI PARA O BANCO. O valor em texto existe apenas na resposta ao Claude. SHA-256 simples, sem sal nem
// custo, basta porque o segredo já nasce aleatório com 256 bits: não há dicionário para atacar, ao contrário de uma
// senha escolhida por gente.
//
// O PREFIXO não é segurança, é reconhecimento: um token vazado num log é identificável como "do conector do hub" à
// primeira vista, e varredura de segredo acha pelo começo.

export const PREFIXO_CODIGO = "hub_ac_";
export const PREFIXO_ACESSO = "hub_at_";
export const PREFIXO_RENOVACAO = "hub_rt_";
export const PREFIXO_LINK = "hub_lk_";

export const novo = (prefixo: string) => prefixo + randomBytes(32).toString("base64url");

// Identificador aleatório (id de pedido, client_id). Não é credencial.
export const novoId = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const hashDe = (valor: unknown) => createHash("sha256").update(String(valor ?? ""), "utf8").digest("hex");
