"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  File as FileIcon,
  FileAudio,
  FileText,
  FileVideo,
  Images,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { BlackModeBanner, BlackModeButton, blackComposerClass, useBlackMode } from "@/components/black-mode";
import { Markdown } from "@/components/chat/markdown";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { GenerationCard } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Workspace, WorkspacePanel, type WorkspacePreset } from "@/components/workspace";
import { getAgentProfile } from "@/lib/agent-profiles";
import { toolLabel, type Attachment, type AttachmentKind, type ChatEvent, type ChatItem, type ChatSummary } from "@/lib/chat";
import { apiFetch, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

type ViewItem = ChatItem | { kind: "error"; text: string };

const PRESETS: WorkspacePreset[] = [
  { id: "padrao", label: "Padrão", layout: { conversas: 16, conversa: 84, midia: "collapsed" } },
  { id: "lado", label: "Com mídia", layout: { conversas: 16, conversa: 56, midia: 28 } },
  { id: "conversa", label: "Foco na conversa", layout: { conversas: "collapsed", conversa: 100, midia: "collapsed" } },
  { id: "midia", label: "Foco na mídia", layout: { conversas: "collapsed", conversa: 45, midia: 55 } },
];

const SUGGESTIONS = [
  "O que já foi gerado no hub até agora?",
  "Leia esta página de vendas e me dê 5 ganchos por mecanismo: ",
  "Gere 2 frames 9:16 do produto da foto anexada, operação COD Chile",
  "Coloque legendas no vídeo anexado e exporte",
];

const money = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

function kindOf(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("text/") || /\.(txt|md|csv|json|srt|vtt)$/i.test(file.name)) return "text";
  return "file";
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "video" ? FileVideo : kind === "audio" ? FileAudio : kind === "pdf" || kind === "text" ? FileText : FileIcon;
  return <Icon className={className} aria-hidden />;
}

const sizeLabel = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

// Atualiza a mesma geração onde quer que ela apareça na conversa.
function patchGenerations(items: ViewItem[], changed: Generation[]): ViewItem[] {
  const byId = new Map(changed.map((g) => [g.id, g]));
  return items.map((it) =>
    it.kind === "tool" && it.generations.some((g) => byId.has(g.id)) ? { ...it, generations: it.generations.map((g) => byId.get(g.id) ?? g) } : it,
  );
}

function applyEvent(items: ViewItem[], e: ChatEvent): ViewItem[] {
  const last = items.at(-1);
  switch (e.type) {
    case "user":
      return [...items, e.item];
    case "text":
    case "status": {
      const kind = e.type === "text" ? "assistant" : "status";
      if (last?.kind === kind) return [...items.slice(0, -1), { ...last, text: last.text + e.delta }];
      return [...items, { kind, text: e.delta }];
    }
    case "tool":
      return [...items, e.item];
    case "tool_done":
      return patchGenerations(
        items.map((it) => (it.kind === "tool" && it.id === e.id ? { ...it, done: true, error: e.error, summary: e.summary, generations: e.generations } : it)),
        e.generations,
      );
    case "error":
      return [...items, { kind: "error", text: e.message }];
    default:
      return items;
  }
}

// agentId: a mesma tela, mas conversando com um agente (lib/agent-profiles.ts). Lista, URL e sugestões passam a ser dele.
export function ChatView({
  initialId,
  initialDraft,
  configured,
  agentId,
}: {
  initialId: string | null;
  initialDraft: string;
  configured: boolean;
  agentId?: string;
}) {
  const agent = getAgentProfile(agentId);
  const basePath = agent ? `/agentes/${agent.id}` : "/chat";
  const suggestions = agent?.suggestions ?? SUGGESTIONS;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [items, setItems] = useState<ViewItem[]>([]);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<{ file: File; url: string; kind: AttachmentKind }[]>([]);
  const [dragging, setDragging] = useState(false);
  // Modo Black: o mesmo agente, com as mesmas ferramentas, no modelo sem censura da Venice. Estado único do hub.
  const [black, toggleBlack] = useBlackMode();
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true);

  const active = chats.find((c) => c.id === activeId);

  const loadChats = useCallback(async () => {
    try {
      setChats((await apiFetch<{ chats: ChatSummary[] }>(agentId ? `/api/chat?agent=${encodeURIComponent(agentId)}` : "/api/chat")).chats);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui carregar as conversas.");
    }
  }, [agentId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const selectUrl = useCallback(
    (id: string | null) => window.history.replaceState(null, "", id ? `${basePath}?c=${id}` : basePath),
    [basePath],
  );

  const open = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    selectUrl(id);
    setLoading(true);
    try {
      const data = await apiFetch<{ items: ChatItem[] }>(`/api/chat/${id}`);
      setItems(data.items);
      stickRef.current = true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui abrir a conversa.");
      setActiveId(null);
      selectUrl(null);
    } finally {
      setLoading(false);
    }
  }, [selectUrl]);

  useEffect(() => {
    if (initialId) open(initialId);
  }, [initialId, open]);

  // Rola até o fim enquanto chegam respostas, a não ser que o usuário tenha subido para ler.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Acompanha as gerações assíncronas que aparecem na conversa até ficarem prontas.
  const generations = items.flatMap((it) => (it.kind === "tool" ? it.generations : []));
  const pending = generations.filter((g) => g.status === "pending" || g.status === "running");
  const pendingKey = [...new Set(pending.map((g) => `${g.tool}:${g.id}`))].join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      const results = await Promise.all(
        pendingKey.split(",").map(async (key) => {
          const [tool, id] = key.split(":");
          return apiFetch<{ generation: Generation }>(`/api/${tool}/jobs/${id}`, { method: "POST" })
            .then((r) => r.generation)
            .catch(() => null);
        }),
      );
      const changed = results.filter((g): g is Generation => Boolean(g) && g!.status !== "running" && g!.status !== "pending");
      if (changed.length) setItems((prev) => patchGenerations(prev, changed));
    }, 6000);
    return () => clearInterval(timer);
  }, [pendingKey]);

  function newConversation() {
    abortRef.current?.abort();
    setActiveId(null);
    setItems([]);
    selectUrl(null);
    inputRef.current?.focus();
  }

  async function removeChat(id: string) {
    await apiFetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => undefined);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) newConversation();
  }

  async function removeGeneration(id: string) {
    try {
      await apiFetch(`/api/generations/${id}`, { method: "DELETE" });
      setItems((prev) => prev.map((it) => (it.kind === "tool" ? { ...it, generations: it.generations.filter((g) => g.id !== id) } : it)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui apagar.");
    }
  }

  function addFiles(list: FileList | File[]) {
    const added = [...list].map((file) => ({ file, kind: kindOf(file), url: URL.createObjectURL(file) }));
    setFiles((prev) => [...prev, ...added].slice(0, 10));
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, j) => j !== index);
    });
  }

  async function send(text = draft) {
    const message = text.trim();
    if ((!message && !files.length) || running) return;
    const form = new FormData();
    form.set("text", message);
    if (activeId) form.set("chatId", activeId);
    if (black) form.set("mode", "black");
    if (agent && !activeId) form.set("agentId", agent.id);
    files.forEach((f) => form.append("files", f.file));

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setDraft("");
    setFiles([]);
    stickRef.current = true;

    try {
      const res = await fetch("/api/chat", { method: "POST", body: form, signal: controller.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "chat") {
            setActiveId(event.chat.id);
            selectUrl(event.chat.id);
            setChats((prev) => [event.chat, ...prev.filter((c) => c.id !== event.chat.id)]);
          } else {
            setItems((prev) => applyEvent(prev, event));
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setItems((prev) => [...prev, { kind: "error", text: err instanceof Error ? err.message : "Falha na conexão." }]);
        setDraft((d) => d || message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }

  const empty = !loading && items.length === 0;

  // Mídia da conversa: gerações das ferramentas e anexos do usuário, mais recentes primeiro.
  const media = [...new Map(generations.map((g) => [g.id, g])).values()].reverse();
  const attachments = items.flatMap((it) => (it.kind === "user" ? it.attachments : [])).reverse();

  const toolbar = (
    <>
      <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-heading font-bold">{agent ? `Agente de ${agent.name}` : "Chat principal"}</span>
      {active && <span className="min-w-0 truncate text-sm text-muted-foreground">· {active.title}</span>}
      {active && active.costUsd > 0 && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums" title="Gasto estimado com o Claude nesta conversa">
          Claude {money(active.costUsd)}
        </span>
      )}
      {black && <BlackModeButton on onToggle={toggleBlack} />}
      <Button variant="outline" size="xs" className="shrink-0" onClick={newConversation}>
        <MessageSquarePlus />
        Nova conversa
      </Button>
    </>
  );

  return (
    <Workspace id={agent ? `agente-${agent.id}` : "chat"} className="h-full" toolbar={toolbar} presets={PRESETS}>
      <WorkspacePanel id="conversas" title="Conversas" defaultSize={16} minSize={12}>
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Conversas">
          {chats.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">Nenhuma conversa ainda.</p>}
          {chats.map((c) => (
            <div key={c.id} className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted", c.id === activeId && "bg-muted font-medium")}>
              <button type="button" onClick={() => open(c.id)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left">
                {c.title}
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Apagar conversa ${c.title}`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => removeChat(c.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </nav>
      </WorkspacePanel>

      <WorkspacePanel id="conversa" title="Conversa" defaultSize={84} fill minSize={30} collapsible={false} bodyClassName="overflow-hidden">
        <div
          className="relative flex h-full flex-col"
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes("Files")) setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-rec/70 bg-background/80 text-sm font-medium">
              Solte os arquivos para anexar
            </div>
          )}
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 md:px-6">
              {loading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
              {empty && (
                <div className="flex flex-col items-center gap-5 py-10 text-center">
                  <div>
                    <p className="font-heading text-2xl font-bold">{agent ? `Agente de ${agent.name}` : "O que vamos produzir?"}</p>
                    <p className="mt-1 max-w-[52ch] text-sm text-muted-foreground">
                      {agent ? `${agent.role} ` : ""}
                      {agent ? "Tem as mesmas ferramentas do chat principal" : "Este chat vê tudo que já foi gerado no hub, o quadro do Fluxo e os playbooks, e usa ElevenLabs, HeyGen, FLORA, Higgsfield, o editor de vídeo e a web"}
                      . Anexe qualquer arquivo: foto do produto, vídeo, áudio, PDF ou texto.
                    </p>
                  </div>
                  <div className="grid w-full gap-2 sm:grid-cols-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setDraft(s);
                          inputRef.current?.focus();
                        }}
                        className="rounded-lg border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {items.map((it, i) => (
                <Item key={it.kind === "tool" ? it.id : i} item={it} onDelete={removeGeneration} />
              ))}
              {running && items.at(-1)?.kind !== "assistant" && (
                <TextShimmer className="text-sm" duration={1.5}>
                  Trabalhando…
                </TextShimmer>
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="border-t p-3 md:px-6"
          >
            <div className="mx-auto max-w-3xl">
              {!configured && !black && (
                <p className="mb-2 text-xs text-warn">
                  O chat roda no Claude Code desta máquina (sua assinatura): instale a extensão do Claude Code no VS Code e entre com a conta do claude.ai.
                </p>
              )}
              {black && <BlackModeBanner />}
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-xl border bg-card p-2 focus-within:border-foreground/30",
                  black && blackComposerClass,
                )}
              >
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-1 pt-1">
                    {files.map((f, i) => (
                      <div key={f.url} className="relative">
                        {f.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element -- prévia local
                          <img src={f.url} alt={f.file.name} className="size-14 rounded-md border object-cover" />
                        ) : (
                          <div className="flex h-14 max-w-48 items-center gap-2 rounded-md border bg-muted/50 px-2.5">
                            <KindIcon kind={f.kind} className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">{f.file.name}</p>
                              <p className="text-[11px] text-muted-foreground">{sizeLabel(f.file.size)}</p>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label={`Remover ${f.file.name}`}
                          onClick={() => removeFile(i)}
                          className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label htmlFor="chat-input" className="sr-only">
                  Mensagem
                </label>
                <Textarea
                  id="chat-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                      e.preventDefault();
                      addFiles(e.clipboardData.files);
                    }
                  }}
                  placeholder={
                    agent
                      ? `Peça algo ao agente de ${agent.name}…`
                      : "Peça qualquer coisa: analisar uma página, criar ganchos, gerar narração, avatar, frames, vídeos, legendar, editar…"
                  }
                  rows={1}
                  className="max-h-56 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                    <Paperclip />
                    Anexar
                  </Button>
                  <BlackModeButton on={black} onToggle={toggleBlack} />
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">imagem, vídeo, áudio, PDF ou texto · arraste ou cole</span>
                  <span className="flex-1" />
                  {running ? (
                    <Button type="button" size="icon" variant="outline" aria-label="Parar" onClick={() => abortRef.current?.abort()}>
                      <Square className="fill-current" />
                    </Button>
                  ) : (
                    <Button type="submit" size="icon" aria-label="Enviar" disabled={(!configured && !black) || (!draft.trim() && !files.length)}>
                      <ArrowUp />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        id="midia"
        title="Mídia da conversa"
        defaultSize={28}
        minSize={15}
        defaultCollapsed
        badge={media.length + attachments.length}
        icon={<Images className="size-3.5 text-muted-foreground" />}
      >
        <div className="flex flex-col gap-4 p-3 @container">
          {media.length === 0 && attachments.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">O que for gerado ou anexado nesta conversa aparece aqui.</p>
          )}
          {media.length > 0 && (
            <div className="grid grid-cols-1 gap-3 @[22rem]:grid-cols-2 @[36rem]:grid-cols-3">
              {media.map((g) => (
                <GenerationCard key={g.id} g={g} onDelete={removeGeneration} meta={String(g.params.modelName || g.params.voiceName || g.params.lookName || g.params.editLabel || g.tool)} />
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Anexos</h3>
              {attachments.map((a, i) => (
                <AttachmentChip key={`${a.url}-${i}`} a={a} />
              ))}
            </div>
          )}
        </div>
      </WorkspacePanel>
    </Workspace>
  );
}

function AttachmentChip({ a }: { a: Attachment }) {
  const actions = a.generationId && a.kind === "video" && (
    <span className="flex gap-1">
      <a href={`/ver/${a.generationId}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Visualizar
      </a>
      ·
      <a href={`/editor?gen=${a.generationId}`} className="underline-offset-2 hover:underline">
        Editor
      </a>
    </span>
  );
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
      {a.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- mídia local anexada
        <img src={a.url} alt="" className="size-8 shrink-0 rounded object-cover" />
      ) : (
        <KindIcon kind={a.kind} className="size-4 shrink-0 text-muted-foreground" />
      )}
      <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline" title={a.name}>
        {a.name}
      </a>
      <span className="shrink-0 text-muted-foreground">{actions}</span>
    </div>
  );
}

function Item({ item, onDelete }: { item: ViewItem; onDelete: (id: string) => void }) {
  if (item.kind === "user") {
    const images = item.attachments.filter((a) => a.kind === "image");
    const others = item.attachments.filter((a) => a.kind !== "image");
    const hideText = item.attachments.length > 0 && /^\((arquivo anexado|\d+ arquivos anexados|imagem anexada)/.test(item.text);
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-2 self-end">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {images.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- mídia local anexada */}
                <img src={a.url} alt={a.name} className="max-h-40 rounded-lg border object-contain" />
              </a>
            ))}
          </div>
        )}
        {others.map((a, i) => (
          <div key={`${a.url}-${i}`} className="w-72 max-w-full">
            <AttachmentChip a={a} />
          </div>
        ))}
        {item.text && !hideText && (
          <div className="rounded-xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">{item.text}</div>
        )}
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="text-sm">
        <Markdown text={item.text} />
      </div>
    );
  }
  if (item.kind === "status") {
    return <p className="border-l-2 pl-3 text-xs text-muted-foreground italic">{item.text}</p>;
  }
  if (item.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        {item.text}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground",
          item.error && "border-destructive/50 text-destructive",
        )}
      >
        {!item.done ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : item.error ? (
          <AlertTriangle className="size-3 shrink-0" />
        ) : item.summary ? (
          <Check className="size-3 shrink-0 text-ok" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="shrink-0 font-medium">{toolLabel(item.name)}</span>
        {item.detail && <span className="min-w-0 truncate font-mono">{item.detail}</span>}
        <span className="flex-1" />
        {item.done && item.summary && <span className="shrink-0 truncate">{item.summary}</span>}
      </div>
      {item.generations.length > 0 && (
        <div className={cn("grid gap-3", item.generations.some((g) => g.kind !== "audio") ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1")}>
          {item.generations.map((g) => (
            <GenerationCard key={g.id} g={g} onDelete={onDelete} meta={String(g.params.modelName || g.params.voiceName || g.params.lookName || g.params.editLabel || g.tool)} />
          ))}
        </div>
      )}
    </div>
  );
}
