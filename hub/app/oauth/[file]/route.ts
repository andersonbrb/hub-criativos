import { callbackPath, clientMetadataUrl, isMcpService, PUBLIC_URL } from "@/lib/server/mcp-client";

// Documento de metadados do hub como cliente OAuth (CIMD), público, para serviços sem registro dinâmico (ElevenLabs e HeyGen).
// O client_id é a própria URL deste documento. Lista os endereços de volta do hub no PC e na nuvem.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/-client\.json$/, "");
  if (!file.endsWith("-client.json") || !isMcpService(id)) return new Response("Não encontrado", { status: 404 });
  const redirects = [
    `${PUBLIC_URL}${callbackPath(id)}`,
    `http://localhost:3000${callbackPath(id)}`,
    `http://127.0.0.1:3000${callbackPath(id)}`,
    ...(process.env.HUB_EXTRA_REDIRECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((o) => `${o.replace(/\/$/, "")}${callbackPath(id)}`),
  ];
  return Response.json(
    {
      client_id: clientMetadataUrl(id),
      client_name: "Hub de Criativos",
      client_uri: PUBLIC_URL,
      redirect_uris: redirects,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
