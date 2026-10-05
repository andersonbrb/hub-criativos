import { quoteFlora } from "@/lib/server/actions";
import { route } from "@/lib/server/http";

// Orçamento em dólar (não cobra). JSON: { family, params, count, referenceId?, withImage? }
export const POST = route(async (request: Request) => {
  const body = await request.json();
  return Response.json(await quoteFlora(body));
});
