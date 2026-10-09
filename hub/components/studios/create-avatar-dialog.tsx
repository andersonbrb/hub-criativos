"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, Plus, ShieldCheck, Trash2, UserRoundPlus, Video, X } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Field } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/generations";

// Criar um avatar novo no HeyGen, como no app deles: por foto, por descrição ou gêmeo digital (vídeo + consentimento).

type Mode = "photo" | "prompt" | "twin";
export type AvatarCreation = {
  id: string;
  mode: Mode;
  name: string;
  status: "training" | "ready" | "failed" | "consent";
  detail: string | null;
  consentUrl: string | null;
  preview: string | null;
  createdAt: string;
};
type Credits = { remaining: number | null; resetsAt: string | null; plan: string | null } | null;

const MODE_LABEL: Record<Mode, string> = { photo: "Foto", prompt: "Descrição", twin: "Gêmeo digital" };
const STATUS: Record<AvatarCreation["status"], { status: "run" | "ok" | "warn" | "idle"; label: string }> = {
  training: { status: "run", label: "Treinando" },
  consent: { status: "warn", label: "Falta consentimento" },
  ready: { status: "ok", label: "Pronto" },
  failed: { status: "warn", label: "Falhou" },
};

// Lista das criações + saldo, com atualização enquanto alguma ainda treina. onReady recarrega "Meus avatares".
export function useAvatarCreations(onReady: () => void) {
  const [creations, setCreations] = useState<AvatarCreation[]>([]);
  const [credits, setCredits] = useState<Credits>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<{ creations: AvatarCreation[]; credits: Credits }>("/api/heygen/avatars");
      setCreations((prev) => {
        if (d.creations.some((c) => c.status === "ready" && prev.find((p) => p.id === c.id)?.status !== "ready")) onReady();
        return d.creations;
      });
      setCredits(d.credits);
    } catch {
      // HeyGen desconectado: a criação mostra o erro ao tentar.
    }
  }, [onReady]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do servidor
    load();
  }, [load]);

  const pending = creations.some((c) => c.status === "training" || c.status === "consent");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [pending, load]);

  const dismiss = async (id: string) => {
    await apiFetch(`/api/heygen/avatars/${id}`, { method: "DELETE" }).catch(() => undefined);
    setCreations((prev) => prev.filter((c) => c.id !== id));
  };

  return { creations, credits, reload: load, add: (c: AvatarCreation) => setCreations((prev) => [c, ...prev]), dismiss };
}

export function CreationsList({ creations, onDismiss }: { creations: AvatarCreation[]; onDismiss: (id: string) => void }) {
  // Prontos continuam na lista até você tirar (lixeira), para ver que já dá para usar.
  const visible = creations;
  if (!visible.length) return null;
  return (
    <div className="flex flex-col gap-2 border bg-muted/30 p-2">
      <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Avatares em criação</span>
      {visible.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-sm">
          <div className="size-9 shrink-0 overflow-hidden bg-muted">
            {c.preview && (
              // eslint-disable-next-line @next/next/no-img-element -- prévia remota do HeyGen
              <img src={c.preview} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{c.name}</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              {MODE_LABEL[c.mode]}
              {c.status === "ready" ? " · já aparece em Meus avatares" : c.status === "training" ? " · o HeyGen avisa quando terminar; a lista atualiza sozinha" : ""}
              {c.status === "failed" && c.detail ? ` · ${c.detail}` : ""}
            </p>
          </div>
          {c.consentUrl && c.status !== "ready" && (
            <Button size="xs" variant="outline" asChild>
              <a href={c.consentUrl} target="_blank" rel="noreferrer">
                <ShieldCheck />
                Consentimento
              </a>
            </Button>
          )}
          <StatusBadge status={STATUS[c.status].status} label={STATUS[c.status].label} />
          <Button variant="ghost" size="icon-xs" aria-label={`Tirar ${c.name} da lista`} onClick={() => onDismiss(c.id)}>
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}

function FilePick({ label, accept, files, multiple, max, onChange, icon }: {
  label: string;
  accept: string;
  files: File[];
  multiple?: boolean;
  max?: number;
  onChange: (files: File[]) => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="flex items-center gap-1 border bg-muted py-0.5 pr-1 pl-2 text-xs">
          <span className="max-w-48 truncate">{f.name}</span>
          <button type="button" aria-label={`Remover ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="p-0.5 hover:bg-background">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {(!max || files.length < max) && (
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            {icon}
            {label}
            <input
              type="file"
              accept={accept}
              multiple={multiple}
              className="sr-only"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                onChange(multiple ? [...files, ...picked].slice(0, max) : picked.slice(0, 1));
              }}
            />
          </label>
        </Button>
      )}
    </div>
  );
}

export function CreateAvatarDialog({ credits, onCreated }: { credits: Credits; onCreated: (c: AvatarCreation) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("photo");
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File[]>([]);
  const [video, setVideo] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<File[]>([]);
  const [aspect, setAspect] = useState("9:16");
  const [busy, setBusy] = useState(false);

  const ready =
    name.trim() && (mode === "photo" ? photo.length === 1 : mode === "twin" ? video.length === 1 : prompt.trim().length >= 10);

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("mode", mode);
      form.set("name", name);
      if (mode === "photo") form.set("photo", photo[0]);
      if (mode === "twin") form.set("video", video[0]);
      if (mode === "prompt") {
        form.set("prompt", prompt);
        form.set("aspectRatio", aspect);
        refs.forEach((f) => form.append("references", f));
      }
      const { creation } = await apiFetch<{ creation: AvatarCreation }>("/api/heygen/avatars", { method: "POST", body: form });
      onCreated(creation);
      toast.success(
        mode === "twin" && creation.consentUrl
          ? "Gêmeo digital enviado. Falta a pessoa do vídeo dar o consentimento (botão na lista)."
          : "Avatar enviado ao HeyGen. Ele aparece em Meus avatares quando terminar de treinar.",
      );
      setOpen(false);
      setName("");
      setPhoto([]);
      setVideo([]);
      setPrompt("");
      setRefs([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui criar o avatar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserRoundPlus />
          Criar avatar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar avatar no HeyGen</DialogTitle>
          <DialogDescription>
            Escolha como criar. O avatar fica na sua conta HeyGen e aparece em Meus avatares quando terminar de treinar.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="photo">Foto</TabsTrigger>
            <TabsTrigger value="prompt">Descrição</TabsTrigger>
            <TabsTrigger value="twin">Gêmeo digital</TabsTrigger>
          </TabsList>

          <div className="mt-3">
            <Field label="Nome do avatar" id="avatar-name">
              <Input id="avatar-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Camila cozinha" maxLength={80} />
            </Field>
          </div>

          <TabsContent value="photo" className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Uma foto da pessoa, de frente, rosto bem visível e boa luz. Vira um avatar que fala com qualquer roteiro ou narração.</p>
            <FilePick label="Escolher foto" accept="image/png,image/jpeg,image/webp" files={photo} onChange={setPhoto} icon={<ImagePlus />} />
          </TabsContent>

          <TabsContent value="prompt" className="mt-3 flex flex-col gap-3">
            <Field label="Como é a pessoa" id="avatar-prompt">
              <Textarea
                id="avatar-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Mulher de 35 anos, cabelo castanho preso, camiseta branca, cozinha clara ao fundo, sorriso natural, estilo UGC gravado no celular"
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Proporção" id="avatar-aspect">
                <Select value={aspect} onValueChange={setAspect}>
                  <SelectTrigger id="avatar-aspect" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["9:16", "4:5", "1:1", "16:9", "auto"].map((a) => (
                      <SelectItem key={a} value={a}>
                        {a === "auto" ? "Automática" : a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Referências (opcional, até 3)</span>
                <FilePick label="Imagens" accept="image/png,image/jpeg,image/webp" files={refs} multiple max={3} onChange={setRefs} icon={<Plus />} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="twin" className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Vídeo da pessoa falando de frente para a câmera, sem cortes, boa luz e áudio limpo (de 2 a 5 minutos dá o melhor resultado). Depois de enviar, a pessoa do
              vídeo precisa abrir o link de consentimento e aprovar; sem isso o HeyGen não libera o avatar. O link vale 24 horas.
            </p>
            <FilePick label="Escolher vídeo" accept="video/mp4,video/quicktime,video/webm" files={video} onChange={setVideo} icon={<Video />} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {credits?.remaining != null ? (
              <>
                Saldo HeyGen: <b className="font-mono text-foreground tabular-nums">{credits.remaining.toLocaleString("pt-BR")}</b> créditos premium
                {credits.resetsAt ? ` · renova em ${new Date(credits.resetsAt).toLocaleDateString("pt-BR")}` : ""}
              </>
            ) : (
              "Usa os créditos do seu plano HeyGen."
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" asChild size="sm">
              <a href="https://app.heygen.com/avatars" target="_blank" rel="noreferrer">
                <ExternalLink />
                Abrir no HeyGen
              </a>
            </Button>
            <Button size="sm" className="bg-rec text-white hover:bg-rec/85" disabled={!ready || busy} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" /> : <UserRoundPlus />}
              {busy ? "Enviando…" : "Criar avatar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
