"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { CreateAvatarDialog, CreationsList, useAvatarCreations } from "@/components/studios/create-avatar-dialog";
import { Field, GenerationCard, HistoryActions, HistoryPanel, MissingKey, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, type Generation } from "@/lib/generations";
import { CREATIVE_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Avatar falando com os looks da sua conta HeyGen. Use um roteiro com voz do HeyGen ou faça lipsync com uma narração do estúdio de Voz.";

type Look = { id: string; name: string; type: string; image: string | null; orientation: string | null };
type Voice = { id: string; name: string; language: string; gender: string; preview: string | null; own: boolean };

const LANGUAGES = [
  ...CREATIVE_LANGUAGES.map((l) => ({ value: l.heygen, label: l.label })),
  { value: "Romanian", label: "Romeno" },
];

async function pollVideo(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/heygen/jobs/${g.id}`, { method: "POST" });
  return generation.status !== g.status ? generation : null;
}

export function AvatarStudio({ configured }: { configured: boolean }) {
  const [ownership, setOwnership] = useState<"private" | "public">("private");
  const [looks, setLooks] = useState<Look[] | null>(null);
  const [query, setQuery] = useState("");
  const [look, setLook] = useState<Look | null>(null);
  const [mode, setMode] = useState<"script" | "audio">("script");
  const [script, setScript] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  // Operações atuais anunciam na LATAM: padrão espanhol (ver hub/playbooks).
  const [language, setLanguage] = useState("Spanish");
  const [voiceId, setVoiceId] = useState("");
  const [audios, setAudios] = useState<Generation[]>([]);
  const [audioId, setAudioId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [resolution, setResolution] = useState("1080p");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { items, loaded, add, remove, clear } = useGenerations("heygen", pollVideo);
  // Avatar novo pronto: recarrega "Meus avatares".
  const [looksKey, setLooksKey] = useState(0);
  const onAvatarReady = useCallback(() => {
    setOwnership("private");
    setLooksKey((k) => k + 1);
  }, []);
  const avatars = useAvatarCreations(onAvatarReady);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    apiFetch<{ looks: Look[] }>(`/api/heygen/looks?ownership=${ownership}`)
      .then((d) => !cancelled && setLooks(d.looks))
      .catch((e) => {
        if (!cancelled) setLooks([]);
        toast.error(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, ownership, looksKey]);

  // Vozes buscadas por idioma (a lista geral do HeyGen vem cortada). As suas vozes vêm sempre primeiro.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    apiFetch<{ voices: Voice[] }>(`/api/heygen/voices?language=${encodeURIComponent(language)}`)
      .then((d) => {
        if (cancelled) return;
        setVoices(d.voices);
        setVoiceId((cur) => (d.voices.some((v) => v.id === cur) ? cur : ""));
      })
      .catch((e) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, [configured, language]);

  // Narrações do estúdio de Voz, para fazer lipsync com o áudio do ElevenLabs.
  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations?tool=elevenlabs")
      .then((d) => {
        const done = d.generations.filter((g) => g.status === "done");
        setAudios(done);
        setAudioId((cur) => cur || done[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const filteredLooks = (looks ?? []).filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
  const voice = voices.find((v) => v.id === voiceId);

  function togglePreview(url: string | null, id: string) {
    audioRef.current?.pause();
    if (!url || playing === id) return setPlaying(null);
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    a.play().then(() => setPlaying(id)).catch(() => toast.error("Não consegui tocar a prévia."));
  }

  async function generate() {
    if (!look) return;
    setBusy(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>("/api/heygen/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookId: look.id,
          lookName: look.name,
          mode,
          script,
          voiceId,
          voiceName: voice?.name,
          audioGenerationId: audioId,
          aspectRatio,
          resolution,
        }),
      });
      add(generation);
      toast.success("Vídeo enviado ao HeyGen. Costuma levar alguns minutos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  const ready = configured && look && (mode === "script" ? script.trim() && voiceId : audioId);

  return (
    <Workspace
      id="estudio-avatar"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Avatar</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[0.6875rem] text-muted-foreground">HeyGen</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{DESCRIPTION}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{DESCRIPTION}</TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          <OpenAppButton app="heygen" />
        </>
      }
      presets={[
        { id: "padrao", label: "Padrão", layout: { avatares: 62, fala: 38, videos: "collapsed" } },
        { id: "lado", label: "Com vídeos", layout: { avatares: 38, fala: 27, videos: 35 } },
        { id: "fala", label: "Fala + vídeos", layout: { avatares: "collapsed", fala: 35, videos: 65 } },
        { id: "videos", label: "Foco nos vídeos", layout: { avatares: "collapsed", fala: "collapsed", videos: 100 } },
      ]}
    >
      <WorkspacePanel id="avatares" title="1. Avatar" defaultSize={62} fill minSize={20} bodyClassName="@container flex flex-col gap-3 p-4">
        {!configured && <MissingKey envVar="HEYGEN_API_KEY" where="app.heygen.com → Settings → API" />}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={ownership} onValueChange={(v) => setOwnership(v as "private" | "public")}>
            <TabsList>
              <TabsTrigger value="private">Meus avatares</TabsTrigger>
              <TabsTrigger value="public">Públicos</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative min-w-40 flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar avatar" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar avatar" />
          </div>
          <CreateAvatarDialog credits={avatars.credits} onCreated={avatars.add} />
        </div>
        <CreationsList creations={avatars.creations} onDismiss={avatars.dismiss} />
        {!configured ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Conecte a chave do HeyGen para ver seus avatares.</p>
        ) : looks === null ? (
          <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
        ) : filteredLooks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {ownership === "private" ? "Nenhum avatar seu. Veja os públicos ou clique em Criar avatar." : "Nenhum avatar encontrado."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5 @5xl:grid-cols-6">
            {filteredLooks.map((l) => {
              const active = look?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLook(l)}
                  aria-pressed={active}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-foreground/40",
                    active && "border-rec ring-2 ring-rec/40",
                  )}
                >
                  <div className="aspect-[3/4] w-full bg-muted">
                    {l.image && (
                      // eslint-disable-next-line @next/next/no-img-element -- imagem remota do HeyGen
                      <img src={l.image} alt="" loading="lazy" className="size-full object-cover" />
                    )}
                  </div>
                  <span className="truncate px-2 py-1.5 text-xs">{l.name}</span>
                  {active && (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-rec text-white">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </WorkspacePanel>

      <WorkspacePanel id="fala" title="2. Fala" defaultSize={38} minSize={18} bodyClassName="flex flex-col">
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "script" | "audio")}>
            <TabsList className="w-full">
              <TabsTrigger value="script">Roteiro + voz HeyGen</TabsTrigger>
              <TabsTrigger value="audio">Áudio do estúdio Voz</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "script" ? (
            <>
              <Field label="Roteiro" id="hg-script" hint={`${script.length} car.`}>
                <Textarea id="hg-script" rows={6} placeholder="Cole aqui o roteiro que o avatar vai falar…" value={script} onChange={(e) => setScript(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Idioma" id="hg-lang">
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger id="hg-lang" className="w-full">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Voz" id="hg-voice">
                  <div className="flex gap-1">
                    <Select value={voiceId} onValueChange={setVoiceId}>
                      <SelectTrigger id="hg-voice" className="w-full min-w-0">
                        <SelectValue placeholder="Escolher" />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.own && <span className="text-xs text-rec">minha</span>}
                            {v.name}
                            {v.gender && <span className="text-xs text-muted-foreground">· {v.gender}</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Ouvir voz"
                      disabled={!voice?.preview}
                      onClick={() => togglePreview(voice?.preview ?? null, voiceId)}
                    >
                      {playing === voiceId ? <Pause /> : <Play />}
                    </Button>
                  </div>
                </Field>
              </div>
            </>
          ) : audios.length === 0 ? (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              Nenhuma narração ainda. Gere uma no estúdio de Voz e ela aparece aqui para o lipsync.
            </p>
          ) : (
            <Field label="Narração" id="hg-audio">
              <Select value={audioId} onValueChange={setAudioId}>
                <SelectTrigger id="hg-audio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audios.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="max-w-56 truncate">{a.name || a.prompt}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {audioId && <audio src={`/api/media/${audios.find((a) => a.id === audioId)?.file}`} controls className="h-9 w-full" />}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Formato" id="hg-ratio">
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger id="hg-ratio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 Reels/TikTok</SelectItem>
                  <SelectItem value="4:5">4:5 Feed</SelectItem>
                  <SelectItem value="1:1">1:1 Quadrado</SelectItem>
                  <SelectItem value="16:9">16:9 YouTube</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Resolução" id="hg-res">
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger id="hg-res" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
        <div className="sticky bottom-0 flex flex-col items-stretch gap-2 border-t bg-background p-4">
          <p className="text-xs text-muted-foreground">
            Avatar: <span className="text-foreground">{look?.name ?? "nenhum"}</span>
          </p>
          <Button className="bg-rec text-white hover:bg-rec/85" disabled={!ready || busy} onClick={generate}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? "Enviando…" : "Gerar vídeo do avatar"}
          </Button>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        id="videos"
        title="Vídeos"
        defaultSize={35}
        minSize={18}
        defaultCollapsed
        badge={items.length}
        actions={<HistoryActions count={items.length} onClear={clear} />}
        bodyClassName="@container p-4"
      >
        <HistoryPanel
          bare
          count={items.length}
          loaded={loaded}
          empty="Os vídeos do avatar aparecem aqui."
          className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-5"
        >
          {items.map((g) => (
            <GenerationCard key={g.id} g={g} onDelete={remove} meta={`${g.params.lookName} · ${g.params.aspect_ratio}`} />
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}
