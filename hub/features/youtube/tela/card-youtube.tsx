"use client";

import { Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { StatusYoutube } from "@/features/youtube/contrato";
import { AVISOS_DO_LOGIN, ehMotivoDoLogin } from "@/features/youtube/tela/avisos";
import { ListaDeEnvios, useEnvios } from "@/features/youtube/tela/lista-de-envios";
import { CaixaDeStatus, CartaoDeIntegracao, LinkDoRodape } from "@/features/integracoes/tela/cartao";

// Card do YouTube na tela Integrações: qual canal recebe os vídeos desta organização, Conectar/Trocar/Desconectar e
// os envios (agendados e recentes), com cancelar e tentar de novo. O cliente do Google é o mesmo do card do Drive.

const ENTRAR = `/api/integracoes/youtube/login?volta=${encodeURIComponent("/integracoes")}`;

type Retorno = { youtube: string | null; motivo: string | null };

export function CardYoutube({ status, falta, retorno, podeVerEnvios }: { status: StatusYoutube; falta: string | null; retorno: Retorno; podeVerEnvios: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [saindo, setSaindo] = useState(false);
  const { conectado, canal } = status;
  const { envios, recarregar } = useEnvios(null, conectado && podeVerEnvios);

  // Aviso da volta do Google (?youtube=conectado ou ?youtube=erro&motivo=...). Depois limpa a URL.
  useEffect(() => {
    if (!retorno.youtube) return;
    if (retorno.youtube === "conectado") toast.success("YouTube conectado. Os vídeos prontos já podem ir para o canal.");
    else if (retorno.motivo === "cancelado") toast(AVISOS_DO_LOGIN.cancelado);
    else toast.error(AVISOS_DO_LOGIN[ehMotivoDoLogin(retorno.motivo) ? retorno.motivo : "erro"]);
    const resto = new URLSearchParams(window.location.search);
    resto.delete("youtube");
    resto.delete("motivo");
    router.replace(resto.size ? `${pathname}?${resto}` : pathname, { scroll: false });
  }, [retorno.youtube, retorno.motivo, pathname, router]);

  const desconectar = async () => {
    if (
      !confirm(
        `Desconectar o canal ${canal?.titulo ?? ""} do hub? Os vídeos já enviados continuam no YouTube. Os envios agendados deste canal são cancelados.`,
      )
    )
      return;
    setSaindo(true);
    try {
      const res = await fetch("/api/integracoes/youtube/status", { method: "DELETE" });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não deu para desconectar agora. Tente de novo.");
      toast.success("YouTube desconectado.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para desconectar agora. Tente de novo.");
    } finally {
      setSaindo(false);
    }
  };

  const precisaRefazer = !conectado && canal !== null;
  const rodape = conectado ? (
    <>
      <Button size="sm" variant="outline" asChild>
        <a href={ENTRAR}>
          <RefreshCw />
          Trocar canal
        </a>
      </Button>
      {canal && <LinkDoRodape href={canal.endereco}>Abrir o canal</LinkDoRodape>}
    </>
  ) : status.configurado ? (
    falta ? (
      <Button size="sm" disabled>
        <Plug />
        Conectar YouTube
      </Button>
    ) : (
      <Button size="sm" asChild>
        <a href={ENTRAR}>
          <Plug />
          Conectar YouTube
        </a>
      </Button>
    )
  ) : null;

  const pendentes = envios?.filter((e) => e.situacao === "agendado" || e.situacao === "enviando").length ?? 0;

  return (
    <CartaoDeIntegracao logo={{ src: "/logos/youtube.svg" }} nome="YouTube" descricao="Envie os vídeos prontos para o canal, na hora ou agendados." rodape={rodape}>
      {conectado && canal && (
        <CaixaDeStatus
          titulo={canal.titulo}
          detalhe="Canal do YouTube"
          acoes={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={saindo}
              onClick={desconectar}
              aria-label="Desconectar o YouTube"
              title="Desconectar"
            >
              {saindo ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          }
        />
      )}
      {precisaRefazer && <CaixaDeStatus titulo={canal.titulo} selo="Parou de valer" tom="aviso" detalhe="Conecte de novo" />}
      {(falta || !status.configurado) && <p className="text-xs break-words text-warn">{falta ?? "Falta configurar o cliente do Google no card do Google Drive."}</p>}
      {!conectado && status.configurado && !falta && (
        <p className="text-xs text-muted-foreground">Na tela do Google, escolha a conta e o canal e deixe marcadas as permissões do YouTube.</p>
      )}
      {conectado && podeVerEnvios && envios && envios.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Envios {pendentes > 0 ? `(${pendentes} na fila ou agendados)` : "recentes"}
          </summary>
          <div className="pt-2">
            <ListaDeEnvios envios={envios} aoMudar={() => void recarregar()} mostrarTitulo />
          </div>
        </details>
      )}
    </CartaoDeIntegracao>
  );
}
