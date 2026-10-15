import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { concluirLogin, ErroNoLoginDoDrive, origemPublica } from "@/features/drive/servicos/conta";
import type { MotivoDoLogin } from "@/features/drive/tela/avisos";
import { route } from "@/lib/server/http";

// Volta do Google depois da autorização: troca o código pelos tokens, grava a conta e leva a pessoa de volta à tela
// de onde saiu (?drive=conectado). Qualquer falha volta para Integrações com um código de aviso (tela/avisos.ts).
// Location relativo: atrás do proxy do Railway o host de request.url pode ser o interno.
const ir = (destino: string) => new Response(null, { status: 303, headers: { Location: destino } });
const comErro = (motivo: MotivoDoLogin) => ir(`/integracoes?drive=erro&motivo=${motivo}`);

export const GET = route(
  async (request: Request) => {
    const usuario = await exigirUsuario("integracoes");
    const q = new URL(request.url).searchParams;
    // access_denied: a pessoa clicou em "Cancelar" na tela do Google.
    const erroDoGoogle = q.get("error");
    if (erroDoGoogle) return comErro(erroDoGoogle === "access_denied" ? "cancelado" : "google");
    const code = q.get("code");
    if (!code) return comErro("erro");
    try {
      return ir(await concluirLogin(code, q.get("state") ?? "", origemPublica(request), usuario.id));
    } catch (err) {
      console.error("[drive] volta do login:", err instanceof Error ? err.message : err);
      return comErro(err instanceof ErroNoLoginDoDrive ? err.motivo : "erro");
    }
  },
  { chave: "integracoes" },
);
