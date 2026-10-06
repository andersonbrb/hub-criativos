"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Film, Loader2, Scissors, X } from "lucide-react";
import { toast } from "sonner";

import { EffectsPanel, FX_OFF, fxCount, GraphicsPanel, type Fx, type Grafico } from "@/components/studios/edit-extras";
import { Field, GenerationCard, HistoryActions, HistoryPanel, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { CREATIVE_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Edição final do criativo no padrão: junta os vídeos do avatar, corta os silêncios, coloca os b-rolls nos momentos certos e queima a legenda. Roda nesta máquina (Whisper + ffmpeg), sem gastar créditos.";

// Parâmetros do playbook (hub/playbooks/infoproduto-edicao-video.md), aplicados por scripts/montagem.py.
const RULES = [
  ["Corte de silêncio", "acima de 0,35s"],
  ["B-roll", "na palavra escolhida; sem palavra, aos 6s e a cada 7s"],
  ["B-roll na tela", "2,8s com dissolve de 0,25s"],
  ["Legenda", "Montserrat 110, MAIÚSCULA, até 14 caracteres"],
  ["Transcrição", "Whisper small (nunca tiny)"],
  ["Saída", "1080×1920, 30 fps"],
];

const LANGS = CREATIVE_LANGUAGES.map((l) => ({ value: l.id, label: l.label }));

const SOURCE: Record<string, string> = { heygen: "HeyGen", flora: "FLORA", higgsfield: "Higgsfield", upload: "Anexo", editor: "Editor", montagem: "Edição", "heygen-traducao": "Tradução" };

async function pollMontage(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/montagem/${g.id}`);
  return generation.status !== g.status ? generation : null;
}

export function MontageStudio() {
  const [videos, setVideos] = useState<Generation[] | null>(null);
  // Vários vídeos do avatar: juntados na ordem do clique antes dos cortes (gancho + body, várias tomadas).
  const [avatarIds, setAvatarIds] = useState<string[]>([]);
  const [brollIds, setBrollIds] = useState<string[]>([]);
  // Deixa de cada b-roll (palavra falada em que ele entra), por id do b-roll.
  const [cues, setCues] = useState<Record<string, string>>({});
  // Opcionais (desligados por padrão): efeitos e gráficos animados.
  const [fx, setFx] = useState<Fx>(FX_OFF);
  const [graficos, setGraficos] = useState<Grafico[]>([]);
  const [audios, setAudios] = useState<Generation[]>([]);
  const [lang, setLang] = useState("es");
  const [name, setName] = useState("AD01");
  const [busy, setBusy] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const { items, loaded, add, remove, clear } = useGenerations("montagem", pollMontage);

  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations")
      .then((d) => {
        setVideos(d.generations.filter((g) => g.kind === "video" && g.status === "done" && g.file && g.tool !== "montagem"));
        // Áudios do hub para a música de fundo (efeito opcional).
        setAudios(d.generations.filter((g) => g.kind === "audio" && g.status === "done" && g.file));
      })
      .catch((e) => {
        setVideos([]);
        toast.error(e.message);
      });
  }, []);

  // Vídeos com fala: avatar do HeyGen, traduções, enviados, editados e exportados do editor.
  const avatars = useMemo(
    () => (videos ?? []).filter((v) => ["heygen", "heygen-traducao", "upload", "editor", "higgsfield"].includes(v.tool)),
    [videos],
  );
  const brollOptions = useMemo(() => (videos ?? []).filter((v) => !avatarIds.includes(v.id)), [videos, avatarIds]);

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

  function toggleAvatar(id: string) {
    setAvatarIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setBrollIds((cur) => cur.filter((x) => x !== id)); // o mesmo vídeo não entra como avatar e b-roll
  }

  async function run() {
    setBusy(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>("/api/montagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarIds,
          brollIds,
          brollCues: brollIds.map((id) => cues[id] ?? ""),
          lang,
          name,
          fx: fxCount(fx) ? { ...fx, musicId: fx.musicId || undefined } : undefined,
          graphics: graficos
            .filter((g) => g.texto.trim() || g.tipo === "cta" || g.tipo === "contador")
            .map((g) => ({ tipo: g.tipo, texto: g.texto, sub: g.sub || undefined, deixa: g.deixa || undefined, posicao: g.posicao || undefined })),
        }),
      });
      add(generation);
      setLogId(generation.id);
      toast.success("Edição iniciada. Leva de 1 a 3 minutos.");
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
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Edição</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[0.6875rem] text-muted-foreground">Local · Whisper + ffmpeg</span>
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
              <h2 className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
                1. Avatar falando (um ou vários, na ordem em que entram)
              </h2>
              {avatars.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum vídeo com fala ainda. Gere no estúdio Avatar ou envie um vídeo.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 @xl:grid-cols-4 @3xl:grid-cols-6">
                  {avatars.map((v) => {
                    const order = avatarIds.indexOf(v.id);
                    return <VideoTile key={v.id} g={v} active={order >= 0} badge={order >= 0 ? String(order + 1) : undefined} onClick={() => toggleAvatar(v.id)} />;
                  })}
                </div>
              )}
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
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

      <WorkspacePanel id="ajustes" title="Edição final" defaultSize={36} minSize={16} bodyClassName="flex flex-col gap-4 p-4">
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
          <span className="text-muted-foreground">Avatar:</span>
          {avatarIds.length === 0 ? (
            <span className="text-muted-foreground">nenhum</span>
          ) : (
            avatarIds.map((id, i) => (
              <span key={id} className="flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5">
                {i + 1}
                <button type="button" aria-label="Tirar vídeo do avatar" onClick={() => toggleAvatar(id)}>
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
          {avatarIds.length > 1 && <span className="text-muted-foreground">juntados nessa ordem</span>}
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <span className="text-muted-foreground">
            B-rolls{brollIds.length ? " · entra quando o avatar falar a palavra (vazio = 6s e depois a cada 7s)" : ""}:
          </span>
          {brollIds.length === 0 ? (
            <span className="text-muted-foreground">nenhum (só cortes e legenda)</span>
          ) : (
            brollIds.map((id, i) => {
              const v = videos?.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-center gap-1.5">
                  <span className="flex size-5 shrink-0 items-center justify-center bg-rec font-mono text-[0.625rem] font-semibold text-white">{i + 1}</span>
                  <span className="w-24 shrink-0 truncate text-muted-foreground" title={v?.prompt}>
                    {v?.name || v?.prompt || "b-roll"}
                  </span>
                  <Input
                    value={cues[id] ?? ""}
                    onChange={(e) => setCues((c) => ({ ...c, [id]: e.target.value }))}
                    placeholder="entra quando falar…"
                    className="h-7 min-w-0 flex-1 text-xs md:text-xs"
                    aria-label={`Deixa do b-roll ${i + 1}`}
                  />
                  <button type="button" aria-label="Tirar b-roll" onClick={() => toggleBroll(id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <EffectsPanel fx={fx} onChange={setFx} audios={audios} />
        <GraphicsPanel items={graficos} onChange={setGraficos} />

        <dl className="grid gap-1 rounded-md border p-3 text-xs">
          {RULES.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>

        <Button className="bg-rec text-white hover:bg-rec/85" disabled={!avatarIds.length || busy} onClick={run}>
          {busy ? <Loader2 className="animate-spin" /> : <Scissors />}
          {busy ? "Iniciando…" : "Gerar edição final"}
        </Button>
        {!avatarIds.length && <p className="text-xs text-muted-foreground">Escolha um ou mais vídeos do avatar para começar.</p>}
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
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
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
      <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[0.6875rem]">
        <span className="truncate">{g.name || g.prompt}</span>
        <span className="shrink-0 font-mono text-muted-foreground">{SOURCE[g.tool] ?? g.tool}</span>
      </span>
      {active && (
        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-rec text-[0.6875rem] font-semibold text-white">
          {badge ?? <Check className="size-3" />}
        </span>
      )}
    </button>
  );
}
