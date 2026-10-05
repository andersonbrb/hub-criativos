"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Film, Loader2, Scissors, X } from "lucide-react";
import { toast } from "sonner";

import { Field, GenerationCard, HistoryActions, HistoryPanel, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Montagem automática do infoproduto: corta os silêncios do avatar, coloca legenda e b-rolls com dissolve. Roda nesta máquina (Whisper + ffmpeg), sem gastar créditos.";

// Parâmetros do playbook (hub/playbooks/infoproduto-edicao-video.md), aplicados por scripts/montagem.py.
const RULES = [
  ["Corte de silêncio", "acima de 0,35s"],
  ["1º b-roll", "aos 6s, depois a cada 7s"],
  ["B-roll na tela", "2,8s com dissolve de 0,25s"],
  ["Legenda", "Montserrat 110, MAIÚSCULA, até 14 caracteres"],
  ["Transcrição", "Whisper small (nunca tiny)"],
  ["Saída", "1080×1920, 30 fps"],
];

const LANGS = [
  { value: "es", label: "Espanhol" },
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
];

const SOURCE: Record<string, string> = { heygen: "HeyGen", flora: "FLORA", higgsfield: "Edição", upload: "Anexo", editor: "Editor", montagem: "Montagem" };

async function pollMontage(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/montagem/${g.id}`);
  return generation.status !== g.status ? generation : null;
}

export function MontageStudio() {
  const [videos, setVideos] = useState<Generation[] | null>(null);
  const [avatarId, setAvatarId] = useState("");
  const [brollIds, setBrollIds] = useState<string[]>([]);
  const [lang, setLang] = useState("es");
  const [name, setName] = useState("AD01");
  const [busy, setBusy] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const { items, loaded, add, remove, clear } = useGenerations("montagem", pollMontage);

  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations")
      .then((d) => setVideos(d.generations.filter((g) => g.kind === "video" && g.status === "done" && g.file && g.tool !== "montagem")))
      .catch((e) => {
        setVideos([]);
        toast.error(e.message);
      });
  }, []);

  const avatars = useMemo(() => (videos ?? []).filter((v) => v.tool === "heygen" || v.tool === "upload" || v.tool === "editor"), [videos]);
  const brollOptions = useMemo(() => (videos ?? []).filter((v) => v.id !== avatarId), [videos, avatarId]);

  // Log ao vivo da montagem em andamento (ou da escolhida no histórico).
  const running = items.find((g) => g.status === "running");
  const watchId = logId ?? running?.id ?? null;
  useEffect(() => {
    if (!watchId) return;
    let stop = false;
    const tick = () =>
      apiFetch<{ log: string }>(`/api/montagem/${watchId}`)
        .then((d) => !stop && setLog(d.log))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [watchId]);

  function toggleBroll(id: string) {
    setBrollIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function run() {
    setBusy(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>("/api/montagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId, brollIds, lang, name }),
      });
      add(generation);
      setLogId(generation.id);
      toast.success("Montagem iniciada. Leva de 1 a 3 minutos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Workspace
      id="estudio-montagem"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Montagem</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">Local · Whisper + ffmpeg</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{DESCRIPTION}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{DESCRIPTION}</TooltipContent>
          </Tooltip>
        </>
      }
      presets={[
        { id: "padrao", label: "Padrão", layout: { videos: 64, ajustes: 36, resultado: "collapsed" } },
        { id: "lado", label: "Com resultado", layout: { videos: 45, ajustes: 22, resultado: 33 } },
        { id: "resultado", label: "Foco no resultado", layout: { videos: "collapsed", ajustes: 30, resultado: 70 } },
      ]}
    >
      <WorkspacePanel id="videos" title="Vídeos" defaultSize={64} fill minSize={25} bodyClassName="@container flex flex-col gap-5 p-4">
        {videos === null ? (
          <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Film className="size-6" />
            Nenhum vídeo no hub ainda. Gere o avatar no estúdio Avatar e os b-rolls na Geração.
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">1. Avatar falando</h2>
              {avatars.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum vídeo do HeyGen ainda. Gere no estúdio Avatar.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 @xl:grid-cols-4 @3xl:grid-cols-6">
                  {avatars.map((v) => (
                    <VideoTile key={v.id} g={v} active={v.id === avatarId} onClick={() => setAvatarId(v.id)} />
                  ))}
                </div>
              )}
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                2. B-rolls (na ordem em que entram)
              </h2>
              <div className="grid grid-cols-3 gap-2 @xl:grid-cols-4 @3xl:grid-cols-6">
                {brollOptions.map((v) => {
                  const order = brollIds.indexOf(v.id);
                  return <VideoTile key={v.id} g={v} active={order >= 0} badge={order >= 0 ? String(order + 1) : undefined} onClick={() => toggleBroll(v.id)} />;
                })}
              </div>
            </section>
          </>
        )}
      </WorkspacePanel>

      <WorkspacePanel id="ajustes" title="Montagem" defaultSize={36} minSize={16} bodyClassName="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nome" id="mt-name">
            <Input id="mt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="AD01" />
          </Field>
          <Field label="Idioma da fala" id="mt-lang">
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger id="mt-lang" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-muted-foreground">B-rolls:</span>
          {brollIds.length === 0 ? (
            <span className="text-muted-foreground">nenhum (só cortes e legenda)</span>
          ) : (
            brollIds.map((id, i) => (
              <span key={id} className="flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5">
                {i + 1}
                <button type="button" aria-label="Tirar b-roll" onClick={() => toggleBroll(id)}>
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>

        <dl className="grid gap-1 rounded-md border p-3 text-xs">
          {RULES.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>

        <Button className="bg-rec text-white hover:bg-rec/85" disabled={!avatarId || busy} onClick={run}>
          {busy ? <Loader2 className="animate-spin" /> : <Scissors />}
          {busy ? "Iniciando…" : "Montar vídeo"}
        </Button>
        {!avatarId && <p className="text-xs text-muted-foreground">Escolha o vídeo do avatar para começar.</p>}
      </WorkspacePanel>

      <WorkspacePanel
        id="resultado"
        title="Resultado"
        defaultSize={33}
        minSize={18}
        defaultCollapsed
        badge={items.length}
        actions={<HistoryActions count={items.length} onClear={clear} />}
        bodyClassName="@container flex flex-col gap-4 p-4"
      >
        {watchId && log && (
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {log.trim()}
          </pre>
        )}
        <HistoryPanel bare count={items.length} loaded={loaded} empty="Os vídeos montados aparecem aqui." className="grid grid-cols-2 gap-3 @3xl:grid-cols-3">
          {items.map((g) => (
            <div key={g.id} onClickCapture={() => setLogId(g.id)}>
              <GenerationCard
                g={g}
                onDelete={(id) => {
                  if (id === logId) setLogId(null);
                  remove(id);
                }}
                title={String(g.params.name ?? "Montagem")}
                meta={`${g.params.brolls} b-roll(s) · ${String(g.params.lang).toUpperCase()}`}
              />
            </div>
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}

function VideoTile({ g, active, badge, onClick }: { g: Generation; active: boolean; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border text-left hover:border-foreground/40",
        active && "border-rec ring-2 ring-rec/40",
      )}
    >
      <video src={mediaUrl(g)} muted playsInline preload="metadata" className="aspect-[9/16] w-full bg-muted object-cover" />
      <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px]">
        <span className="truncate">{g.prompt}</span>
        <span className="shrink-0 font-mono text-muted-foreground">{SOURCE[g.tool] ?? g.tool}</span>
      </span>
      {active && (
        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-rec text-[11px] font-semibold text-white">
          {badge ?? <Check className="size-3" />}
        </span>
      )}
    </button>
  );
}
