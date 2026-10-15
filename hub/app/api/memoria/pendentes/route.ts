import { pendentesDeRevisao } from "@/features/memoria/servicos/memoria";
import { route } from "@/lib/server/http";

// Fila de revisão: documentos marcados com "precisa de revisão".
export const GET = route(async () => Response.json({ documentos: await pendentesDeRevisao() }), { chave: "memoria" });
