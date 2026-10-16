import { tokenDeAcesso } from "@/features/drive/servicos/conta";
import { escolherPasta, voltarParaMeuDrive } from "@/features/drive/servicos/pastas";
import { lerChave } from "@/features/integracoes/servicos/chaves";
import { InputError, route } from "@/lib/server/http";

// Pasta do Drive onde fica a "Hub de Criativos" (cartão do Drive, tela Integrações). Só com a chave "integracoes".
//
// GET: o que a janela de pastas do Google (Picker) precisa no navegador. O token de acesso vai junto porque a janela
// age como o hub: só assim a pasta escolhida fica liberada para ele (escopo drive.file). Vale ~1 hora e só abre o que
// o hub criou ou o que a pessoa escolher, e quem chega aqui já pode conectar e desconectar o Drive.
// POST { id }: grava a pasta escolhida. DELETE: volta para a raiz do Meu Drive.

export const GET = route<[Request]>(
  async () => {
    const [chave, cliente] = await Promise.all([lerChave("google-api-key"), lerChave("google-client-id")]);
    if (!chave) throw new InputError("Cole antes a chave de API do Google, no cartão do Drive.");
    // O número do projeto no Google Cloud é o começo do ID do cliente ("123456789012-abc.apps.googleusercontent.com").
    const projeto = cliente?.match(/^(\d+)-/)?.[1];
    if (!projeto) throw new InputError("O ID do cliente do Google parece errado. Confira no cartão do Drive.");
    return Response.json({ token: await tokenDeAcesso(), chave, projeto }, { headers: { "Cache-Control": "no-store" } });
  },
  { chave: "integracoes" },
);

export const POST = route(
  async (request: Request) => {
    const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
    return Response.json({ pasta: await escolherPasta(id) });
  },
  { chave: "integracoes" },
);

export const DELETE = route<[Request]>(
  async () => {
    await voltarParaMeuDrive();
    return Response.json({ pasta: null });
  },
  { chave: "integracoes" },
);
