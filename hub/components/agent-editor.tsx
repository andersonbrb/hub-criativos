"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, FileText, FileVideo, Image as ImageIcon, Loader2, Settings2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/generations";
import { cn } from "@/lib/utils";

// "Editar agente": instruções, contexto e arquivos de referência do usuário para um agente.
// Vale para as conversas NOVAS do agente, no Claude e no Modo Black (lib/server/agent-settings.ts).

type AgentFile = { id: string; name: string; kind: "image" | "video" | "audio" | "pdf" | "text"; size: number; url: string };
type Settings = { instructions: string; context: string; files: AgentFile[]; updatedAt: string | null };
type Config = {
  profile: { name: string; role: string; instructions: string };
  settings: Settings;
  limits: { images: number; pdfs: number; totalMb: number };
};

const sizeLabel = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function KindIcon({ kind }: { kind: AgentFile["kind"] }) {
  const Icon = kind === "video" ? FileVideo : kind === "audio" ? FileAudio : kind === "image" ? ImageIcon : FileText;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

const isCustomized = (s?: Settings) => Boolean(s && (s.instructions.trim() || s.context.trim() || s.files.length));

export function AgentEditorButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [instructions, setInstructions] = useState("");
  const [context, setContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega já ao abrir a página, para o botão mostrar se o agente está personalizado.
  useEffect(() => {
    let cancelled = false;
    apiFetch<Config>(`/api/agentes/${agentId}/config`)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setInstructions(c.settings.instructions);
        setContext(c.settings.context);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const dirty = config ? instructions !== config.settings.instructions || context !== config.settings.context : false;

  async function save() {
    setSaving(true);
    try {
      const { settings } = await apiFetch<{ settings: Settings }>(`/api/agentes/${agentId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions, context }),
      });
      setConfig((c) => (c ? { ...c, settings } : c));
      toast.success(`Agente de ${agentName} atualizado. Vale a partir da próxima conversa nova.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(list: FileList | File[]) {
    if (!list.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      [...list].forEach((f) => form.append("files", f));
      const { settings } = await apiFetch<{ settings: Settings }>(`/api/agentes/${agentId}/config`, { method: "POST", body: form });
      setConfig((c) => (c ? { ...c, settings: { ...settings, instructions: c.settings.instructions, context: c.settings.context } } : c));
      toast.success(list.length > 1 ? `${list.length} arquivos adicionados` : "Arquivo adicionado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui enviar.");
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(id: string) {
    try {
      const { settings } = await apiFetch<{ settings: Settings }>(`/api/agentes/${agentId}/config/files/${id}`, { method: "DELETE" });
      setConfig((c) => (c ? { ...c, settings: { ...settings, instructions: c.settings.instructions, context: c.settings.context } } : c));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui remover.");
    }
  }

  const customized = isCustomized(config?.settings);
  const files = config?.settings.files ?? [];

  return (
    <>
      <Button variant="outline" size="xs" className="shrink-0" onClick={() => setOpen(true)} title="Instruções, contexto e arquivos deste agente">
        <Settings2 />
        Editar agente
        {customized && <span className="size-1.5 rounded-full bg-rec" aria-label="personalizado" />}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle className="font-heading text-lg">Editar agente de {agentName}</SheetTitle>
            <SheetDescription>
              Instruções, contexto e arquivos para deixar o agente mais certeiro. Vale nas próximas conversas novas deste agente, no Claude e no Modo Black.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            {!config ? (
              <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">O que este agente já faz (padrão)</summary>
                  <p className="mt-2 text-xs text-muted-foreground">{config.profile.role}</p>
                  <pre className="mt-2 font-sans text-xs whitespace-pre-wrap text-muted-foreground">{config.profile.instructions}</pre>
                </details>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-foreground/85 uppercase">Suas instruções</span>
                  <Textarea
                    rows={6}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder={"Como ele deve trabalhar. Ex.:\n- Sempre 5 ganchos por pedido, em tabela\n- Tom de conversa, frases curtas\n- Nunca usar a palavra “milagre”"}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold tracking-wider text-foreground/85 uppercase">Contexto</span>
                  <Textarea
                    rows={6}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder={"O que ele precisa saber. Ex.: produto, oferta e preço, público, mercado/idioma, links da página de vendas, o que já funcionou e o que não funcionou."}
                  />
                </label>

                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-wider text-foreground/85 uppercase">Arquivos de referência</span>
                    <span className="text-[11px] text-muted-foreground">{files.length}/20</span>
                  </div>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
                    }}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-60"
                  >
                    {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                    {uploading ? "Enviando…" : "Clique ou arraste: imagens, vídeos, áudios, PDFs ou textos"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    accept="image/*,video/*,audio/*,application/pdf,.pdf,text/*,.md,.csv,.json,.srt,.vtt"
                    onChange={(e) => {
                      if (e.target.files) upload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Imagens e PDFs vão anexados em toda conversa nova (até {config.limits.images} imagens, {config.limits.pdfs} PDFs e {config.limits.totalMb} MB somados; prefira PDFs curtos). Vídeos e áudios ficam disponíveis para o agente assistir e usar. Textos entram nas instruções.
                  </p>
                  {files.length > 0 && (
                    <ul className="flex flex-col gap-1.5">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm">
                          {f.kind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element -- miniatura local
                            <img src={f.url} alt="" className="size-8 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                              <KindIcon kind={f.kind} />
                            </span>
                          )}
                          <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={f.name}>
                            {f.name}
                          </a>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sizeLabel(f.size)}</span>
                          <Button variant="ghost" size="icon-xs" aria-label={`Remover ${f.name}`} onClick={() => removeFile(f.id)}>
                            <Trash2 />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          <SheetFooter className="flex-row items-center justify-between border-t">
            <span className={cn("text-xs", dirty ? "text-warn" : "text-muted-foreground")}>{dirty ? "Alterações não salvas" : "Arquivos são salvos ao enviar"}</span>
            <Button className="bg-rec text-white hover:bg-rec/85" disabled={!config || !dirty || saving} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
