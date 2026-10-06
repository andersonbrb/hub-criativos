"use client";

import { Plus, Sparkles, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

// Blocos opcionais da aba Edição: efeitos (ffmpeg, scripts/montagem.py) e gráficos animados (Remotion, lib/server/motion.ts).
// Tudo desligado por padrão: a edição padrão do playbook não muda. Use só quando o vídeo pedir.

export type Fx = {
  legenda: "padrao" | "destaque";
  cor_destaque: string;
  zoom_cortes: boolean;
  transicao: "dissolve" | "zoom" | "slide";
  sons: boolean;
  musicId: string;
  musica_volume: number;
  cor: "nenhuma" | "quente" | "fria" | "vivo";
  barra_progresso: boolean;
};

export const FX_OFF: Fx = {
  legenda: "padrao",
  cor_destaque: "#22FF66",
  zoom_cortes: false,
  transicao: "dissolve",
  sons: false,
  musicId: "",
  musica_volume: 0.18,
  cor: "nenhuma",
  barra_progresso: false,
};

export const fxCount = (f: Fx) =>
  [f.legenda !== "padrao", f.zoom_cortes, f.transicao !== "dissolve", f.sons, Boolean(f.musicId), f.cor !== "nenhuma", f.barra_progresso].filter(Boolean).length;

// posicao "" = automática (título/contador no topo, lista no meio, destaque e CTA embaixo, longe do rosto).
export type Grafico = { tipo: "titulo" | "destaque" | "lista" | "contador" | "cta"; texto: string; sub: string; deixa: string; posicao: "" | "topo" | "meio" | "baixo" };

const TIPOS: { value: Grafico["tipo"]; label: string; hint: string }[] = [
  { value: "titulo", label: "Título", hint: "Frase de impacto no topo" },
  { value: "destaque", label: "Destaque", hint: "Preço, oferta ou número grande" },
  { value: "lista", label: "Lista", hint: "Benefícios; separe com ;" },
  { value: "contador", label: "Contador", hint: "Oferta acaba em… (sub = 09:59)" },
  { value: "cta", label: "CTA", hint: "Botão + seta no final" },
];

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center justify-between gap-2 py-1 text-left text-xs hover:text-foreground">
      <span>{label}</span>
      <span className={cn("flex h-4 w-7 shrink-0 items-center p-0.5 transition-colors", checked ? "bg-rec" : "bg-muted-foreground/30")}>
        <span className={cn("size-3 bg-white transition-transform", checked && "translate-x-3")} />
      </span>
    </button>
  );
}

function Mini({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-7 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function EffectsPanel({ fx, onChange, audios }: { fx: Fx; onChange: (f: Fx) => void; audios: Generation[] }) {
  const set = <K extends keyof Fx>(k: K, v: Fx[K]) => onChange({ ...fx, [k]: v });
  const n = fxCount(fx);
  return (
    <details className="border px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider uppercase">
        <Wand2 className="size-3.5" /> Efeitos (opcional){n ? <span className="text-rec">· {n} ligado{n > 1 ? "s" : ""}</span> : <span className="font-normal text-muted-foreground normal-case">· desligados</span>}
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        <p className="text-[0.6875rem] text-muted-foreground">Ligue só o que o vídeo pede. A edição padrão é limpa.</p>
        <Mini label="Legenda" value={fx.legenda} onChange={(v) => set("legenda", v as Fx["legenda"])} options={[{ value: "padrao", label: "Padrão" }, { value: "destaque", label: "Palavra em destaque" }]} />
        {fx.legenda === "destaque" && (
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Cor do destaque</span>
            <input type="color" value={fx.cor_destaque} onChange={(e) => set("cor_destaque", e.target.value)} className="h-7 w-14 cursor-pointer border bg-transparent" aria-label="Cor do destaque" />
          </label>
        )}
        <Toggle label="Zoom nos cortes" checked={fx.zoom_cortes} onChange={(v) => set("zoom_cortes", v)} />
        <Mini label="Transição do b-roll" value={fx.transicao} onChange={(v) => set("transicao", v as Fx["transicao"])} options={[{ value: "dissolve", label: "Dissolve (padrão)" }, { value: "zoom", label: "Zoom" }, { value: "slide", label: "Slide" }]} />
        <Toggle label="Whoosh na entrada do b-roll" checked={fx.sons} onChange={(v) => set("sons", v)} />
        <Mini
          label="Música de fundo"
          value={fx.musicId || "none"}
          onChange={(v) => set("musicId", v === "none" ? "" : v)}
          options={[{ value: "none", label: "Nenhuma" }, ...audios.map((a) => ({ value: a.id, label: (a.name || a.prompt).slice(0, 28) || "Áudio" }))]}
        />
        {fx.musicId && (
          <Mini
            label="Volume da música"
            value={String(fx.musica_volume)}
            onChange={(v) => set("musica_volume", Number(v))}
            options={[{ value: "0.1", label: "Baixo" }, { value: "0.18", label: "Médio" }, { value: "0.28", label: "Alto" }]}
          />
        )}
        <Mini label="Cor" value={fx.cor} onChange={(v) => set("cor", v as Fx["cor"])} options={[{ value: "nenhuma", label: "Original" }, { value: "quente", label: "Quente" }, { value: "fria", label: "Fria" }, { value: "vivo", label: "Viva" }]} />
        <Toggle label="Barra de progresso" checked={fx.barra_progresso} onChange={(v) => set("barra_progresso", v)} />
        {n > 0 && (
          <button type="button" onClick={() => onChange(FX_OFF)} className="self-start text-[0.6875rem] text-muted-foreground underline-offset-2 hover:underline">
            Desligar todos
          </button>
        )}
      </div>
    </details>
  );
}

export function GraphicsPanel({ items, onChange }: { items: Grafico[]; onChange: (g: Grafico[]) => void }) {
  const update = (i: number, patch: Partial<Grafico>) => onChange(items.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  return (
    <details className="border px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider uppercase">
        <Sparkles className="size-3.5" /> Gráficos animados (opcional)
        {items.length ? <span className="text-rec">· {items.length}</span> : <span className="font-normal text-muted-foreground normal-case">· nenhum</span>}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[0.6875rem] text-muted-foreground">Motion graphics por cima do vídeo (Remotion). Poucos e no idioma do anúncio. Sem palavra, entram no momento padrão.</p>
        {items.map((g, i) => {
          const tipo = TIPOS.find((t) => t.value === g.tipo)!;
          return (
            <div key={i} className="flex flex-col gap-1.5 border p-2">
              <div className="flex items-center gap-1.5">
                <Select value={g.tipo} onValueChange={(v) => update(i, { tipo: v as Grafico["tipo"] })}>
                  <SelectTrigger size="sm" className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">{tipo.hint}</span>
                <button type="button" aria-label="Tirar gráfico" onClick={() => onChange(items.filter((_, k) => k !== i))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
              <Input value={g.texto} onChange={(e) => update(i, { texto: e.target.value })} placeholder={g.tipo === "lista" ? "Benefício 1; Benefício 2; Benefício 3" : "Texto"} className="h-7 text-xs md:text-xs" aria-label="Texto do gráfico" />
              <div className="grid grid-cols-2 gap-1.5">
                {(g.tipo === "destaque" || g.tipo === "contador") && (
                  <Input value={g.sub} onChange={(e) => update(i, { sub: e.target.value })} placeholder={g.tipo === "contador" ? "09:59" : "Texto menor"} className="h-7 text-xs md:text-xs" aria-label="Texto menor" />
                )}
                <Input value={g.deixa} onChange={(e) => update(i, { deixa: e.target.value })} placeholder="entra quando falar…" className="h-7 text-xs md:text-xs" aria-label="Deixa do gráfico" />
                <Select value={g.posicao || "auto"} onValueChange={(v) => update(i, { posicao: v === "auto" ? "" : (v as Grafico["posicao"]) })}>
                  <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label="Posição do gráfico">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Posição automática</SelectItem>
                    <SelectItem value="topo">No topo</SelectItem>
                    <SelectItem value="meio">No meio</SelectItem>
                    <SelectItem value="baixo">Embaixo (acima da legenda)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
        <Button variant="outline" size="xs" className="self-start" onClick={() => onChange([...items, { tipo: "titulo", texto: "", sub: "", deixa: "", posicao: "" }])}>
          <Plus />
          Adicionar gráfico
        </Button>
      </div>
    </details>
  );
}
