"use client";

import { FolderOpen, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PASTA_RAIZ, type PastaEscolhida } from "@/features/drive/contrato";
import { apiFetch } from "@/lib/generations";

// Escolher a pasta do Drive onde fica a "Hub de Criativos" (cartão do Drive, tela Integrações), pela janela de pastas
// do próprio Google (Picker). Só uma pasta escolhida nessa janela fica liberada para o hub: ele continua sem enxergar
// o resto do Drive (escopo drive.file). Também vale para pastas de um Drive compartilhado da empresa.

const ROTA = "/api/integracoes/google-drive/pasta";
const MIME_PASTA = "application/vnd.google-apps.folder";

// O pedaço da biblioteca do Google que o hub usa (https://developers.google.com/drive/picker).
type Visao = {
  setIncludeFolders(sim: boolean): Visao;
  setSelectFolderEnabled(sim: boolean): Visao;
  setMimeTypes(tipos: string): Visao;
  setEnableDrives(sim: boolean): Visao;
};
type Escolha = { action: string; docs?: { id: string }[] };
type Construtor = {
  addView(visao: Visao): Construtor;
  enableFeature(recurso: string): Construtor;
  setOAuthToken(token: string): Construtor;
  setDeveloperKey(chave: string): Construtor;
  setAppId(projeto: string): Construtor;
  setLocale(idioma: string): Construtor;
  setTitle(titulo: string): Construtor;
  setCallback(aoEscolher: (escolha: Escolha) => void): Construtor;
  build(): { setVisible(visivel: boolean): void };
};
type Picker = {
  PickerBuilder: new () => Construtor;
  DocsView: new (visao?: string) => Visao;
  ViewId: { FOLDERS: string };
  Feature: { SUPPORT_DRIVES?: string };
  Action: { PICKED: string };
};

declare global {
  interface Window {
    gapi?: { load(modulo: string, pronto: () => void): void };
    google?: { picker?: Picker };
  }
}

// Carrega a biblioteca do Google uma vez só. Se falhar (internet, bloqueador), a próxima tentativa carrega de novo.
let carregando: Promise<Picker> | null = null;
function carregarJanela(): Promise<Picker> {
  carregando ??= new Promise<Picker>((ok, falha) => {
    const pronto = () =>
      window.gapi!.load("picker", () => (window.google?.picker ? ok(window.google.picker) : falha(new Error("A janela do Google não carregou."))));
    if (window.gapi) return pronto();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = pronto;
    script.onerror = () => falha(new Error("Não deu para abrir a janela do Google. Confira a internet e tente de novo."));
    document.head.appendChild(script);
  }).catch((erro: unknown) => {
    carregando = null;
    throw erro;
  });
  return carregando;
}

export function BotaoEscolherPasta({ podeAbrir }: { podeAbrir: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  const gravar = async (id: string) => {
    setOcupado(true);
    try {
      const { pasta } = await apiFetch<{ pasta: PastaEscolhida }>(ROTA, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast.success(`Pronto: os vídeos novos vão para "${pasta.nome}" › ${PASTA_RAIZ}.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para usar essa pasta. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const abrir = async () => {
    setOcupado(true);
    try {
      const [config, picker] = await Promise.all([apiFetch<{ token: string; chave: string; projeto: string }>(ROTA), carregarJanela()]);
      const visao = new picker.DocsView(picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(MIME_PASTA)
        .setEnableDrives(true);
      let construtor = new picker.PickerBuilder().addView(visao);
      if (picker.Feature.SUPPORT_DRIVES) construtor = construtor.enableFeature(picker.Feature.SUPPORT_DRIVES);
      construtor
        .setOAuthToken(config.token)
        .setDeveloperKey(config.chave)
        // O número do projeto: é ele que libera para o hub a pasta escolhida.
        .setAppId(config.projeto)
        .setLocale("pt-BR")
        .setTitle("Escolha a pasta dos vídeos")
        .setCallback((escolha) => {
          const id = escolha.action === picker.Action.PICKED ? escolha.docs?.[0]?.id : undefined;
          if (id) void gravar(id);
        })
        .build()
        .setVisible(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para abrir a janela do Google.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Button size="sm" disabled={ocupado || !podeAbrir} onClick={abrir} title={podeAbrir ? undefined : "Cole antes a chave de API do Google"}>
      {ocupado ? <Loader2 className="animate-spin" /> : <FolderOpen />}
      Escolher pasta
    </Button>
  );
}

export function BotaoVoltarParaMeuDrive() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={ocupado}
      aria-label="Voltar a guardar no Meu Drive"
      title="Voltar para o Meu Drive"
      onClick={async () => {
        if (!confirm(`Voltar a guardar os vídeos novos no Meu Drive? Os que já estão na pasta escolhida continuam lá.`)) return;
        setOcupado(true);
        try {
          await apiFetch(ROTA, { method: "DELETE" });
          toast.success("Os vídeos novos voltam para o Meu Drive.");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Não deu para trocar agora. Tente de novo.");
        } finally {
          setOcupado(false);
        }
      }}
    >
      {ocupado ? <Loader2 className="animate-spin" /> : <Undo2 />}
    </Button>
  );
}
