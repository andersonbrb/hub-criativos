import { indiceDeProjetos } from "@/features/memoria/servicos/memoria";
import { route } from "@/lib/server/http";

// Índice de projetos e lotes, gerado a partir dos documentos tipo "projeto".
export const GET = route(async () => Response.json({ projetos: await indiceDeProjetos() }), { chave: "memoria" });
