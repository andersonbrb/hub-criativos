"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Check, Clapperboard, Download, Film, FolderOpen, Loader2, Pause, Play, Plus, Redo2, Scissors, SkipBack, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";

import { CreativeComposition } from "@/components/editor/creative-composition";
import { Inspector } from "@/components/editor/inspector";
import { Timeline, type Selection } from "@/components/editor/timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Workspace, WorkspacePanel, type WorkspacePreset } from "@/components/workspace";
import { formatTime, placeClips, splitAt, type EditorProject, type EditorProjectSummary } from "@/lib/editor";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

const PRESETS: WorkspacePreset[] = [
  { id: "padrao", label: "Padrão", layout: { biblioteca: 18, centro: 54, inspetor: 28, previa: 64, timeline: 36 } },
  { id: "legendas", label: "Legendas", layout: { biblioteca: "collapsed", centro: 56, inspetor: 44, previa: 62, timeline: 38 } },
  { id: "previa", label: "Foco na prévia", layout: { biblioteca: "collapsed", centro: 100, inspetor: "collapsed", previa: 76, timeline: 24 } },
  { id: "timeline", label: "Timeline grande", layout: { biblioteca: 16, centro: 60, inspetor: 24, previa: 42, timeline: 58 } },
];

const HISTORY_LIMIT = 60;

// Encaixa a prévia na área disponível mantendo a proporção do vídeo.
function useFit(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize(w / h > ratio ? { w: h * ratio, h } : { w, h: w / ratio });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return { ref, size };
}

export function Editor({ initialProjectId, initialGenerationId }: { initialProjectId: string | null; initialGenerationId: string | null }) {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [projects, setProjects] = useState<EditorProjectSummary[]>([]);
  const [videos, setVideos] = useState<Generation[]>([]);
  const [exports, setExports] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(Boolean(initialProjectId || initialGenerationId));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [busy, setBusy] = useState({ captions: false, render: false });
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const past = useRef<EditorProject[]>([]);
  const future = useRef<EditorProject[]>([]);
  const pending = useRef<EditorProject | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<EditorProject | null>(null);
  // Tamanho das pilhas de desfazer/refazer, para habilitar os botões.
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const syncHistory = () => setHistory({ undo: past.current.length, redo: future.current.length });

  const fps = project?.fps ?? 30;
  const total = project ? placeClips(project).total : 0;
  const { ref: fitRef, size: fit } = useFit(project ? project.width / project.height : 9 / 16);

  const loadLibrary = useCallback(async () => {
    try {
      const data = await apiFetch<{ projects: EditorProjectSummary[]; videos: Generation[] }>("/api/editor/projects");
      setProjects(data.projects);
      setVideos(data.videos);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui carregar a biblioteca.");
    }
  }, []);

  const loadExports = useCallback(async (ids: string[]) => {
    if (!ids.length) return setExports([]);
    const { generations } = await apiFetch<{ generations: Generation[] }>("/api/generations?tool=editor");
    setExports(ids.map((id) => generations.find((g) => g.id === id)).filter((g): g is Generation => Boolean(g)));
  }, []);

  const show = useCallback(
    (p: EditorProject) => {
      setProject(p);
      latest.current = p;
      past.current = [];
      future.current = [];
      pending.current = null;
      setHistory({ undo: 0, redo: 0 });
      setSelection(null);
      setTime(0);
      setSaveState("saved");
      window.history.replaceState(null, "", `/editor?p=${p.id}`);
      loadExports(p.exports).catch(() => undefined);
    },
    [loadExports],
  );

  const openVideo = useCallback(
    async (generationId: string) => {
      setLoading(true);
      try {
        show((await apiFetch<{ project: EditorProject }>("/api/editor/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId }) })).project);
        loadLibrary();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Não consegui abrir o vídeo.");
      } finally {
        setLoading(false);
      }
    },
    [show, loadLibrary],
  );

  const openProject = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        show((await apiFetch<{ project: EditorProject }>(`/api/editor/projects/${id}`)).project);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Não consegui abrir o projeto.");
      } finally {
        setLoading(false);
      }
    },
    [show],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do servidor
    loadLibrary();
    if (initialProjectId) openProject(initialProjectId);
    else if (initialGenerationId) openVideo(initialGenerationId);
  }, [initialProjectId, initialGenerationId, loadLibrary, openProject, openVideo]);

  // ---------- Edição, salvamento e histórico ----------

  const save = useCallback(async () => {
    const p = latest.current;
    if (!p) return;
    setSaveState("saving");
    try {
      await apiFetch(`/api/editor/projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: p.title, clips: p.clips, captions: p.captions, captionsEnabled: p.captionsEnabled, style: p.style }),
      });
      setSaveState(latest.current === p ? "saved" : "dirty");
    } catch (err) {
      setSaveState("dirty");
      toast.error(err instanceof Error ? err.message : "Não consegui salvar.");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 700);
  }, [save]);

  // Cada mudança entra no histórico, exceto as de um arrasto (que guarda só o estado de antes, via checkpoint).
  const change = useCallback(
    (fn: (p: EditorProject) => EditorProject, record = true) => {
      const current = latest.current;
      if (!current) return;
      const next = fn(current);
      if (next === current) return;
      const before = pending.current ?? (record ? current : null);
      if (before) {
        past.current = [...past.current.slice(-HISTORY_LIMIT + 1), before];
        future.current = [];
        pending.current = null;
        syncHistory();
      }
      latest.current = next;
      setProject(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const checkpoint = useCallback(() => {
    pending.current = latest.current;
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev || !latest.current) return;
    past.current = past.current.slice(0, -1);
    future.current = [latest.current, ...future.current];
    latest.current = prev;
    setProject(prev);
    syncHistory();
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next || !latest.current) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, latest.current];
    latest.current = next;
    setProject(next);
    syncHistory();
    scheduleSave();
  }, [scheduleSave]);

  // Salva antes de sair da página.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current && latest.current) {
        const p = latest.current;
        navigator.sendBeacon?.(
          `/api/editor/projects/${p.id}`,
          new Blob([JSON.stringify({ title: p.title, clips: p.clips, captions: p.captions, captionsEnabled: p.captionsEnabled, style: p.style })], { type: "application/json" }),
        );
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // ---------- Player ----------

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onPause);
    };
  }, [fps, project?.id, fit.w]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(Math.max(0, total - 1 / fps), t));
      playerRef.current?.seekTo(Math.round(clamped * fps));
      setTime(clamped);
    },
    [fps, total],
  );

  const split = useCallback(() => change((p) => splitAt(p, time)), [change, time]);

  const removeSelected = useCallback(() => {
    if (!selection) return;
    if (selection.type === "caption") change((p) => ({ ...p, captions: p.captions.filter((c) => c.id !== selection.id) }));
    else change((p) => (p.clips.length > 1 ? { ...p, clips: p.clips.filter((c) => c.id !== selection.id) } : p));
    setSelection(null);
  }, [change, selection]);

  // Atalhos: espaço toca/pausa, S divide, Delete apaga a seleção, Ctrl+Z / Ctrl+Shift+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=combobox]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === " ") {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
        split();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, split, removeSelected]);

  // ---------- Ações no servidor ----------

  const autoCaptions = async (perCaption: number) => {
    if (!project) return;
    await save();
    setBusy((b) => ({ ...b, captions: true }));
    try {
      const { project: updated } = await apiFetch<{ project: EditorProject }>(`/api/editor/projects/${project.id}/captions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perCaption }),
      });
      change((p) => ({ ...p, captions: updated.captions }));
      toast.success(`${updated.captions.length} legendas geradas`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui gerar as legendas.");
    } finally {
      setBusy((b) => ({ ...b, captions: false }));
    }
  };

  const render = async () => {
    if (!project) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await save();
    setBusy((b) => ({ ...b, render: true }));
    try {
      const { generation } = await apiFetch<{ generation: Generation }>(`/api/editor/projects/${project.id}/render`, { method: "POST" });
      setExports((prev) => [generation, ...prev]);
      setProject((p) => (p ? { ...p, exports: [generation.id, ...p.exports] } : p));
      toast("Exportando… o vídeo aparece em Exportar quando ficar pronto.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui exportar.");
    } finally {
      setBusy((b) => ({ ...b, render: false }));
    }
  };

  // Acompanha as exportações em andamento.
  const runningKey = exports.filter((g) => g.status === "running" || g.status === "pending").map((g) => g.id).join(",");
  useEffect(() => {
    if (!runningKey) return;
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        runningKey.split(",").map((id) => apiFetch<{ generation: Generation }>(`/api/editor/jobs/${id}`, { method: "POST" }).then((r) => r.generation).catch(() => null)),
      );
      const done = updates.filter((g): g is Generation => Boolean(g) && g!.status !== "running");
      if (!done.length) return;
      setExports((prev) => prev.map((g) => done.find((d) => d.id === g.id) ?? g));
      for (const g of done) {
        if (g.status === "done") toast.success("Vídeo exportado");
        else toast.error(g.error ?? "A exportação falhou");
      }
      loadLibrary();
    }, 2500);
    return () => clearInterval(timer);
  }, [runningKey, loadLibrary]);

  const addToTimeline = async (generationId: string) => {
    if (!project) return openVideo(generationId);
    await save();
    try {
      const { project: updated } = await apiFetch<{ project: EditorProject }>(`/api/editor/projects/${project.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId }),
      });
      change((p) => ({ ...p, sources: updated.sources, clips: updated.clips }));
      toast.success("Vídeo adicionado ao fim da timeline");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui adicionar o vídeo.");
    }
  };

  // Enviar vídeo do computador: com projeto aberto entra no fim da timeline; sem projeto, abre um projeto novo.
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pickUpload = () => uploadRef.current?.click();
  const uploadVideo = async (file: File) => {
    if (!file.type.startsWith("video/")) return toast.error("Escolha um arquivo de vídeo (mp4, mov, webm…).");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const { generation } = await apiFetch<{ generation: Generation }>("/api/uploads", { method: "POST", body: form });
      toast.success(`“${file.name}” enviado`);
      if (project) await addToTimeline(generation.id);
      else await openVideo(generation.id);
      loadLibrary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui enviar o vídeo.");
    } finally {
      setUploading(false);
    }
  };

  const deleteProject = async (id: string) => {
    if (!window.confirm("Apagar este projeto do editor? Os vídeos exportados continuam no hub.")) return;
    await apiFetch(`/api/editor/projects/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (project?.id === id) {
      setProject(null);
      latest.current = null;
      window.history.replaceState(null, "", "/editor");
    }
    loadLibrary();
  };

  const deleteExport = async (id: string) => {
    await apiFetch(`/api/generations/${id}`, { method: "DELETE" }).catch(() => undefined);
    setExports((prev) => prev.filter((g) => g.id !== id));
  };

  // ---------- Layout ----------

  const toolbar = (
    <>
      <Clapperboard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-heading font-bold">Editor</span>
      {project && (
        <>
          <label htmlFor="project-title" className="sr-only">
            Nome do projeto
          </label>
          <Input
            id="project-title"
            value={project.title}
            onChange={(e) => {
              const title = e.target.value;
              change((p) => ({ ...p, title }), false);
            }}
            className="h-7 max-w-64 min-w-0 text-sm"
          />
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {saveState === "saving" ? <Loader2 className="size-3 animate-spin" /> : saveState === "saved" ? <Check className="size-3 text-ok" /> : null}
            {saveState === "saved" ? "Salvo" : saveState === "saving" ? "Salvando…" : "Alterado"}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Desfazer (Ctrl+Z)" disabled={!history.undo} onClick={undo}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Refazer (Ctrl+Shift+Z)" disabled={!history.redo} onClick={redo}>
            <Redo2 />
          </Button>
          <Button size="xs" className="bg-rec text-white hover:bg-rec/85" disabled={busy.render} onClick={render}>
            {busy.render ? <Loader2 className="animate-spin" /> : <Download />}
            Exportar
          </Button>
        </>
      )}
    </>
  );

  return (
    <Workspace id="editor" className="h-full" toolbar={toolbar} presets={PRESETS}>
      <WorkspacePanel id="biblioteca" title="Biblioteca" defaultSize={18} minSize={12} icon={<FolderOpen className="size-3.5 text-muted-foreground" />}>
        <input
          ref={uploadRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) uploadVideo(file);
          }}
        />
        <Library
          projects={projects}
          videos={videos}
          activeId={project?.id ?? null}
          hasProject={Boolean(project)}
          uploading={uploading}
          onUpload={pickUpload}
          onOpenProject={openProject}
          onOpenVideo={openVideo}
          onAdd={addToTimeline}
          onDeleteProject={deleteProject}
        />
      </WorkspacePanel>

      <WorkspacePanel id="centro" title="Edição" bare collapsible={false} defaultSize={54} minSize={30}>
        <Workspace id="editor-centro" orientation="vertical" className="min-h-0 flex-1">
          <WorkspacePanel id="previa" title="Prévia" defaultSize={64} minSize={25} collapsible={false} icon={<Film className="size-3.5 text-muted-foreground" />}>
            <div className="flex h-full flex-col">
              <div ref={fitRef} className="flex min-h-0 flex-1 items-center justify-center p-3">
                {loading ? (
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                ) : !project ? (
                  <div className="max-w-sm text-center text-sm text-muted-foreground">
                    <p className="font-heading text-lg font-bold text-foreground">Nenhum vídeo aberto</p>
                    <p className="mt-1">Envie um vídeo do seu computador, abra um da Biblioteca, ou use o botão “Editor” em qualquer vídeo do chat e dos estúdios.</p>
                    <Button className="mt-4 bg-rec text-white hover:bg-rec/85" disabled={uploading} onClick={pickUpload}>
                      {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                      {uploading ? "Enviando…" : "Enviar vídeo"}
                    </Button>
                  </div>
                ) : (
                  fit.w > 0 && (
                    <div className="overflow-hidden rounded-lg border bg-black" style={{ width: fit.w, height: fit.h }}>
                      <Player
                        key={project.id}
                        ref={playerRef}
                        component={CreativeComposition}
                        inputProps={{ project }}
                        durationInFrames={Math.max(1, Math.round(total * fps))}
                        fps={fps}
                        compositionWidth={project.width}
                        compositionHeight={project.height}
                        style={{ width: "100%", height: "100%" }}
                        clickToPlay
                        acknowledgeRemotionLicense
                      />
                    </div>
                  )
                )}
              </div>
              {project && (
                <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t px-3 py-2">
                  <Button variant="outline" size="icon-sm" aria-label="Voltar ao início" onClick={() => seek(0)}>
                    <SkipBack />
                  </Button>
                  <Button size="sm" onClick={() => playerRef.current?.toggle()}>
                    {playing ? <Pause /> : <Play />}
                    {playing ? "Pausar" : "Play"}
                  </Button>
                  <span className="rounded-md bg-foreground px-2.5 py-0.5 font-mono text-sm text-background tabular-nums">{formatTime(time)}</span>
                  <Button variant="outline" size="sm" onClick={split}>
                    <Scissors />
                    Dividir
                  </Button>
                  <Button variant="outline" size="sm" disabled={!selection} onClick={removeSelected}>
                    <Trash2 />
                    Apagar
                  </Button>
                  <span className="hidden text-[0.6875rem] tracking-wider text-muted-foreground uppercase lg:inline">
                    {project.width}×{project.height} · espaço, S, Delete, Ctrl+Z
                  </span>
                </div>
              )}
            </div>
          </WorkspacePanel>
          <WorkspacePanel id="timeline" title="Timeline" defaultSize={36} minSize={15}>
            {project ? (
              <Timeline project={project} time={time} selection={selection} onSeek={seek} onSelect={setSelection} onCheckpoint={checkpoint} onChange={(fn) => change(fn, false)} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">A timeline aparece quando um vídeo estiver aberto.</p>
            )}
          </WorkspacePanel>
        </Workspace>
      </WorkspacePanel>

      <WorkspacePanel id="inspetor" title="Propriedades" defaultSize={28} minSize={18} bodyClassName="overflow-hidden">
        {project ? (
          <Inspector
            project={project}
            time={time}
            selection={selection}
            exports={exports}
            busy={busy}
            onSeek={seek}
            onSelect={setSelection}
            onChange={change}
            onAutoCaptions={autoCaptions}
            onRender={render}
            onSplit={split}
            onDeleteExport={deleteExport}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Abra um vídeo para editar legendas, estilo e cortes.</p>
        )}
      </WorkspacePanel>
    </Workspace>
  );
}

function Library({
  projects,
  videos,
  activeId,
  hasProject,
  uploading,
  onUpload,
  onOpenProject,
  onOpenVideo,
  onAdd,
  onDeleteProject,
}: {
  projects: EditorProjectSummary[];
  videos: Generation[];
  activeId: string | null;
  hasProject: boolean;
  uploading: boolean;
  onUpload: () => void;
  onOpenProject: (id: string) => void;
  onOpenVideo: (id: string) => void;
  onAdd: (id: string) => void;
  onDeleteProject: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-3">
      <Button className="w-full bg-rec text-white hover:bg-rec/85" disabled={uploading} onClick={onUpload} title="Enviar um vídeo do seu computador">
        {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        {uploading ? "Enviando…" : hasProject ? "Enviar vídeo para a timeline" : "Enviar vídeo"}
      </Button>
      <section className="flex flex-col gap-1">
        <h3 className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Projetos</h3>
        {projects.length === 0 && <p className="text-xs text-muted-foreground">Nenhum projeto ainda.</p>}
        {projects.map((p) => (
          <div key={p.id} className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted", p.id === activeId && "bg-muted font-medium")}>
            <button type="button" className="min-w-0 flex-1 truncate px-2 py-1.5 text-left" onClick={() => onOpenProject(p.id)}>
              {p.title}
            </button>
            <Button variant="ghost" size="icon-xs" aria-label={`Apagar projeto ${p.title}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onDeleteProject(p.id)}>
              <Trash2 />
            </Button>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Vídeos do hub</h3>
        {videos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum vídeo pronto no hub ainda.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
          {videos.map((v) => (
            <div key={v.id} className="flex flex-col overflow-hidden rounded-md border bg-card">
              <video src={mediaUrl(v)} preload="metadata" muted playsInline className="aspect-[3/4] w-full bg-black object-contain" />
              <p className="line-clamp-2 px-1.5 pt-1 text-[0.6875rem]" title={v.prompt}>
                {v.prompt}
              </p>
              <div className="flex gap-1 p-1.5">
                <Button variant="outline" size="xs" className="flex-1" onClick={() => onOpenVideo(v.id)}>
                  Abrir
                </Button>
                {hasProject && (
                  <Button variant="outline" size="icon-xs" aria-label="Adicionar ao fim da timeline" title="Adicionar ao fim da timeline" onClick={() => onAdd(v.id)}>
                    <Plus />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
