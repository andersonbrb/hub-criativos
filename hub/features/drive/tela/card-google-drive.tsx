"use client";

import { CloudUpload, ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PASTA_RAIZ, type StatusDrive } from "@/features/drive/contrato";
import { AVISOS_DO_LOGIN, ehMotivoDoLogin } from "@/features/drive/tela/avisos";
import type { ResumoDaChave } from "@/features/integracoes/contrato";
import { CampoDeChave } from "@/features/integracoes/tela/campo-de-chave";

// Card do Google Drive na tela Integrações: qual conta guarda os vídeos, quanto espaço ela tem, Conectar/Desconectar
// e o botão que leva para o Drive os vídeos que ainda estão no disco do hub.

// Formato de GET e POST /api/drive/migrar (rotas do agente Vídeos no Drive).
export type ProgressoDaMigracao = { rodando: boolean; total: number; feitos: number; falhas: number; ultimoErro: string | null };

const ENTRAR = `/api/integracoes/google-drive/login?volta=${encodeURIComponent("/integracoes")}`;
const INTERVALO_DA_CONSULTA_MS = 3000;

// Base 1024, como o próprio Google conta: os 15 GB do plano gratuito aparecem como "15 GB".
export function formatarBytes(bytes: number): string {
  const unidades = ["bytes", "KB", "MB", "GB", "TB"];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: i >= 3 ? 1 : 0 }).format(valor)} ${unidades[i]}`;
}

async function consultarMigracao(init?: RequestInit): Promise<ProgressoDaMigracao> {
  const res = await fetch("/api/drive/migrar", init);
  const dados = (await res.json().catch(() => ({}))) as Partial<ProgressoDaMigracao> & { error?: string };
  if (!res.ok) throw new Error(dados.error ?? `Erro ${res.status}`);
  return dados as ProgressoDaMigracao;
}

// Quantos vídeos ainda estão no disco do hub esperando para ir ao Drive (eles vão sozinhos, aos poucos).
async function consultarFila(): Promise<number> {
  const res = await fetch("/api/integracoes/google-drive/status");
  const dados = (await res.json().catch(() => ({}))) as { naFila?: unknown };
  return res.ok && typeof dados.naFila === "number" ? dados.naFila : 0;
}

type Retorno = { drive: string | null; motivo: string | null };

// O cliente OAuth do Google (criado uma vez no Google Cloud) é colado aqui, no lugar das variáveis do servidor.
type Cliente = { id: ResumoDaChave; segredo: ResumoDaChave };

const CREDENCIAIS_DO_GOOGLE = { texto: "Google Cloud → APIs e serviços → Credenciais", href: "https://console.cloud.google.com/apis/credentials" };

function CamposDoCliente({ cliente }: { cliente: Cliente }) {
  return (
    <div className="space-y-2">
      <CampoDeChave nome="google-client-id" resumo={cliente.id} exemplo="....apps.googleusercontent.com" ajuda={CREDENCIAIS_DO_GOOGLE} />
      <CampoDeChave nome="google-client-secret" resumo={cliente.segredo} exemplo="GOCSPX-..." />
    </div>
  );
}

export function CardGoogleDrive({ status, falta, retorno, cliente }: { status: StatusDrive; falta: string | null; retorno: Retorno; cliente: Cliente }) {
  const router = useRouter();
  const pathname = usePathname();
  const [saindo, setSaindo] = useState(false);
  const [migracao, setMigracao] = useState<ProgressoDaMigracao | null>(null);
  const [comecando, setComecando] = useState(false);
  const [semAcompanhar, setSemAcompanhar] = useState(false);
  const [naFila, setNaFila] = useState(0);
  const rodavaAntes = useRef(false);

  // Aviso da volta do Google (?drive=conectado ou ?drive=erro&motivo=...). Depois limpa a URL, para o aviso não
  // aparecer de novo ao recarregar.
  useEffect(() => {
    if (!retorno.drive) return;
    if (retorno.drive === "conectado") toast.success("Google Drive conectado. Os vídeos novos vão para lá.");
    else if (retorno.motivo === "cancelado") toast(AVISOS_DO_LOGIN.cancelado);
    else toast.error(AVISOS_DO_LOGIN[ehMotivoDoLogin(retorno.motivo) ? retorno.motivo : "erro"]);
    const resto = new URLSearchParams(window.location.search);
    resto.delete("drive");
    resto.delete("motivo");
    router.replace(resto.size ? `${pathname}?${resto}` : pathname, { scroll: false });
  }, [retorno.drive, retorno.motivo, pathname, router]);

  // Ao abrir a tela: se uma mudança de vídeos antigos já está rodando (começada aqui, em outra aba ou sozinha pelo
  // hub), mostra o progresso dela. E quantos vídeos ainda estão no hub esperando o Drive.
  useEffect(() => {
    if (!status.conectado) return;
    let ativo = true;
    consultarMigracao()
      .then((m) => ativo && setMigracao(m))
      .catch(() => undefined);
    consultarFila()
      .then((n) => ativo && setNaFila(n))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [status.conectado]);

  // Enquanto roda, pergunta o progresso a cada 3 s. Quando termina, avisa e atualiza o espaço usado e a fila.
  useEffect(() => {
    if (!migracao) return;
    if (rodavaAntes.current && !migracao.rodando) {
      const falhas = migracao.falhas ? ` ${migracao.falhas} deram erro.` : "";
      toast.success(`Pronto: ${migracao.feitos} vídeos antigos levados para o Drive.${falhas}`);
      consultarFila()
        .then(setNaFila)
        .catch(() => undefined);
      router.refresh();
    }
    rodavaAntes.current = migracao.rodando;
    if (!migracao.rodando) return;
    const espera = setTimeout(() => {
      consultarMigracao()
        .then(setMigracao)
        .catch(() => setSemAcompanhar(true));
    }, INTERVALO_DA_CONSULTA_MS);
    return () => clearTimeout(espera);
  }, [migracao, router]);

  const levarAntigos = async () => {
    if (!confirm("Levar para o Drive os vídeos que ainda estão guardados no hub? Depois de levados, eles saem do disco do hub e ficam só no Drive.")) return;
    setComecando(true);
    setSemAcompanhar(false);
    try {
      setMigracao(await consultarMigracao({ method: "POST" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para começar agora. Tente de novo.");
    } finally {
      setComecando(false);
    }
  };

  const desconectar = async () => {
    const quem = status.conta?.email ?? "a conta";
    if (
      !confirm(
        `Desconectar o Google Drive (${quem})? Os vídeos continuam no Drive, e o hub volta a abri-los quando esta mesma conta for conectada de novo. Com outra conta, eles somem das listas do hub até esta voltar. Sem conta conectada, os vídeos novos ficam guardados no hub.`,
      )
    )
      return;
    setSaindo(true);
    try {
      const res = await fetch("/api/integracoes/google-drive/status", { method: "DELETE" });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não deu para desconectar agora. Tente de novo.");
      toast.success("Google Drive desconectado.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para desconectar agora. Tente de novo.");
    } finally {
      setSaindo(false);
    }
  };

  const { conectado, conta, espaco } = status;
  const precisaRefazer = !conectado && conta !== null;
  const detalhe = !status.configurado ? "Falta o cliente do Google" : conectado ? `Pasta "${PASTA_RAIZ}" no Drive` : "Nenhuma conta conectada";
  const pctEspaco = espaco?.limite ? Math.min(100, Math.round((espaco.usado / espaco.limite) * 100)) : null;
  const pctMigracao = migracao?.total ? Math.min(100, Math.round(((migracao.feitos + migracao.falhas) / migracao.total) * 100)) : 0;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="font-heading text-base">Google Drive</CardTitle>
        <CardDescription>Onde os vídeos gerados ficam guardados</CardDescription>
        <CardAction>
          <StatusBadge status={conectado ? "ok" : "warn"} label={conectado ? "Conectado" : "Configurar"} />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3 px-4 text-sm">
        <p className="text-muted-foreground">Os vídeos gerados ficam só no Drive desta conta, na pasta {PASTA_RAIZ}.</p>

        {conectado && conta && (
          <div className="space-y-1.5">
            <p className="break-words">
              Conectado como <strong>{conta.nome ?? conta.email}</strong>
              {conta.nome && <span className="text-muted-foreground"> ({conta.email})</span>}
            </p>
            {espaco && (
              <>
                {pctEspaco !== null && <Progress value={pctEspaco} aria-label="Espaço usado no Drive" />}
                <p className="text-xs text-muted-foreground">
                  {espaco.limite
                    ? `${formatarBytes(espaco.usado)} de ${formatarBytes(espaco.limite)} usados (${pctEspaco}%)`
                    : `${formatarBytes(espaco.usado)} usados (sem limite de espaço)`}
                </p>
              </>
            )}
          </div>
        )}

        {precisaRefazer && <p className="text-warn">A conexão com {conta.email} parou de valer. Conecte de novo.</p>}
        {!conectado && !precisaRefazer && !falta && (
          <p className="text-muted-foreground">Nenhuma conta conectada. Até conectar, os vídeos novos ficam guardados no próprio hub.</p>
        )}
        {falta && <p className="break-words text-warn">{falta}</p>}
        {!status.configurado ? (
          <CamposDoCliente cliente={cliente} />
        ) : (
          !conectado && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Cliente do Google</summary>
              <div className="pt-2">
                <CamposDoCliente cliente={cliente} />
              </div>
            </details>
          )
        )}

        {conectado && (
          <div className="space-y-2 border-t pt-3">
            {migracao?.rodando ? (
              <>
                <p>
                  Levando vídeos antigos para o Drive: {migracao.feitos} de {migracao.total}
                  {migracao.falhas > 0 && <span className="text-warn"> · {migracao.falhas} com erro</span>}
                </p>
                <Progress value={pctMigracao} aria-label="Vídeos antigos levados para o Drive" />
              </>
            ) : (
              <Button size="xs" variant="outline" onClick={levarAntigos} disabled={comecando}>
                {comecando ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                Levar vídeos antigos para o Drive
              </Button>
            )}
            {!migracao?.rodando && naFila > 0 && (
              <p className="text-xs text-muted-foreground">
                {naFila === 1 ? "1 vídeo ainda no hub, indo para o Drive." : `${naFila} vídeos ainda no hub, indo para o Drive.`}
              </p>
            )}
            {!migracao?.rodando && migracao && migracao.total > 0 && (
              <p className="text-xs text-muted-foreground">
                Última vez: {migracao.feitos} de {migracao.total} levados
                {migracao.falhas > 0 && `, ${migracao.falhas} com erro`}.
              </p>
            )}
            {migracao?.ultimoErro && <p className="text-xs break-words text-warn">Último erro: {migracao.ultimoErro}</p>}
            {semAcompanhar && <p className="text-xs text-warn">Não deu para acompanhar o progresso agora. Recarregue a página para ver.</p>}
          </div>
        )}
      </CardContent>

      <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">{detalhe}</span>
        <span className="flex flex-wrap gap-1.5">
          {conectado ? (
            <>
              <Button size="xs" variant="outline" disabled={saindo} onClick={desconectar}>
                {saindo ? <Loader2 className="animate-spin" /> : <Unplug />}
                Desconectar
              </Button>
              <Button size="xs" variant="outline" asChild>
                <a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Abrir o Drive
                </a>
              </Button>
            </>
          ) : falta ? (
            <Button size="xs" disabled>
              <Plug />
              Conectar
            </Button>
          ) : (
            <Button size="xs" asChild>
              <a href={ENTRAR}>
                <Plug />
                Conectar
              </a>
            </Button>
          )}
        </span>
      </CardFooter>
    </Card>
  );
}
