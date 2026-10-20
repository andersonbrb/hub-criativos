"use client";

import { ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SITUACOES, VISIBILIDADES, type EnvioYoutube, type SituacaoDoEnvio } from "@/features/youtube/contrato";
import type { Status } from "@/lib/data";
import { apiFetch } from "@/lib/generations";

// Envios para o YouTube: situação de cada um (agendado, enviando, enviado, falhou, cancelado), o link do vídeo, o
// motivo da falha e os botões de cancelar e tentar de novo. Serve à janela do vídeo e ao card de Integrações.

const COR: Record<SituacaoDoEnvio, Status> = { agendado: "idle", enviando: "run", enviado: "ok", falhou: "warn", cancelado: "idle" };

const dataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatarDataHora = (iso: string) => dataHora.format(new Date(iso)).replace(",", " às");

// Envios do vídeo (ou da organização, sem `geracaoId`). Enquanto algum sobe, pergunta a cada 3 s; senão, a cada 30 s.
export function useEnvios(geracaoId: string | null, ativo: boolean) {
  const [envios, setEnvios] = useState<EnvioYoutube[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  const buscar = useCallback(
    () => apiFetch<{ envios: EnvioYoutube[] }>(`/api/youtube/envios${geracaoId ? `?geracao=${encodeURIComponent(geracaoId)}` : ""}`).then((r) => r.envios),
    [geracaoId],
  );

  const recarregar = useCallback(async () => {
    try {
      setEnvios(await buscar());
      setFalhou(false);
    } catch {
      setFalhou(true);
    }
  }, [buscar]);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    buscar()
      .then((lista) => {
        if (!vivo) return;
        setEnvios(lista);
        setFalhou(false);
      })
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [ativo, buscar]);

  const subindo = envios?.some((e) => e.situacao === "enviando") ?? false;
  useEffect(() => {
    if (!ativo || !envios) return;
    const espera = setTimeout(() => void recarregar(), subindo ? 3000 : 30_000);
    return () => clearTimeout(espera);
  }, [ativo, envios, subindo, recarregar]);

  return { envios, falhou, recarregar };
}

export function ListaDeEnvios({ envios, aoMudar, mostrarTitulo = false }: { envios: EnvioYoutube[]; aoMudar: () => void; mostrarTitulo?: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {envios.map((e) => (
        <ItemDoEnvio key={e.id} envio={e} aoMudar={aoMudar} mostrarTitulo={mostrarTitulo} />
      ))}
    </ul>
  );
}

function ItemDoEnvio({ envio: e, aoMudar, mostrarTitulo }: { envio: EnvioYoutube; aoMudar: () => void; mostrarTitulo: boolean }) {
  const [ocupado, setOcupado] = useState(false);

  const agir = async (metodo: "DELETE" | "POST") => {
    if (metodo === "DELETE" && !confirm(e.situacao === "agendado" ? "Cancelar este agendamento? O vídeo não vai para o YouTube." : "Parar este envio? O vídeo não vai para o YouTube."))
      return;
    setOcupado(true);
    try {
      await apiFetch(`/api/youtube/envios/${e.id}`, { method: metodo });
      toast.success(metodo === "DELETE" ? "Envio cancelado." : "Enviando de novo.");
      aoMudar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const visibilidade = VISIBILIDADES[e.visibilidade].rotulo;
  const detalhe =
    e.situacao === "agendado" && e.agendadoPara
      ? `Sai em ${formatarDataHora(e.agendadoPara)} · ${visibilidade}`
      : e.situacao === "enviado" && e.enviadoEm
        ? `Enviado em ${formatarDataHora(e.enviadoEm)} · ${visibilidade}`
        : e.situacao === "enviando"
          ? e.progresso === null
            ? "Esperando a vez…"
            : `Subindo para o YouTube… ${e.progresso}%`
          : `Pedido em ${formatarDataHora(e.criadoEm)} · ${visibilidade}`;

  return (
    <li className="rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {mostrarTitulo && <p className="truncate font-medium">{e.titulo}</p>}
          <p className="text-xs text-muted-foreground">{detalhe}</p>
        </div>
        <StatusBadge status={COR[e.situacao]} label={SITUACOES[e.situacao]} />
      </div>
      {e.situacao === "enviando" && <Progress value={e.progresso ?? 0} className="mt-2 h-1" aria-label="Progresso do envio" />}
      {e.erro && <p className="mt-1.5 text-xs break-words text-destructive">{e.erro}</p>}
      {e.aviso && <p className="mt-1.5 text-xs break-words text-warn">{e.aviso}</p>}
      {(e.link || e.situacao === "agendado" || e.situacao === "enviando" || e.situacao === "falhou") && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {e.link && (
            <Button size="xs" variant="outline" asChild>
              <a href={e.link} target="_blank" rel="noreferrer">
                <ExternalLink />
                Abrir no YouTube
              </a>
            </Button>
          )}
          {(e.situacao === "agendado" || e.situacao === "enviando") && (
            <Button size="xs" variant="ghost" disabled={ocupado} onClick={() => agir("DELETE")}>
              {ocupado ? <Loader2 className="animate-spin" /> : <X />}
              {e.situacao === "agendado" ? "Cancelar agendamento" : "Parar envio"}
            </Button>
          )}
          {e.situacao === "falhou" && (
            <Button size="xs" variant="outline" disabled={ocupado} onClick={() => agir("POST")}>
              {ocupado ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Tentar de novo
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
