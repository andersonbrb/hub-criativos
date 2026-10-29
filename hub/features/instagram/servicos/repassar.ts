import "server-only";

import type { User } from "@sbs/contracts";

import { ehAdmin, type Usuario } from "@/features/acesso/contrato";

import { encodeUser, USER_HEADER } from "../servidor/composition/current-user";
import { instagram } from "./plataforma";

// Repassa um pedido do navegador às rotas do Instagram (o Fastify em processo, servidor/http/server.ts), com a pessoa
// do login do hub. O caminho é o que vem depois de /api/instagram (ex.: /markets, /content-pieces/<id>/decision).

const CORPO_MAXIMO = 2 * 1024 * 1024;

export function pessoaDoInstagram(usuario: Usuario): User {
  return { id: usuario.id, name: usuario.nome, email: usuario.email, role: ehAdmin(usuario) ? "admin" : "reviewer" };
}

export async function repassar(request: Request, caminho: string, pessoa: User | null): Promise<Response> {
  const { app } = await instagram();
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  // Só o hub diz quem é a pessoa: o que vier do navegador neste cabeçalho é descartado.
  if (pessoa) headers[USER_HEADER] = encodeUser(pessoa);
  let payload: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    payload = await request.text();
    if (payload.length > CORPO_MAXIMO) return Response.json({ code: "too_large", message: "Pedido grande demais." }, { status: 413 });
    if (!payload) payload = undefined;
  }
  // O tipo vai só com corpo (um POST vazio com "application/json" seria recusado).
  const tipo = request.headers.get("content-type");
  if (tipo && payload !== undefined) headers["content-type"] = tipo;
  const resposta = await app.inject({
    method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
    url: `${caminho}${url.search}`,
    headers,
    ...(payload !== undefined ? { payload } : {}),
  });
  const saida = new Headers();
  for (const nome of ["content-type", "cache-control", "location"]) {
    const valor = resposta.headers[nome];
    if (typeof valor === "string") saida.set(nome, valor);
  }
  saida.set("x-content-type-options", "nosniff");
  return new Response(resposta.statusCode === 204 ? null : new Uint8Array(resposta.rawPayload), { status: resposta.statusCode, headers: saida });
}
