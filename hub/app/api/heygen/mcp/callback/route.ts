import { finishLogin } from "@/lib/server/heygen-mcp";
import { route } from "@/lib/server/http";

// Volta do login do HeyGen: troca o código pelos tokens e retorna para o estúdio. Ligar conta é de Integrações.
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const back = (path: string, status: string) => new Response(null, { status: 302, headers: { Location: `${path}${path.includes("?") ? "&" : "?"}heygen=${status}` } });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code) return back("/estudios/traducao", url.searchParams.get("error") === "access_denied" ? "cancelado" : "erro");
  try {
    return back(await finishLogin(code, state), "conectado");
  } catch (err) {
    console.error("[hub] login HeyGen:", err instanceof Error ? err.message : err);
    return back("/estudios/traducao", "erro");
  }
}, { chave: "integracoes" });
