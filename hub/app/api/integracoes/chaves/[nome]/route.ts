import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { ehNomeDaChave, type NomeDaChave } from "@/features/integracoes/contrato";
import { apagarChave, gravarChave } from "@/features/integracoes/servicos/chaves";
import { conferirChave } from "@/features/integracoes/servicos/conferir";
import { InputError, route } from "@/lib/server/http";

// Chaves das integrações coladas na tela Integrações (Claude, Venice, cliente do Google, modelo do chat).
// PUT { valor } grava ou troca; DELETE remove. A resposta é o resumo da chave: segredo nunca volta inteiro.

type Ctx = { params: Promise<{ nome: string }> };

async function nomeDa(params: Ctx["params"]): Promise<NomeDaChave> {
  const { nome } = await params;
  if (!ehNomeDaChave(nome)) throw new InputError("Chave desconhecida.");
  return nome;
}

export const PUT = route(async (request: Request, { params }: Ctx) => {
  const nome = await nomeDa(params);
  const usuario = await exigirUsuario("integracoes");
  const { valor } = (await request.json().catch(() => ({}))) as { valor?: unknown };
  if (typeof valor === "string" && valor.trim()) await conferirChave(nome, valor.trim());
  return Response.json(await gravarChave(nome, valor, usuario.id));
}, { chave: "integracoes" });

export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  const nome = await nomeDa(params);
  const usuario = await exigirUsuario("integracoes");
  return Response.json(await apagarChave(nome, usuario.id));
}, { chave: "integracoes" });
