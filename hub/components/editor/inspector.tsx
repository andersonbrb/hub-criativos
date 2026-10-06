"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Download, Loader2, Plus, Scissors, Sparkles, Trash2 } from "lucide-react";

import { GenerationCard, SliderField } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPTION_FONTS,
  DEFAULT_STYLE,
  formatTime,
  newId,
  placeCaptions,
  placeClips,
  type CaptionStyle,
  type EditorProject,
} from "@/lib/editor";
import type { Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

import type { Selection } from "./timeline";

const STYLE_PRESETS: { label: string; style: Partial<CaptionStyle> }[] = [
  { label: "UGC amarelo", style: { ...DEFAULT_STYLE } },
  { label: "Caixa preta", style: { box: true, color: "#FFFFFF", highlight: "#FFD23F", outline: 14, font: "Arial Black" } },
  { label: "Limpo", style: { box: false, outline: 3, font: "Segoe UI Black", uppercase: false, pop: false, highlight: "#7CE38B" } },
  { label: "Impacto", style: { box: false, outline: 7, font: "Impact", uppercase: true, highlight: "#FF5A5F" } },
];

type Props = {
  project: EditorProject;
  time: number;
  selection: Selection;
  exports: Generation[];
  busy: { captions: boolean; render: boolean };
  onSeek: (t: number) => void;
  onSelect: (s: Selection) => void;
  onChange: (fn: (p: EditorProject) => EditorProject) => void;
  onAutoCaptions: (perCaption: number) => void;
  onRender: () => void;
  onSplit: () => void;
  onDeleteExport: (id: string) => void;
};

export function Inspector(props: Props) {
  const { selection } = props;
  const [tab, setTab] = useState("legendas");

  // Selecionar algo na timeline abre a aba correspondente.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- segue a seleção feita na timeline
    if (selection?.type === "clip") setTab("clipe");
    else if (selection?.type === "caption") setTab("legendas");
  }, [selection]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
      <TabsList className="mx-3 mt-2 grid w-auto grid-cols-4">
        <TabsTrigger value="legendas">Legendas</TabsTrigger>
        <TabsTrigger value="estilo">Estilo</TabsTrigger>
        <TabsTrigger value="clipe">Clipe</TabsTrigger>
        <TabsTrigger value="exportar">Exportar</TabsTrigger>
      </TabsList>
      <TabsContent value="legendas" className="min-h-0 flex-1 overflow-y-auto p-3">
        <CaptionsTab {...props} />
      </TabsContent>
      <TabsContent value="estilo" className="min-h-0 flex-1 overflow-y-auto p-3">
        <StyleTab {...props} />
      </TabsContent>
      <TabsContent value="clipe" className="min-h-0 flex-1 overflow-y-auto p-3">
        <ClipTab {...props} />
      </TabsContent>
      <TabsContent value="exportar" className="min-h-0 flex-1 overflow-y-auto p-3">
        <ExportTab {...props} />
      </TabsContent>
    </Tabs>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </label>
  );
}

function CaptionsTab({ project, time, selection, busy, onSeek, onSelect, onChange, onAutoCaptions }: Props) {
  const [perCaption, setPerCaption] = useState("3");
  const placed = placeCaptions(project);
  const listRef = useRef<HTMLDivElement>(null);
  const hidden = project.captions.length - new Set(placed.map((c) => c.captionId)).size;

  // Mantém visível a legenda selecionada.
  useEffect(() => {
    if (selection?.type !== "caption") return;
    listRef.current?.querySelector(`[data-caption="${selection.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const addAtPlayhead = () => {
    const { clips } = placeClips(project);
    const clip = clips.find((c) => time >= c.offset && time < c.offset + c.duration) ?? clips.at(-1);
    if (!clip) return;
    const start = clip.in + Math.max(0, time - clip.offset);
    const id = newId();
    onChange((p) => ({ ...p, captions: [...p.captions, { id, sourceId: clip.sourceId, start, end: Math.min(clip.out, start + 1.5), text: "Nova legenda" }] }));
    onSelect({ type: "caption", id });
  };

  // Editar início/fim no tempo da timeline desloca o tempo na origem pela mesma diferença.
  const shift = (id: string, field: "start" | "end", from: number, to: number) => {
    if (!Number.isFinite(to)) return;
    onChange((p) => ({
      ...p,
      captions: p.captions.map((c) => {
        if (c.id !== id) return c;
        const value = Math.max(0, c[field] + (to - from));
        return field === "start" ? { ...c, start: Math.min(value, c.end - 0.1) } : { ...c, end: Math.max(value, c.start + 0.1) };
      }),
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="per-caption">Palavras por legenda</Label>
            <Select value={perCaption} onValueChange={setPerCaption}>
              <SelectTrigger id="per-caption" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "2", "3", "4", "5", "6"].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={busy.captions}
            onClick={() => {
              if (project.captions.length && !window.confirm("Gerar de novo substitui as legendas atuais. Continuar?")) return;
              onAutoCaptions(Number(perCaption));
            }}
          >
            {busy.captions ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {project.captions.length ? "Regerar" : "Gerar legendas"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Transcreve a fala com o ElevenLabs. Use *palavra* para destacar.</p>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={project.captionsEnabled}
            onChange={(e) => onChange((p) => ({ ...p, captionsEnabled: e.target.checked }))}
            className="size-4 accent-rec"
          />
          Mostrar legendas
        </label>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={addAtPlayhead}>
          <Plus />
          No playhead
        </Button>
      </div>

      {hidden > 0 && <p className="text-xs text-muted-foreground">{hidden} legenda(s) em trechos cortados não aparecem.</p>}

      <div ref={listRef} className="flex flex-col gap-2">
        {placed.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma legenda ainda.</p>}
        {placed.map((c) => {
          const active = selection?.type === "caption" && selection.id === c.captionId;
          const playing = time >= c.start && time < c.end;
          return (
            <div
              key={c.key}
              data-caption={c.captionId}
              className={cn("flex flex-col gap-1.5 rounded-lg border p-2", active && "border-foreground/50 bg-muted/50", playing && !active && "border-rec/50")}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums hover:text-foreground"
                  onClick={() => {
                    onSeek(c.start);
                    onSelect({ type: "caption", id: c.captionId });
                  }}
                >
                  {formatTime(c.start)}
                </button>
                <span className="flex-1" />
                <TimeInput label="Início" value={c.start} onCommit={(v) => shift(c.captionId, "start", c.start, v)} />
                <TimeInput label="Fim" value={c.end} onCommit={(v) => shift(c.captionId, "end", c.end, v)} />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Apagar legenda"
                  onClick={() => onChange((p) => ({ ...p, captions: p.captions.filter((x) => x.id !== c.captionId) }))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Textarea
                aria-label="Texto da legenda"
                rows={1}
                value={c.text}
                onFocus={() => {
                  onSelect({ type: "caption", id: c.captionId });
                  onSeek(c.start + 0.01);
                }}
                onChange={(e) => {
                  const text = e.target.value;
                  onChange((p) => ({ ...p, captions: p.captions.map((x) => (x.id === c.captionId ? { ...x, text } : x)) }));
                }}
                className="min-h-8 resize-none py-1 text-sm"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Campo de tempo em segundos que só aplica ao sair do campo ou com Enter.
function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      title={label}
      value={draft ?? value.toFixed(2)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(Number(draft.replace(",", ".")));
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-6 w-16 px-1.5 text-center font-mono text-[0.6875rem]"
    />
  );
}

function StyleTab({ project, onChange }: Props) {
  const style = project.style;
  const set = (patch: Partial<CaptionStyle>) => onChange((p) => ({ ...p, style: { ...p.style, ...patch } }));
  const toggle = (key: "box" | "uppercase" | "pop", label: string) => (
    <Button variant={style[key] ? "secondary" : "outline"} size="sm" aria-pressed={style[key]} onClick={() => set({ [key]: !style[key] })}>
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Estilos prontos</Label>
        <div className="grid grid-cols-2 gap-2">
          {STYLE_PRESETS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => set({ ...DEFAULT_STYLE, ...p.style })}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cap-font">Fonte</Label>
        <Select value={style.font} onValueChange={(v) => set({ font: v as CaptionStyle["font"] })}>
          <SelectTrigger id="cap-font" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAPTION_FONTS.map((f) => (
              <SelectItem key={f} value={f}>
                <span style={{ fontFamily: `"${f}"` }}>{f}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SliderField label="Tamanho" value={style.size} min={40} max={180} step={2} format={(v) => `${v}`} onChange={(v) => set({ size: v })} />
      <SliderField label="Posição vertical" value={style.position} min={8} max={92} step={1} format={(v) => `${v}%`} left="Topo" right="Base" onChange={(v) => set({ position: v })} />
      <SliderField label={style.box ? "Margem da caixa" : "Contorno"} value={style.outline} min={0} max={20} step={1} format={(v) => `${v}px`} onChange={(v) => set({ outline: v })} />
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Cor do texto" value={style.color} onChange={(v) => set({ color: v })} />
        <ColorField label="Destaque *palavra*" value={style.highlight} onChange={(v) => set({ highlight: v })} />
      </div>
      <div className="flex flex-wrap gap-2">
        {toggle("box", "Caixa escura")}
        {toggle("uppercase", "MAIÚSCULAS")}
        {toggle("pop", "Animação pop")}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className="flex items-center gap-2 rounded-md border px-2 py-1">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="font-mono text-xs">{value}</span>
      </span>
    </label>
  );
}

function ClipTab({ project, selection, onSelect, onChange, onSplit, onSeek }: Props) {
  const { clips, total } = placeClips(project);
  const clip = selection?.type === "clip" ? clips.find((c) => c.id === selection.id) : undefined;
  const index = clip ? clips.findIndex((c) => c.id === clip.id) : -1;

  const move = (dir: -1 | 1) =>
    onChange((p) => {
      const list = [...p.clips];
      const i = list.findIndex((c) => c.id === clip!.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return p;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, clips: list };
    });

  const setEdge = (field: "in" | "out", v: number) => {
    if (!Number.isFinite(v)) return;
    onChange((p) => ({
      ...p,
      clips: p.clips.map((c) => {
        if (c.id !== clip!.id) return c;
        const max = p.sources[c.sourceId].duration;
        return field === "in" ? { ...c, in: Math.max(0, Math.min(c.out - 0.1, v)) } : { ...c, out: Math.min(max, Math.max(c.in + 0.1, v)) };
      }),
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" size="sm" onClick={onSplit}>
        <Scissors />
        Dividir no playhead (S)
      </Button>
      <p className="text-xs text-muted-foreground">
        Para tirar um trecho (jump cut): divida no começo e no fim dele e apague o pedaço do meio. Total: {formatTime(total)}.
      </p>
      {!clip ? (
        <div className="flex flex-col gap-1.5">
          <Label>Clipes</Label>
          {clips.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onSelect({ type: "clip", id: c.id });
                onSeek(c.offset);
              }}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{project.sources[c.sourceId]?.label}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{c.duration.toFixed(1)}s</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div>
            <Label>Clipe {index + 1}</Label>
            <p className="mt-0.5 line-clamp-2 text-sm">{project.sources[clip.sourceId]?.label}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Entrada (origem)</Label>
              <TimeInputWide value={clip.in} onCommit={(v) => setEdge("in", v)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Saída (origem)</Label>
              <TimeInputWide value={clip.out} onCommit={(v) => setEdge("out", v)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={index === 0} onClick={() => move(-1)}>
              <ArrowLeft />
              Antes
            </Button>
            <Button variant="outline" size="sm" disabled={index === clips.length - 1} onClick={() => move(1)}>
              Depois
              <ArrowRight />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange((p) => ({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? [c, { ...c, id: newId() }] : [c])) }))}
            >
              <Copy />
              Duplicar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={clips.length === 1}
              onClick={() => {
                onChange((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clip.id) }));
                onSelect(null);
              }}
            >
              <Trash2 />
              Apagar
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Ver todos os clipes
          </Button>
        </div>
      )}
    </div>
  );
}

function TimeInputWide({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value.toFixed(2)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(Number(draft.replace(",", ".")));
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="font-mono"
    />
  );
}

function ExportTab({ project, exports, busy, onRender, onDeleteExport }: Props) {
  const { total } = placeClips(project);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Resolução</dt>
            <dd className="font-mono tabular-nums">
              {project.width}×{project.height}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Duração</dt>
            <dd className="font-mono tabular-nums">{formatTime(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Legendas</dt>
            <dd>{project.captionsEnabled ? `${placeCaptions(project).length} gravadas no vídeo` : "desligadas"}</dd>
          </div>
        </dl>
        <Button className="bg-rec text-white hover:bg-rec/85" disabled={busy.render} onClick={onRender}>
          {busy.render ? <Loader2 className="animate-spin" /> : <Download />}
          Exportar MP4
        </Button>
        <p className="text-xs text-muted-foreground">O vídeo exportado entra no histórico do hub e pode ir para o chat, o Higgsfield ou o quadro.</p>
      </div>
      {exports.length > 0 && <Label>Exportações</Label>}
      <div className="grid grid-cols-2 gap-2">
        {exports.map((g) => (
          <GenerationCard key={g.id} g={g} onDelete={onDeleteExport} meta={new Date(g.createdAt).toLocaleString("pt-BR")} />
        ))}
      </div>
    </div>
  );
}
