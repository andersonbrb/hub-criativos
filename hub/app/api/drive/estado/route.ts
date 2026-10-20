import { podeUsar } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import { driveConectado } from "@/features/drive/servicos/conta";
import { route } from "@/lib/server/http";
import { CHAVES_DE_PRODUCAO } from "@/lib/server/media";

// O Drive da organização aberta está conectado? As telas que geram ou recebem vídeo mostram o aviso quando não está
// (regra do dono: vídeo só fica guardado no Google Drive). `podeConectar`: a pessoa tem a tela Integrações.
export const GET = route<[Request]>(
  async () => {
    const usuario = await exigirUsuario();
    return Response.json(
      { conectado: await driveConectado(), podeConectar: podeUsar(usuario, "integracoes") },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { chave: CHAVES_DE_PRODUCAO },
);
