"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Film, Languages, Link2, Loader2, LogOut, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { Field, GenerationCard, HistoryActions, HistoryPanel, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Traduz um vídeo para outros idiomas com a voz da pessoa clonada e lipsync, como no Video Translate do HeyGen. Roda pelo MCP do HeyGen: usa os créditos do seu plano, não o saldo da API.";

// Atalhos para os mercados das operações (LATAM primeiro). Os nomes são os do HeyGen.
const QUICK = [
  { value: "Spanish (Latin America)", label: "Espanhol LATAM" },
  { value: "Spanish (Mexico)", label: "Espanhol México" },
  { value: "Spanish (Colombia)", label: "Espanhol Colômbia" },
  { value: "Spanish (Spain)", label: "Espanhol Espanha" },
  { value: "Portuguese (Brazil)", label: "Português BR" },
  { value: "English (United States)", label: "Inglês EUA" },
  { value: "Romanian (Romania)", label: "Romeno" },
];

const labelOf = (l: string) => QUICK.find((q) => q.value === l)?.label ?? l;
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Busca em português: "espanhol" acha Spanish etc.
const PT_NAMES: Record<string, string> = {
  espanhol: "spanish",
  portugues: "portuguese",
  ingles: "english",
  frances: "french",
  alemao: "german",
  italiano: "italian",
  romeno: "romanian",
  holandes: "dutch",
  polones: "polish",
  russo: "russian",
  turco: "turkish",
  arabe: "arabic",
  chines: "chinese",
  japones: "japanese",
  coreano: "korean",
  grego: "greek",
  sueco: "swedish",
  dinamarques: "danish",
  noruegues: "norwegian",
  finlandes: "finnish",
  tcheco: "czech",
  hungaro: "hungarian",
  ucraniano: "ukrainian",
  hebraico: "hebrew",
  indonesio: "indonesian",
  vietnamita: "vietnamese",
  tailandes: "thai",
  filipino: "filipino",
  malaio: "malay",
  bulgaro: "bulgarian",
  croata: "croatian",
  servio: "serbian",
  eslovaco: "slovak",
};

const SOURCE: Record<string, string> = {
  heygen: "HeyGen",
  "heygen-traducao": "Tradução",
  flora: "FLORA",
  higgsfield: "Edição",
  upload: "Enviado",
  editor: "Editor",
  montagem: "Montagem",
};

type Status = { connected: boolean; account: { email: string | null; name: string | null } | null };
type Glossary = { id: string; name: string };

async function pollTranslation(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/heygen/jobs/${g.id}`, { method: "POST" });
  return generation.status !== g.status ? generation : null;
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 rounded-md px-1 py-1.5 text-left hover:bg-muted/60 disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", checked ? "bg-rec" : "bg-muted-foreground/30")}>
        <span className={cn("size-4 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}

export function TranslateStudio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [glossaries, setGlossaries] = useState<Glossary[]>([]);

  const [sourceTab, setSourceTab] = useState<"hub" | "upload">("hub");
  const [videos, setVideos] = useState<Generation[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [uploading, setUploading] = useState(false);

  const [outputs, setOutputs] = useState<string[]>([]);
  const [langOpen, setLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [inputLanguage, setInputLanguage] = useState("auto");
  const [mode, setMode] = useState<"speed" | "precision">("speed");
  const [audioOnly, setAudioOnly] = useState(false);
  const [speakers, setSpeakers] = useState("auto");
  const [dynamicDuration, setDynamicDuration] = useState(true);
  const [noMusic, setNoMusic] = useState(false);
  const [enhance, setEnhance] = useState(false);
  const [sameFormat, setSameFormat] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [glossaryId, setGlossaryId] = useState("none");
  const [srt, setSrt] = useState<File | null>(null);
  const [srtRole, setSrtRole] = useState<"input" | "output">("input");
  const [audios, setAudios] = useState<Generation[]>([]);
  const [audioId, setAudioId] = useState("none");
  const [fpsMode, setFpsMode] = useState("default");
  const [stockVoice, setStockVoice] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const srtRef = useRef<HTMLInputElement>(null);
  const { items, loaded, add, remove, clear } = useGenerations("heygen-traducao", pollTranslation);

  // Volta do login do HeyGen (?heygen=conectado|erro|cancelado).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("heygen");
    if (!r) return;
    if (r === "conectado") toast.success("HeyGen conectado pelo MCP.");
    else if (r === "cancelado") toast.message("Login do HeyGen cancelado.");
    else toast.error("Não consegui conectar o HeyGen. Tente de novo.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    apiFetch<Status>("/api/heygen/mcp")
      .then(setStatus)
      .catch(() => setStatus({ connected: false, account: null }));
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    apiFetch<{ languages: string[]; glossaries: Glossary[] }>("/api/heygen/traducao/opcoes")
      .then((d) => {
        setLanguages(d.languages);
        setGlossaries(d.glossaries);
      })
      .catch((e) => {
        toast.error(e.message);
        if (/não está conectado/.test(e.message)) setStatus({ connected: false, account: null });
      });
  }, [status?.connected]);

  // Vídeos prontos do hub e áudios (para dublar com áudio próprio).
  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations")
      .then((d) => {
        const done = d.generations.filter((g) => g.status === "done" && g.file);
        setVideos(done.filter((g) => g.kind === "video"));
        setAudios(done.filter((g) => g.kind === "audio"));
      })
      .catch((e) => {
        setVideos([]);
        toast.error(e.message);
      });
  }, [items.length]);

  const source = videos?.find((v) => v.id === sourceId);
  // Sem busca: "Mais usados" (atalhos LATAM) e depois todos. Com busca: só o que bate (nome do HeyGen, rótulo ou nome em português).
  const langGroups = useMemo(() => {
    const q = normalize(langQuery.trim());
    if (!q) {
      const quick = QUICK.map((x) => x.value).filter((v) => languages.includes(v));
      return [
        { title: "Mais usados", items: quick },
        { title: "Todos os idiomas", items: languages.filter((l) => !quick.includes(l)) },
      ];
    }
    const terms = [q, ...Object.entries(PT_NAMES).filter(([pt]) => pt.startsWith(q) || q.startsWith(pt)).map(([, en]) => en)];
    const hit = (l: string) => {
      const hay = normalize(`${l} ${QUICK.find((x) => x.value === l)?.label ?? ""}`);
      return terms.some((t) => hay.includes(t));
    };
    return [{ title: "", items: languages.filter(hit) }];
  }, [languages, langQuery]);

  const toggleLang = (l: string) => setOutputs((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  async function uploadVideo(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const { generation } = await apiFetch<{ generation: Generation }>("/api/uploads", { method: "POST", body: form });
      setVideos((cur) => [generation, ...(cur ?? [])]);
      setSourceId(generation.id);
      setSourceTab("hub");
      toast.success("Vídeo enviado ao hub.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui enviar.");
    } finally {
      setUploading(false);
    }
  }

  async function disconnect() {
    await apiFetch("/api/heygen/mcp", { method: "DELETE" }).catch(() => {});
    setStatus({ connected: false, account: null });
  }

  async function translate() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set(
        "options",
        JSON.stringify({
          videoGenerationId: sourceId,
          outputLanguages: outputs,
          mode,
          translateAudioOnly: audioOnly,
          inputLanguage: inputLanguage === "auto" ? null : inputLanguage,
          speakerNum: speakers === "auto" ? null : Number(speakers),
          enableDynamicDuration: dynamicDuration,
          disableMusicTrack: noMusic,
          enableSpeechEnhancement: enhance,
          enableWatermark: watermark,
          keepTheSameFormat: sameFormat,
          startTime: start === "" ? null : Number(start),
          endTime: end === "" ? null : Number(end),
          brandGlossaryId: glossaryId === "none" ? null : glossaryId,
          srtRole: srt ? srtRole : null,
          audioGenerationId: audioId === "none" ? null : audioId,
          fpsMode: audioId !== "none" && fpsMode !== "default" ? fpsMode : null,
          stockVoice,
          title,
        }),
      );
      if (srt) form.set("srt", srt);
      const { generations } = await apiFetch<{ generations: Generation[] }>("/api/heygen/traducao", { method: "POST", body: form });
      generations.forEach(add);
      toast.success(`${generations.length === 1 ? "Tradução enviada" : `${generations.length} traduções enviadas`} ao HeyGen. Costuma levar alguns minutos.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falhou";
      toast.error(message);
      if (/não está conectado/.test(message)) setStatus({ connected: false, account: null });
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  const ready = connected && source && outputs.length > 0;

  return (
    <Workspace
      id="estudio-traducao"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Tradução</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">HeyGen · MCP</span>
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
        { id: "padrao", label: "Padrão", layout: { entrada: 58, opcoes: 42, traducoes: "collapsed" } },
        { id: "lado", label: "Com traduções", layout: { entrada: 34, opcoes: 31, traducoes: 35 } },
        { id: "opcoes", label: "Opções + traduções", layout: { entrada: "collapsed", opcoes: 38, traducoes: 62 } },
        { id: "traducoes", label: "Foco nas traduções", layout: { entrada: "collapsed", opcoes: "collapsed", traducoes: 100 } },
      ]}
    >
      <WorkspacePanel id="entrada" title="1. Vídeo original" defaultSize={58} fill minSize={20} bodyClassName="@container flex flex-col gap-3 p-4">
        <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as "hub" | "upload")}>
          <TabsList>
            <TabsTrigger value="hub">Do hub</TabsTrigger>
            <TabsTrigger value="upload">Enviar vídeo</TabsTrigger>
          </TabsList>
        </Tabs>
        {sourceTab === "upload" ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-center text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              uploading && "pointer-events-none opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) uploadVideo(f);
            }}
          >
            {uploading ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
            {uploading ? "Enviando…" : "Clique ou arraste o vídeo (mp4, mov, webm). Até 200 MB no HeyGen."}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadVideo(f);
                e.target.value = "";
              }}
            />
          </label>
        ) : videos === null ? (
          <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Film className="size-6" />
            Nenhum vídeo no hub ainda. Envie um vídeo ou gere no estúdio de Avatar ou de Geração.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5 @5xl:grid-cols-6">
            {videos.map((v) => {
              const active = v.id === sourceId;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSourceId(v.id)}
                  className={cn("relative flex flex-col overflow-hidden rounded-lg border text-left hover:border-foreground/40", active && "border-rec ring-2 ring-rec/40")}
                >
                  <video src={mediaUrl(v)} muted playsInline preload="metadata" className="aspect-[9/16] w-full bg-muted object-cover" />
                  <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px]">
                    <span className="truncate">{v.prompt}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{SOURCE[v.tool] ?? v.tool}</span>
                  </span>
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

      <WorkspacePanel id="opcoes" title="2. Tradução" defaultSize={42} minSize={20} bodyClassName="flex flex-col">
        <div className="flex flex-1 flex-col gap-4 p-4">
          {status === null ? (
            <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
          ) : !connected ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm">
              <p className="font-medium">Conecte sua conta HeyGen</p>
              <p className="text-muted-foreground">
                A tradução roda pelo MCP do HeyGen, com login da sua conta (uma vez só). O consumo sai dos créditos premium do seu plano web, não do saldo da API.
              </p>
              <Button asChild className="w-fit bg-rec text-white hover:bg-rec/85">
                <a href="/api/heygen/mcp/login?returnTo=/estudios/traducao">
                  <Link2 />
                  Conectar HeyGen
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
                <span className="truncate">HeyGen conectado{status?.account?.email ? `: ${status.account.email}` : ""}</span>
              </span>
              <Button variant="ghost" size="xs" onClick={disconnect} className="text-muted-foreground">
                <LogOut />
                Sair
              </Button>
            </div>
          )}

          <Field label="Traduzir para" hint={outputs.length ? `${outputs.length} idioma${outputs.length > 1 ? "s" : ""}` : undefined}>
            <Popover
              open={langOpen}
              onOpenChange={(o) => {
                setLangOpen(o);
                if (!o) setLangQuery("");
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!connected}
                  className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-card py-2 pr-2 pl-2.5 text-left text-sm shadow-xs transition-colors outline-none hover:border-foreground/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
                >
                  <span className={cn("min-w-0 truncate", !outputs.length && "text-muted-foreground")}>
                    {outputs.length ? outputs.map(labelOf).join(", ") : "Escolher idiomas"}
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="flex w-(--radix-popover-trigger-width) min-w-64 flex-col gap-2 p-2">
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Buscar idioma (ex.: espanhol, Spanish)"
                    className="pl-8"
                    value={langQuery}
                    onChange={(e) => setLangQuery(e.target.value)}
                    aria-label="Buscar idioma"
                  />
                </div>
                <div className="flex max-h-72 flex-col overflow-y-auto" role="listbox" aria-multiselectable aria-label="Idiomas">
                  {langGroups.map((group) => (
                    <div key={group.title} className="flex flex-col">
                      {group.title && <span className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</span>}
                      {group.items.map((l) => {
                        const on = outputs.includes(l);
                        const pt = QUICK.find((q) => q.value === l)?.label;
                        return (
                          <button
                            key={l}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => toggleLang(l)}
                            className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted", on && "bg-rec/10")}
                          >
                            <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-rec bg-rec text-white" : "border-input")}>
                              {on && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{pt ?? l}</span>
                            {pt && <span className="shrink-0 text-xs text-muted-foreground">{l}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {!langGroups.some((g) => g.items.length) && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum idioma encontrado.</p>}
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                  <span>{outputs.length ? `${outputs.length} selecionado${outputs.length > 1 ? "s" : ""}` : "Pode escolher vários"}</span>
                  <span className="flex gap-1">
                    {outputs.length > 0 && (
                      <Button variant="ghost" size="xs" onClick={() => setOutputs([])}>
                        Limpar
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={() => setLangOpen(false)}>
                      Pronto
                    </Button>
                  </span>
                </div>
              </PopoverContent>
            </Popover>
          </Field>

          <Field label="Qualidade" id="tr-mode">
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Qualidade">
              {(
                [
                  { v: "speed", label: "Rápida (Speed)", hint: "Sai mais rápido" },
                  { v: "precision", label: "Precisão (Precision)", hint: "Lipsync melhor, mais lento" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={mode === o.v}
                  onClick={() => setMode(o.v)}
                  className={cn("rounded-md border px-3 py-2 text-left hover:bg-muted", mode === o.v && "border-rec bg-rec/10 hover:bg-rec/10")}
                >
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Idioma original" id="tr-input">
              <Select value={inputLanguage} onValueChange={setInputLanguage}>
                <SelectTrigger id="tr-input" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Detectar automaticamente</SelectItem>
                  {languages.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Pessoas falando" id="tr-speakers">
              <Select value={speakers} onValueChange={setSpeakers}>
                <SelectTrigger id="tr-speakers" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automático</SelectItem>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-col">
            <Toggle label="Traduzir só o áudio" hint="Dubla sem mexer na boca (sem lipsync)" checked={audioOnly} onChange={setAudioOnly} />
            <Toggle label="Duração dinâmica" hint="Ajusta o tempo do vídeo à fala traduzida" checked={dynamicDuration} onChange={setDynamicDuration} />
            <Toggle label="Remover música de fundo" checked={noMusic} onChange={setNoMusic} />
            <Toggle label="Melhorar a voz" hint="Limpa ruído e realça a fala" checked={enhance} onChange={setEnhance} />
          </div>

          <details className="group rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold tracking-wider text-foreground/85 uppercase">Avançado</summary>
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex flex-col">
                <Toggle label="Manter o mesmo formato" hint="Mesma resolução e bitrate do original" checked={sameFormat} onChange={setSameFormat} />
                <Toggle label="Marca d'água" checked={watermark} onChange={setWatermark} />
                <Toggle label="Voz de banco (Enterprise)" hint="Voz pronta do HeyGen em vez de clonar a original" checked={stockVoice} onChange={setStockVoice} />
              </div>

              <Field label="Trecho (segundos)" hint="vazio = vídeo todo">
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={0} step={0.1} placeholder="Início" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Início do trecho" />
                  <Input type="number" min={0} step={0.1} placeholder="Fim" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Fim do trecho" />
                </div>
              </Field>

              <Field label="Glossário da marca" id="tr-glossary">
                <Select value={glossaryId} onValueChange={setGlossaryId}>
                  <SelectTrigger id="tr-glossary" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {glossaries.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Legenda própria (.srt)">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => srtRef.current?.click()} className="min-w-0">
                    <FileText />
                    <span className="truncate">{srt ? srt.name : "Escolher .srt"}</span>
                  </Button>
                  {srt && (
                    <Button variant="ghost" size="icon-xs" aria-label="Tirar legenda" onClick={() => setSrt(null)}>
                      <X />
                    </Button>
                  )}
                  <input
                    ref={srtRef}
                    type="file"
                    accept=".srt"
                    hidden
                    onChange={(e) => {
                      setSrt(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </div>
                {srt && (
                  <Select value={srtRole} onValueChange={(v) => setSrtRole(v as "input" | "output")}>
                    <SelectTrigger className="w-full" aria-label="A legenda é do">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="input">É a transcrição do vídeo original</SelectItem>
                      <SelectItem value="output">É o texto traduzido (já revisado)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Áudio próprio para dublar" id="tr-audio">
                <Select value={audioId} onValueChange={setAudioId}>
                  <SelectTrigger id="tr-audio" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (voz clonada do HeyGen)</SelectItem>
                    {audios.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="max-w-56 truncate">{a.prompt}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {audioId !== "none" && (
                  <Select value={fpsMode} onValueChange={setFpsMode}>
                    <SelectTrigger className="w-full" aria-label="Taxa de quadros">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Taxa de quadros: padrão</SelectItem>
                      <SelectItem value="passthrough">Igual ao original</SelectItem>
                      <SelectItem value="cfr">Constante (CFR)</SelectItem>
                      <SelectItem value="vfr">Variável (VFR)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Título no HeyGen" id="tr-title">
                <Input id="tr-title" placeholder="Opcional" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
          </details>
        </div>
        <div className="sticky bottom-0 flex flex-col items-stretch gap-2 border-t bg-background p-4">
          <p className="truncate text-xs text-muted-foreground">
            Vídeo: <span className="text-foreground">{source?.prompt ?? "nenhum"}</span>
          </p>
          <Button className="bg-rec text-white hover:bg-rec/85" disabled={!ready || busy} onClick={translate}>
            {busy ? <Loader2 className="animate-spin" /> : <Languages />}
            {busy ? "Enviando ao HeyGen…" : outputs.length > 1 ? `Traduzir para ${outputs.length} idiomas` : "Traduzir vídeo"}
          </Button>
          <p className="text-[11px] text-muted-foreground">Consome créditos premium do plano HeyGen (por minuto de vídeo e por idioma).</p>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        id="traducoes"
        title="Traduções"
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
          empty="Os vídeos traduzidos aparecem aqui, um por idioma."
          className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-5"
        >
          {items.map((g) => (
            <div key={g.id} className="flex flex-col gap-1">
              <GenerationCard
                g={g}
                onDelete={remove}
                title={String(g.params.language ?? "Tradução")}
                meta={`${g.params.mode === "precision" ? "Precisão" : "Rápida"}${g.params.translateAudioOnly ? " · só áudio" : ""} · ${g.params.source ?? ""}`}
              />
              {typeof g.params.srtFile === "string" && g.params.srtFile && (
                <a href={`/api/media/${g.params.srtFile}`} download className="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">
                  <FileText className="size-3.5" />
                  Legenda .srt
                </a>
              )}
            </div>
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}
