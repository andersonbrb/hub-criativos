import { route } from "@/lib/server/http";
import { listLooks } from "@/lib/server/providers/heygen";

export const GET = route(async (request: Request) => {
  const ownership = new URL(request.url).searchParams.get("ownership") === "public" ? "public" : "private";
  return Response.json({ looks: await listLooks(ownership) });
});
