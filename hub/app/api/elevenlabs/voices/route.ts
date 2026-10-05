import { route } from "@/lib/server/http";
import { listVoices } from "@/lib/server/providers/elevenlabs";

export const GET = route(async () => Response.json({ voices: await listVoices() }));
