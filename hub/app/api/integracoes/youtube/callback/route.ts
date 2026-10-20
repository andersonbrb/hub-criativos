import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { concluirLogin, ErroNoLoginDoYoutube } from "@/features/youtube/servicos/conta";
import type { MotivoDoLogin } from "@/features/youtube/tela/avisos";
import { route } from "@/lib/server/http";

// Volta do Google depois da autorização: troca o código pelos tokens, lê o canal escolhido, grava e leva a pessoa de
// volta (?youtube=conectado). Qualquer falha volta para Integrações com um código de aviso (tela/avisos.ts).
const ir = (destino: string) => new Response(null, { status: 303, headers: { Location: destino } });
const comErro = (motivo: MotivoDoLogin) => ir(`/integracoes?youtube=erro&motivo=${motivo}`);

export const GET = route(
  async (request: Request) => {
    const usuario = await exigirUsuario("integracoes");
    const q = new URL(request.url).searchParams;
    const erroDoGoogle = q.get("error");
    if (erroDoGoogle) return comErro(erroDoGoogle === "access_denied" ? "cancelado" : "google");
    const code = q.get("code");
    if (!code) return comErro("erro");
    try {
      return ir(await concluirLogin(code, q.get("state") ?? "", usuario.id));
    } catch (err) {
      console.error("[youtube] volta do login:", err instanceof Error ? err.message : err);
      return comErro(err instanceof ErroNoLoginDoYoutube ? err.motivo : "erro");
    }
  },
  { chave: "integracoes" },
);
