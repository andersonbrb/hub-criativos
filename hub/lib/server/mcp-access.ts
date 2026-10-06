import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { InputError } from "@/lib/server/http";
import { DATA_DIR } from "@/lib/server/store";

// "Conectar pelo chat": cada pessoa conecta o PRÓPRIO Claude Code (ou Codex) à MCP do hub com um token pessoal.
// Assim quem acessa pela nuvem usa a assinatura dela, e o hub empresta só as ferramentas.
// Guardamos só o hash do token (.data/mcp-access.json). Token novo da mesma pessoa desliga o anterior.

const FILE = path.join(DATA_DIR, "mcp-access.json");

export type Person = { id: string; name: string; hash: string; createdAt: string; lastUsedAt: string | null };
export type PersonView = Omit<Person, "hash">;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

async function load(): Promise<Person[]> {
  try {
    return (JSON.parse(await readFile(FILE, "utf8")) as { people: Person[] }).people ?? [];
  } catch {
    return [];
  }
}

async function save(people: Person[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify({ people }, null, 1));
}

const view = (p: Person): PersonView => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

export async function listPeople(): Promise<PersonView[]> {
  return (await load()).map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Gera um token novo para a pessoa (o anterior dela para de funcionar). O token só aparece aqui, uma vez.
export async function createAccess(name: string): Promise<{ person: PersonView; token: string }> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) throw new InputError("Diga quem vai usar (ex.: Anderson, Darlan).");
  const token = `hub_${randomBytes(24).toString("base64url")}`;
  const people = (await load()).filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
  const person: Person = { id: randomUUID(), name: clean, hash: hashOf(token), createdAt: new Date().toISOString(), lastUsedAt: null };
  await save([...people, person]);
  return { person: view(person), token };
}

export async function revokeAccess(id: string) {
  await save((await load()).filter((p) => p.id !== id));
}

// Confere o token de quem chama a MCP. Atualiza "último uso" no máximo a cada 5 minutos.
export async function verifyAccess(token: string): Promise<PersonView | null> {
  if (!token.startsWith("hub_")) return null;
  const hash = Buffer.from(hashOf(token), "hex");
  const people = await load();
  const person = people.find((p) => {
    const h = Buffer.from(p.hash, "hex");
    return h.length === hash.length && timingSafeEqual(h, hash);
  });
  if (!person) return null;
  if (!person.lastUsedAt || Date.now() - Date.parse(person.lastUsedAt) > 5 * 60_000) {
    person.lastUsedAt = new Date().toISOString();
    await save(people).catch(() => undefined);
  }
  return view(person);
}

// Endereço público do hub (atrás de proxy, como no Railway, request.url é o endereço interno).
export function publicOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto.split(",")[0]}://${host.split(",")[0]}` : new URL(request.url).origin;
}

// O prompt que a pessoa cola no Claude Code / Codex.
export function connectionPrompt(origin: string, token: string, name: string) {
  const url = `${origin}/api/mcp`;
  return `Conecte este computador ao Hub de Criativos (servidor MCP remoto) para ${name}. Use as suas próprias ferramentas de terminal, sem pedir para eu fazer nada à mão.

1. Claude Code: rode
   claude mcp add --transport http --scope user hub-criativos ${url} --header "Authorization: Bearer ${token}"
   (se já existir um servidor "hub-criativos", remova antes com: claude mcp remove hub-criativos --scope user)
   Codex: acrescente em ~/.codex/config.toml
   [mcp_servers.hub-criativos]
   url = "${url}"
   http_headers = { Authorization = "Bearer ${token}" }

2. Confirme a conexão: liste as ferramentas do servidor hub-criativos (ou chame hub_list_generations com limit 1). Se aparecerem ferramentas como flora_generate, elevenlabs_tts e heygen_create_video, a conexão está ok.

3. Me responda em português: "Hub de Criativos conectado" e quantas ferramentas vieram, ou diga exatamente o que falhou. Avise que preciso reiniciar o Claude Code (ou abrir uma conversa nova) para as ferramentas aparecerem, e que os agentes do hub viram comandos: /mcp__hub-criativos__copy, /mcp__hub-criativos__estrategista etc.

Guarde este token só nesta configuração; não o mostre de novo nem o salve em outros arquivos.`;
}
