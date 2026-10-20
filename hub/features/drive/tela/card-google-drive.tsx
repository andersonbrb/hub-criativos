"use client";

import { CloudUpload, Loader2, Plug, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PASTA_RAIZ, type StatusDrive } from "@/features/drive/contrato";
import { AVISOS_DO_LOGIN, ehMotivoDoLogin } from "@/features/drive/tela/avisos";
import type { ResumoDaChave } from "@/features/integracoes/contrato";
import { BotaoEscolherPasta, BotaoVoltarParaMeuDrive } from "@/features/drive/tela/escolher-pasta";
import { CampoDeChave } from "@/features/integracoes/tela/campo-de-chave";
import { CaixaDeStatus, CartaoDeIntegracao, LinkDoRodape } from "@/features/integracoes/tela/cartao";

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

const CREDENCIAIS_DO_GOOGLE = "https://console.cloud.google.com/apis/credentials";

function CamposDoCliente({ cliente }: { cliente: Cliente }) {
  return (
    <div className="space-y-2">
      <CampoDeChave nome="google-client-id" titulo="ID do cliente" resumo={cliente.id} exemplo="....apps.googleusercontent.com" />
      <CampoDeChave nome="google-client-secret" titulo="Chave secreta do cliente" resumo={cliente.segredo} exemplo="GOCSPX-..." />
    </div>
  );
}

export function CardGoogleDrive({
  status,
  falta,
  retorno,
  cliente,
  chaveDeApi,
}: {
  status: StatusDrive;
  falta: string | null;
  retorno: Retorno;
  cliente: Cliente;
  // Abre a janela de pastas do Google (escolher onde a "Hub de Criativos" fica).
  chaveDeApi: ResumoDaChave;
}) {
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
        `Desconectar o Google Drive (${quem})? Os vídeos continuam no Drive, e o hub volta a abri-los quando esta mesma conta for conectada de novo. Com outra conta, eles somem das listas do hub até esta voltar. Sem conta conectada, o hub não gera nem recebe vídeos.`,
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

  const { conectado, conta, espaco, pasta } = status;
  const precisaRefazer = !conectado && conta !== null;
  const pctEspaco = espaco?.limite ? Math.min(100, Math.round((espaco.usado / espaco.limite) * 100)) : null;
  const pctMigracao = migracao?.total ? Math.min(100, Math.round(((migracao.feitos + migracao.falhas) / migracao.total) * 100)) : 0;
  const textoDoEspaco = espaco
    ? espaco.limite
      ? `${formatarBytes(espaco.usado)} de ${formatarBytes(espaco.limite)} usados`
      : `${formatarBytes(espaco.usado)} usados`
    : pasta?.compartilhado
      ? "Drive compartilhado da empresa"
      : `Pasta "${PASTA_RAIZ}"`;
  // Sem o cliente do Google, os campos para colar já dizem o que falta; o texto só aparece nos outros casos.
  const aviso = status.configurado ? falta : null;

  const rodape = conectado ? (
    <>
      {!migracao?.rodando && (
        <Button size="sm" variant="outline" onClick={levarAntigos} disabled={comecando}>
          {comecando ? <Loader2 className="animate-spin" /> : <CloudUpload />}
          Levar vídeos antigos
        </Button>
      )}
      <LinkDoRodape href={pasta ? `https://drive.google.com/drive/folders/${encodeURIComponent(pasta.id)}` : "https://drive.google.com/drive/my-drive"}>
        Abrir o Drive
      </LinkDoRodape>
    </>
  ) : status.configurado ? (
    <>
      {falta ? (
        <Button size="sm" disabled>
          <Plug />
          Conectar Google Drive
        </Button>
      ) : (
        <Button size="sm" asChild>
          <a href={ENTRAR}>
            <Plug />
            Conectar Google Drive
          </a>
        </Button>
      )}
    </>
  ) : (
    <LinkDoRodape href={CREDENCIAIS_DO_GOOGLE}>Criar no Google Cloud</LinkDoRodape>
  );

  return (
    <CartaoDeIntegracao logo={{ src: "/logos/google-drive.png" }} nome="Google Drive" descricao="Onde os vídeos ficam guardados. Sem ele, o hub não gera nem recebe vídeos." rodape={rodape}>
      {conectado && conta && (
        <CaixaDeStatus
          titulo={conta.nome ?? conta.email}
          detalhe={textoDoEspaco}
          acoes={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={saindo}
              onClick={desconectar}
              aria-label="Desconectar o Google Drive"
              title="Desconectar"
            >
              {saindo ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          }
        >
          {pctEspaco !== null && <Progress value={pctEspaco} className="mt-2.5 h-1" aria-label="Espaço usado no Drive" />}
        </CaixaDeStatus>
      )}

      {conectado && (
        <CaixaDeStatus
          titulo="Pasta dos vídeos"
          selo={null}
          detalhe={`${pasta?.nome ?? "Meu Drive"} › ${PASTA_RAIZ}`}
          acoes={
            <>
              <BotaoEscolherPasta podeAbrir={chaveDeApi.salva} />
              {pasta && <BotaoVoltarParaMeuDrive />}
            </>
          }
        />
      )}
      {conectado && !chaveDeApi.salva && (
        <div className="space-y-1.5">
          <CampoDeChave nome="google-api-key" titulo="Chave de API do Google" resumo={chaveDeApi} exemplo="AIza..." />
          <p className="text-xs text-muted-foreground">
            Para escolher a pasta: no Google Cloud, ative a Google Picker API e crie uma chave de API (Credenciais → Criar
            credenciais → Chave de API).
          </p>
        </div>
      )}
      {conectado && chaveDeApi.salva && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Chave de API do Google</summary>
          <div className="pt-2">
            <CampoDeChave nome="google-api-key" titulo="Chave de API do Google" resumo={chaveDeApi} exemplo="AIza..." />
          </div>
        </details>
      )}

      {precisaRefazer && <CaixaDeStatus titulo={conta.email} selo="Parou de valer" tom="aviso" detalhe="Conecte de novo" />}
      {aviso && <p className="text-xs break-words text-warn">{aviso}</p>}
      {!status.configurado && <CamposDoCliente cliente={cliente} />}
      {status.configurado && !conectado && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Cliente do Google</summary>
          <div className="pt-2">
            <CamposDoCliente cliente={cliente} />
          </div>
        </details>
      )}

      {conectado && migracao?.rodando && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Levando vídeos antigos para o Drive: {migracao.feitos} de {migracao.total}
            {migracao.falhas > 0 && <span className="text-warn"> · {migracao.falhas} com erro</span>}
          </p>
          <Progress value={pctMigracao} className="h-1" aria-label="Vídeos antigos levados para o Drive" />
        </div>
      )}
      {conectado && !migracao?.rodando && naFila > 0 && (
        <p className="text-xs text-muted-foreground">{naFila === 1 ? "1 vídeo ainda no hub, indo para o Drive." : `${naFila} vídeos ainda no hub, indo para o Drive.`}</p>
      )}
      {conectado && migracao?.ultimoErro && <p className="text-xs break-words text-warn">Último erro: {migracao.ultimoErro}</p>}
      {semAcompanhar && <p className="text-xs text-warn">Não deu para acompanhar o progresso agora. Recarregue a página para ver.</p>}
    </CartaoDeIntegracao>
  );
}
