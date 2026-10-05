import { route } from "@/lib/server/http";
import { account } from "@/lib/server/providers/higgsfield";

export const GET = route(async () => Response.json(await account()));
