import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO } from "@/lib/server/media";
import { servirArquivoDeMidia } from "@/lib/server/servir-midia";

// Arquivos gerados (hub/.data/media ou o Google Drive), para as telas de produção. A lógica fica em
// lib/server/servir-midia.ts, que os links públicos do Instagram também usam.
export const GET = route(async (request: Request, { params }: { params: Promise<{ file: string }> }) => {
  return servirArquivoDeMidia(request, (await params).file);
}, { chave: CHAVES_DE_PRODUCAO });
