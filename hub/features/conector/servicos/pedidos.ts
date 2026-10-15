import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { banco } from "@/db/cliente";
import { oauthClientes, oauthCodigos, oauthPedidos } from "@/db/schema";
import type { Usuario } from "@/features/acesso/contrato";
import {
  APPS,
  TEXTO_PEDIDO_INCOMPLETO,
  TEXTO_PEDIDO_USADO,
  TEXTO_PEDIDO_VENCIDO,
  type PedidoNaTela,
} from "@/features/conector/contrato";
import { VALIDADE_CODIGO_MS } from "@/features/conector/servicos/config";
import { registrarEvento } from "@/features/conector/servicos/conexoes";
import { appDoRedirect, comParametros, ehLoopback, hostDoDestino } from "@/features/conector/servicos/oauth";
import { PREFIXO_CODIGO, hashDe, novo } from "@/features/conector/servicos/segredos";

// O consentimento: a tela /conectar-claude mostra o pedido, e a pessoa logada autoriza ou recusa. É aqui que a pessoa
// prova quem é antes de o Claude receber qualquer coisa; o /oauth2/authorize só valida o pedido e manda para a tela.

async function carregar(id: string) {
  if (!id || id.length > 100) return null;
  const [linha] = await banco()
    .select({ pedido: oauthPedidos, clienteNome: oauthClientes.nome })
    .from(oauthPedidos)
    .innerJoin(oauthClientes, eq(oauthClientes.id, oauthPedidos.clienteId))
    .where(eq(oauthPedidos.id, id))
    .limit(1);
  return linha ?? null;
}

export async function pedidoParaTela(id: string, usuario: Usuario): Promise<PedidoNaTela> {
  if (!id) return { estado: "invalido", mensagem: TEXTO_PEDIDO_INCOMPLETO };
  const linha = await carregar(id);
  if (!linha || linha.pedido.expiraEm.getTime() <= Date.now()) return { estado: "vencido", mensagem: TEXTO_PEDIDO_VENCIDO };
  if (linha.pedido.decididoEm) return { estado: "usado", mensagem: TEXTO_PEDIDO_USADO };
  const { pedido } = linha;
  const app = APPS[appDoRedirect(pedido.redirectUri)];
  return {
    estado: "pronto",
    pedidoId: pedido.id,
    app,
    clienteNome: linha.clienteNome || app,
    destinoHost: hostDoDestino(pedido.redirectUri),
    destinoLocal: ehLoopback(pedido.redirectUri),
    expiraEm: pedido.expiraEm.toISOString(),
    pessoa: { nome: usuario.nome, email: usuario.email },
  };
}

export type Decisao = { status: number; corpo: { redirect: string } | { error: string } };

// Autorizar cria o código de uso único (60 s) e devolve o endereço de volta do Claude com code, state e iss.
// Recusar devolve o Claude com error=access_denied, para ele parar de esperar.
export async function decidirPedido(id: string, usuario: Usuario, decisao: "autorizar" | "recusar", base: string, ip: string | null): Promise<Decisao> {
  const linha = await carregar(id);
  if (!linha || linha.pedido.expiraEm.getTime() <= Date.now()) return { status: 404, corpo: { error: TEXTO_PEDIDO_VENCIDO } };
  if (linha.pedido.decididoEm) return { status: 409, corpo: { error: TEXTO_PEDIDO_USADO } };
  const { pedido } = linha;
  const agora = new Date();
  const codigo = novo(PREFIXO_CODIGO);

  const marcou = await banco().transaction(async (tx) => {
    // Condicional: dois cliques, uma decisão.
    const feito = await tx
      .update(oauthPedidos)
      .set({ decididoEm: agora, decisao: decisao === "autorizar" ? "autorizado" : "recusado", decididoPor: usuario.id })
      .where(and(eq(oauthPedidos.id, pedido.id), isNull(oauthPedidos.decididoEm), gt(oauthPedidos.expiraEm, agora)))
      .returning({ id: oauthPedidos.id });
    if (!feito.length) return false;
    if (decisao === "autorizar") {
      await tx.insert(oauthCodigos).values({
        codigoHash: hashDe(codigo),
        clienteId: pedido.clienteId,
        usuarioId: usuario.id,
        redirectUri: pedido.redirectUri,
        codeChallenge: pedido.codeChallenge,
        resource: pedido.resource,
        escopos: pedido.escopos,
        ip,
        expiraEm: new Date(agora.getTime() + VALIDADE_CODIGO_MS),
      });
    }
    return true;
  });
  if (!marcou) return { status: 409, corpo: { error: TEXTO_PEDIDO_USADO } };

  const state = pedido.state || null;
  if (decisao === "recusar") {
    registrarEvento("recusada", { usuario: usuario.id, cliente: linha.clienteNome });
    return {
      status: 200,
      corpo: {
        redirect: comParametros(pedido.redirectUri, {
          error: "access_denied",
          error_description: "A conexão foi recusada no Hub de Criativos.",
          state,
          iss: base,
        }),
      },
    };
  }
  registrarEvento("autorizada", { usuario: usuario.id, cliente: linha.clienteNome, app: appDoRedirect(pedido.redirectUri), ip });
  return { status: 200, corpo: { redirect: comParametros(pedido.redirectUri, { code: codigo, state, iss: base }) } };
}
