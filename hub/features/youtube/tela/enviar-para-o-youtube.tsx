"use client";

import { CalendarClock, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ANTECEDENCIA_MINIMA_MS,
  DESCRICAO_MAXIMA,
  MINIATURA_MAXIMA,
  TITULO_MAXIMO,
  VISIBILIDADES,
  type EnvioYoutube,
  type EstadoDoEnvio,
  type Visibilidade,
} from "@/features/youtube/contrato";
import { IconeDoYoutube } from "@/features/youtube/tela/icone";
import { formatarDataHora, ListaDeEnvios, useEnvios } from "@/features/youtube/tela/lista-de-envios";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

// Botão "Enviar para o YouTube" dos vídeos prontos (card das gerações) e a janela do envio: título, descrição,
// visibilidade, agora ou agendado, miniatura, Shorts e "para crianças". Embaixo, os envios deste vídeo.
// O botão só aparece para quem pode enviar (chave "youtube" na organização aberta).

// Uma consulta por página aberta, para todos os cards.
let estadoDaPagina: Promise<EstadoDoEnvio> | null = null;
const SEM_PERMISSAO: EstadoDoEnvio = { podeEnviar: false, conectado: false, canal: null };

function useEstado(): EstadoDoEnvio | null {
  const [estado, setEstado] = useState<EstadoDoEnvio | null>(null);
  useEffect(() => {
    let ativo = true;
    (estadoDaPagina ??= apiFetch<EstadoDoEnvio>("/api/youtube/estado").catch(() => {
      estadoDaPagina = null;
      return SEM_PERMISSAO;
    })).then((e) => ativo && setEstado(e));
    return () => {
      ativo = false;
    };
  }, []);
  return estado;
}

export function BotaoEnviarParaOYoutube({ g, titulo }: { g: Generation; titulo: string }) {
  const estado = useEstado();
  const [aberto, setAberto] = useState(false);
  if (!estado?.podeEnviar) return null;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Enviar para o YouTube" title="Enviar para o YouTube">
          <IconeDoYoutube className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconeDoYoutube className="size-5" />
            Enviar para o YouTube
          </DialogTitle>
          <DialogDescription>
            {estado.conectado && estado.canal ? (
              <>
                Vai para o canal <span className="font-medium text-foreground">{estado.canal.titulo}</span>.
              </>
            ) : (
              "O YouTube ainda não está conectado nesta organização."
            )}
          </DialogDescription>
        </DialogHeader>
        {aberto && <JanelaDeEnvio g={g} tituloInicial={titulo} conectado={estado.conectado} aoFechar={() => setAberto(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// "AAAA-MM-DDTHH:mm" na hora local, o formato do campo de data e hora do navegador.
function paraCampo(d: Date) {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

type Medidas = { emPe: boolean; segundos: number };

function JanelaDeEnvio({ g, tituloInicial, conectado, aoFechar }: { g: Generation; tituloInicial: string; conectado: boolean; aoFechar: () => void }) {
  const { envios, recarregar } = useEnvios(g.id, conectado);
  const [titulo, setTitulo] = useState(() => tituloInicial.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, TITULO_MAXIMO));
  const [descricao, setDescricao] = useState("");
  const [visibilidade, setVisibilidade] = useState<Visibilidade>("public");
  const [agendar, setAgendar] = useState(false);
  const [quando, setQuando] = useState(() => paraCampo(new Date(Date.now() + 60 * 60_000)));
  const [miniatura, setMiniatura] = useState<File | null>(null);
  const [shorts, setShorts] = useState<boolean | null>(null);
  const [paraCriancas, setParaCriancas] = useState(false);
  const [medidas, setMedidas] = useState<Medidas | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [minimo] = useState(() => paraCampo(new Date(Date.now() + ANTECEDENCIA_MINIMA_MS + 60_000)));

  const pareceShort = medidas ? medidas.emPe && medidas.segundos <= 180 : null;
  const marcarShorts = shorts ?? pareceShort ?? false;

  if (!conectado)
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">Um admin conecta o canal em Integrações → YouTube. Depois disso, este botão envia o vídeo direto para lá.</p>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
          <Button asChild>
            <a href="/integracoes">Abrir Integrações</a>
          </Button>
        </DialogFooter>
      </div>
    );

  const escolherMiniatura = (arquivo: File | null) => {
    if (arquivo && !["image/jpeg", "image/png"].includes(arquivo.type)) return toast.error("A miniatura precisa ser JPG ou PNG.");
    if (arquivo && arquivo.size > MINIATURA_MAXIMA) return toast.error("A miniatura pode ter até 10 MB.");
    setMiniatura(arquivo);
  };

  const enviar = async () => {
    const agendadoPara = agendar ? new Date(quando) : null;
    if (agendadoPara && (Number.isNaN(agendadoPara.getTime()) || agendadoPara.getTime() - Date.now() < ANTECEDENCIA_MINIMA_MS))
      return toast.error("Escolha um dia e horário pelo menos 2 minutos à frente.");
    const form = new FormData();
    form.set("geracaoId", g.id);
    form.set("titulo", titulo);
    form.set("descricao", descricao);
    form.set("visibilidade", visibilidade);
    form.set("agendadoPara", agendadoPara ? agendadoPara.toISOString() : "");
    form.set("shorts", String(marcarShorts));
    form.set("paraCriancas", String(paraCriancas));
    if (miniatura) form.set("miniatura", miniatura);
    setEnviando(true);
    try {
      const { envio } = await apiFetch<{ envio: EnvioYoutube }>("/api/youtube/envios", { method: "POST", body: form });
      toast.success(envio.agendadoPara ? `Agendado: sai em ${formatarDataHora(envio.agendadoPara)}.` : "Enviando para o YouTube. Acompanhe aqui embaixo.");
      void recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para enviar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const url = mediaUrl(g);
  return (
    // min-w-0: a janela é uma grade; sem isso, um título longo da lista alarga a janela além da tela do celular.
    <div className="flex min-w-0 flex-col gap-4 text-sm">
      {/* Só para ler o formato e a duração (Shorts): não aparece. */}
      {url && (
        <video
          src={url}
          preload="metadata"
          muted
          className="hidden"
          onLoadedMetadata={(e) => setMedidas({ emPe: e.currentTarget.videoHeight >= e.currentTarget.videoWidth, segundos: e.currentTarget.duration || 0 })}
        />
      )}

      <Campo rotulo="Título" contador={`${[...titulo].length}/${TITULO_MAXIMO}`}>
        <Input value={titulo} maxLength={TITULO_MAXIMO} onChange={(e) => setTitulo(e.target.value)} aria-label="Título" />
      </Campo>

      <Campo rotulo="Descrição" contador={`${descricao.length}/${DESCRICAO_MAXIMA}`}>
        <Textarea value={descricao} maxLength={DESCRICAO_MAXIMA} rows={4} onChange={(e) => setDescricao(e.target.value)} aria-label="Descrição" placeholder="Opcional" />
      </Campo>

      <Campo rotulo="Visibilidade" dica={VISIBILIDADES[visibilidade].dica}>
        <Escolha
          rotulo="Visibilidade"
          valor={visibilidade}
          opcoes={(Object.keys(VISIBILIDADES) as Visibilidade[]).map((v) => ({ valor: v, rotulo: VISIBILIDADES[v].rotulo }))}
          aoEscolher={setVisibilidade}
        />
      </Campo>

      <Campo
        rotulo="Quando"
        dica={
          agendar
            ? "Na hora marcada o hub sobe o vídeo; ele aparece no canal alguns minutos depois. Dá para cancelar até lá."
            : "Começa a subir assim que você confirmar."
        }
      >
        <Escolha
          rotulo="Quando enviar"
          valor={agendar ? "agendar" : "agora"}
          opcoes={[
            { valor: "agora", rotulo: "Enviar agora" },
            { valor: "agendar", rotulo: "Agendar" },
          ]}
          aoEscolher={(v) => setAgendar(v === "agendar")}
        />
        {agendar && (
          <Input type="datetime-local" value={quando} min={minimo} onChange={(e) => setQuando(e.target.value)} aria-label="Dia e horário" className="mt-2" />
        )}
      </Campo>

      <Campo rotulo="Miniatura" dica="Opcional. JPG ou PNG, de preferência 1280x720. O YouTube só aceita miniatura própria em canal verificado por telefone.">
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => escolherMiniatura(e.target.files?.[0] ?? null)}
          className="text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:text-foreground"
          aria-label="Miniatura"
        />
      </Campo>

      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={marcarShorts} onChange={(e) => setShorts(e.target.checked)} className="mt-0.5" />
          <span>
            É um Short
            <span className="block text-muted-foreground">
              {pareceShort === false
                ? "Este vídeo não é em pé ou passa de 3 minutos: o YouTube não vai tratá-lo como Short."
                : "Vídeo em pé de até 3 minutos o YouTube já publica como Short. Marcado, o hub põe #Shorts na descrição."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={paraCriancas} onChange={(e) => setParaCriancas(e.target.checked)} className="mt-0.5" />
          <span>
            Feito para crianças
            <span className="block text-muted-foreground">Regra do YouTube: marque só se o vídeo for pensado para o público infantil.</span>
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
        <Button onClick={enviar} disabled={enviando || !titulo.trim()}>
          {enviando ? <Loader2 className="animate-spin" /> : agendar ? <CalendarClock /> : <Send />}
          {agendar ? "Agendar" : "Enviar agora"}
        </Button>
      </DialogFooter>

      {envios && envios.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-xs font-medium text-muted-foreground">Envios deste vídeo</span>
          <ListaDeEnvios envios={envios} aoMudar={() => void recarregar()} mostrarTitulo />
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, dica, contador, children }: { rotulo: string; dica?: string; contador?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{rotulo}</span>
        {contador && <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{contador}</span>}
      </div>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function Escolha<T extends string>({ rotulo, valor, opcoes, aoEscolher }: { rotulo: string; valor: T; opcoes: { valor: T; rotulo: string }[]; aoEscolher: (v: T) => void }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border p-1" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => aoEscolher(o.valor)}
          className={cn(
            "rounded-md px-2 py-1.5 text-xs transition-colors",
            valor === o.valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
