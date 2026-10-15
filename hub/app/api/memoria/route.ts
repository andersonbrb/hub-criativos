import type { EntradaSalvar } from "@/features/memoria/contrato";
import { listarIndice, salvar } from "@/features/memoria/servicos/memoria";
import { comConflito, filtroDaUrl, gravacaoDoEditor } from "@/features/memoria/servicos/rotas";
import { route } from "@/lib/server/http";

// Índice da Memória: GET ?tipo=&frente=
export const GET = route(
  async (request: Request) => Response.json({ documentos: await listarIndice(filtroDaUrl(new URL(request.url).searchParams)) }),
  { chave: "memoria" },
);

// Documento novo: { slug, conteudo, tipo, titulo?, frente?, mercado?, noPrompt? (só admin ou dono), metadados?, nota? }
export const POST = route(
  async (request: Request) => {
    const { autor, corpo } = await gravacaoDoEditor(request);
    return comConflito(async () =>
      Response.json({ documento: await salvar({ ...corpo, versaoEsperada: null } as EntradaSalvar, autor) }, { status: 201 }),
    );
  },
  { chave: "memoria_editar" },
);
