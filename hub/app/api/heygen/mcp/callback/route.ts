import { finishLogin } from "@/lib/server/heygen-mcp";

// Volta do login do HeyGen: troca o código pelos tokens e retorna para o estúdio.
export async function GET(request: Request) {
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
}
