import { listarMembros } from "@/features/acesso/servicos/membros";
import { route } from "@/lib/server/http";

export const GET = route(async () => Response.json({ membros: await listarMembros() }), { chave: "membros" });
