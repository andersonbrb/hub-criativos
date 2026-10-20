import { podeUsar } from "@/features/acesso/contrato";
import { exigirUsuario } from "@/features/acesso/servicos/sessao";
import type { EstadoDoEnvio } from "@/features/youtube/contrato";
import { canalConectado } from "@/features/youtube/servicos/conta";
import { route } from "@/lib/server/http";

// Para o botão "Enviar para o YouTube" dos vídeos prontos: se a pessoa pode enviar e para qual canal.
// Quem não tem a chave "youtube" recebe só { podeEnviar: false } (o botão nem aparece).
export const GET = route<[Request]>(async () => {
  const eu = await exigirUsuario();
  if (!podeUsar(eu, "youtube")) return Response.json({ podeEnviar: false, conectado: false, canal: null } satisfies EstadoDoEnvio);
  const canal = await canalConectado().catch(() => null);
  return Response.json({ podeEnviar: true, conectado: Boolean(canal), canal } satisfies EstadoDoEnvio);
});
