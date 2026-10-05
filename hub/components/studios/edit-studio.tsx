"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Coins, Film, Loader2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { Field, GenerationCard, HistoryActions, HistoryPanel, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { EDIT_TOOLS } from "@/lib/higgsfield-edits";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Edite os vídeos do hub com o Higgsfield: prompt, reenquadrar, resolução, fundo, flicker, FPS e dublagem. Usa a CLI já logada nesta máquina.";

const TOOL_NAMES: Record<Generation["tool"], string> = {
  flora: "FLORA",
  heygen: "HeyGen",
  higgsfield: "Edição",
  elevenlabs: "ElevenLabs",
  upload: "Anexo do chat",
  editor: "Editor de vídeo",
  montagem: "Montagem",
};

async function pollJob(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/higgsfield/jobs/${g.id}`, { method: "POST" });
  return generation.status !== g.status ? generation : null;
}

export function EditStudio() {
  const [sourceTab, setSourceTab] = useState<"hub" | "upload">("hub");
  const [videos, setVideos] = useState<Generation[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [toolId, setToolId] = useState(EDIT_TOOLS[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { items, loaded, add, remove, clear } = useGenerations("higgsfield", pollJob);

  const tool = EDIT_TOOLS.find((t) => t.id === toolId)!;
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  // Vídeos prontos do hub (FLORA, HeyGen e edições anteriores) para usar como entrada.
  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations")
      .then((d) => setVideos(d.generations.filter((g) => g.kind === "video" && g.status === "done" && g.file)))
      .catch((e) => {
        setVideos([]);
        toast.error(e.message);
      });
  }, [items.length]);

  useEffect(() => {
    apiFetch<{ credits: number }>("/api/higgsfield/account")
      .then((a) => setBalance(a.credits))
      .catch((e) => toast.error(e.message));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch<{ credits: number | null }>("/api/higgsfield/cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: toolId, params: values, prompt: prompt || "estimativa" }),
      })
        .then((c) => setCredits(c.credits))
        .catch(() => setCredits(null));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, values]);

  function pickTool(id: string) {
    setToolId(id);
    setValues({});
    setPrompt("");
  }

  const source = videos?.find((v) => v.id === sourceId);
  const hasSource = sourceTab === "hub" ? Boolean(source) : Boolean(file);
  const notEnough = balance !== null && credits !== null && credits > balance;

  async function run() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("tool", toolId);
      form.set("params", JSON.stringify(values));
      if (prompt) form.set("prompt", prompt);
      if (sourceTab === "hub") form.set("sourceId", sourceId);
      else if (file) form.set("video", file);
      const { generation } = await apiFetch<{ generation: Generation }>("/api/higgsfield/edit", { method: "POST", body: form });
      add(generation);
      toast.success(`${tool.label}: enviado ao Higgsfield`);
      apiFetch<{ credits: number }>("/api/higgsfield/account").then((a) => setBalance(a.credits)).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Workspace
      id="estudio-edicao"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Edição</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">Higgsfield</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{DESCRIPTION}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{DESCRIPTION}</TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          <OpenAppButton app="higgsfield" />
        </>
      }
      presets={[
        { id: "padrao", label: "Padrão", layout: { entrada: 62, edicao: 38, editados: "collapsed" } },
        { id: "lado", label: "Com resultados", layout: { entrada: 38, edicao: 27, editados: 35 } },
        { id: "ferramentas", label: "Ferramentas + resultados", layout: { entrada: "collapsed", edicao: 35, editados: 65 } },
        { id: "editados", label: "Foco nos resultados", layout: { entrada: "collapsed", edicao: "collapsed", editados: 100 } },
      ]}
    >
      <WorkspacePanel id="entrada" title="1. Vídeo de entrada" defaultSize={62} fill minSize={20} bodyClassName="@container flex flex-col gap-3 p-4">
        <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as "hub" | "upload")}>
          <TabsList>
            <TabsTrigger value="hub">Do hub</TabsTrigger>
            <TabsTrigger value="upload">Enviar arquivo</TabsTrigger>
          </TabsList>
        </Tabs>
        {sourceTab === "upload" ? (
          filePreview ? (
            <div className="flex flex-col items-start gap-2">
              <video src={filePreview} controls playsInline className="max-h-96 rounded-md border" />
              <Button variant="outline" size="sm" onClick={() => setFile(null)}>
                Trocar vídeo
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-center text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground">
              <Upload className="size-6" />
              Clique para escolher um vídeo (mp4, mov, webm)
              <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )
        ) : videos === null ? (
          <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Film className="size-6" />
            Nenhum vídeo no hub ainda. Gere no estúdio de Geração (FLORA) ou de Avatar (HeyGen), ou envie um arquivo.
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
                  className={cn(
                    "relative flex flex-col overflow-hidden rounded-lg border text-left hover:border-foreground/40",
                    active && "border-rec ring-2 ring-rec/40",
                  )}
                >
                  <video src={mediaUrl(v)} muted playsInline preload="metadata" className="aspect-[9/16] w-full bg-muted object-cover" />
                  <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px]">
                    <span className="truncate">{v.prompt}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{TOOL_NAMES[v.tool]}</span>
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

      <WorkspacePanel id="edicao" title="2. Edição" defaultSize={38} minSize={18} bodyClassName="flex flex-col">
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="grid gap-1.5" role="radiogroup" aria-label="Ferramenta de edição">
            {EDIT_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === toolId}
                onClick={() => pickTool(t.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted",
                  t.id === toolId && "border-rec bg-rec/10 hover:bg-rec/10",
                )}
              >
                <span className="block text-sm font-medium">{t.label}</span>
                {t.id === toolId && <span className="block text-xs text-muted-foreground">{t.description}</span>}
              </button>
            ))}
          </div>

          {tool.prompt && (
            <Field label={tool.prompt.label} id="ed-prompt">
              <Textarea id="ed-prompt" rows={3} value={prompt} placeholder={tool.prompt.placeholder} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
          )}

          {tool.fields.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {tool.fields.map((f) => (
                <Field key={f.name} label={f.label} id={`ed-${f.name}`}>
                  <Select value={values[f.name] ?? f.default} onValueChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}>
                    <SelectTrigger id={`ed-${f.name}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 flex flex-col items-stretch gap-2 border-t bg-background p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Coins className="size-3.5" />
              Custo: <b className="font-mono text-foreground tabular-nums">{credits ?? "—"}</b>
              {credits !== null && " créditos"}
            </span>
            <span>
              Saldo: <span className="font-mono tabular-nums">{balance ?? "—"}</span>
            </span>
          </div>
          {notEnough && <p className="text-xs text-warn">Créditos insuficientes. Recarregue em higgsfield.ai.</p>}
          <Button
            className="bg-rec text-white hover:bg-rec/85"
            disabled={busy || !hasSource || notEnough || Boolean(tool.prompt && !prompt.trim())}
            onClick={run}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {busy ? "Enviando vídeo…" : tool.label}
          </Button>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        id="editados"
        title="Vídeos editados"
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
          empty="As edições aparecem aqui. Um vídeo editado pode ser editado de novo."
          className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-5"
        >
          {items.map((g) => (
            <GenerationCard key={g.id} g={g} onDelete={remove} title={String(g.params.editLabel ?? "Edição")} meta={String(g.params.source ?? "")} />
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}
