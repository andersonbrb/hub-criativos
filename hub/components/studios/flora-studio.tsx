"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CircleDollarSign, ImagePlus, Link2, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { Field, GenerationCard, HistoryActions, HistoryPanel, MissingKey, useGenerations } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { DEFAULT_FAMILY, FLORA_FAMILIES, MARKETS, MAX_REFERENCES, applyRules, paramsFor, type FloraKind, type Operation } from "@/lib/flora-models";
import { apiFetch, mediaUrl, type Generation } from "@/lib/generations";
import { cn } from "@/lib/utils";

async function pollRun(g: Generation): Promise<Generation | null> {
  const { generation } = await apiFetch<{ generation: Generation }>(`/api/flora/jobs/${g.id}`, { method: "POST" });
  return generation.status !== g.status ? generation : null;
}

const DESCRIPTION =
  "Toda imagem e vídeo do hub é gerado aqui, pelo FLORA. Envie uma foto ou use uma geração anterior como referência, como no canvas. Tudo fica também no projeto “Hub de Criativos” do FLORA.";

const usd = (n: number) => `US$ ${n.toFixed(n < 0.1 ? 3 : 2).replace(".", ",")}`;

// Padrões do estúdio (escolha do usuário): qualidade média quando o modelo tem essa opção.
const STUDIO_DEFAULTS: Record<string, string> = { quality: "medium" };

const defaultsFor = (familyId: string) =>
  Object.fromEntries(
    FLORA_FAMILIES.find((f) => f.id === familyId)!.params.map((p) => {
      const preferred = STUDIO_DEFAULTS[p.name];
      return [p.name, preferred && p.options.some((o) => o.value === preferred) ? preferred : p.default];
    }),
  );

export function FloraStudio({ configured }: { configured: boolean }) {
  const [kind, setKind] = useState<FloraKind>("image");
  const [familyId, setFamilyId] = useState(DEFAULT_FAMILY.image);
  const [values, setValues] = useState<Record<string, string>>(() => defaultsFor(DEFAULT_FAMILY.image));
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [operation, setOperation] = useState<Operation>("none");
  const [market, setMarket] = useState<string>("cl");
  // Sem regras COD: idioma da fala do vídeo (opcional).
  const [speech, setSpeech] = useState<string>("auto");
  const marketSent = operation === "cod" ? market : speech === "auto" ? "" : speech;
  // Referências: fotos enviadas e/ou imagens já geradas no hub (várias nos modelos com versão de várias imagens).
  const [refIds, setRefIds] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [estimate, setEstimate] = useState<{ value: number; approximate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { items, loaded, add, remove, clear } = useGenerations("flora", pollRun);

  const family = FLORA_FAMILIES.find((f) => f.id === familyId)!;
  const families = FLORA_FAMILIES.filter((f) => f.kind === kind);
  const imagePreviews = useMemo(() => images.map((f) => URL.createObjectURL(f)), [images]);
  useEffect(() => () => imagePreviews.forEach((u) => URL.revokeObjectURL(u)), [imagePreviews]);
  const refItems = refIds.map((id) => items.find((g) => g.id === id)).filter((g): g is Generation => Boolean(g));
  const refCount = images.length + refItems.length;
  const hasReference = refCount > 0;
  // Várias referências só nos modelos com versão de várias imagens.
  const multiBlocked = refCount > 1 && !family.fromImages;
  const multiFamilies = families.filter((f) => f.fromImages).map((f) => f.label);
  const finalPrompt = applyRules(prompt, kind, operation, marketSent);

  useEffect(() => {
    if (!configured) return;
    const t = setTimeout(() => {
      apiFetch<{ estimatedCost: number; approximate: boolean }>("/api/flora/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family: familyId, params: values, count, referenceId: refIds[0], withImage: images.length > 0, referenceCount: refCount }),
      })
        .then((d) => setEstimate({ value: d.estimatedCost, approximate: d.approximate }))
        .catch(() => setEstimate(null));
    }, 500);
    return () => clearTimeout(t);
  }, [configured, familyId, values, count, refIds, images, refCount]);

  function switchKind(k: string) {
    const next = k as FloraKind;
    setKind(next);
    setFamilyId(DEFAULT_FAMILY[next]);
    setValues(defaultsFor(DEFAULT_FAMILY[next]));
  }

  function pickFamily(id: string) {
    setFamilyId(id);
    setValues(defaultsFor(id));
  }

  function toggleReference(g: Generation) {
    if (!refIds.includes(g.id) && refCount >= MAX_REFERENCES) return toast.error(`No máximo ${MAX_REFERENCES} imagens de referência.`);
    setRefIds((cur) => (cur.includes(g.id) ? cur.filter((id) => id !== g.id) : [...cur, g.id]));
  }

  function addImages(list: FileList | null) {
    const picked = [...(list ?? [])];
    const tooBig = picked.filter((f) => f.size > 4 * 1024 * 1024);
    if (tooBig.length) toast.error(`Cada imagem precisa ter até 4 MB (${tooBig.map((f) => f.name).join(", ")}).`);
    const ok = picked.filter((f) => f.size <= 4 * 1024 * 1024);
    const room = MAX_REFERENCES - refCount;
    if (ok.length > room) toast.error(`No máximo ${MAX_REFERENCES} imagens de referência.`);
    setImages((cur) => [...cur, ...ok.slice(0, Math.max(0, room))]);
  }

  async function generate() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("family", familyId);
      form.set("prompt", prompt);
      form.set("params", JSON.stringify(values));
      form.set("count", String(count));
      form.set("operation", operation);
      form.set("market", marketSent);
      images.forEach((f) => form.append("image", f));
      refItems.forEach((g) => form.append("referenceId", g.id));
      const { generations } = await apiFetch<{ generations: Generation[] }>("/api/flora/generate", { method: "POST", body: form });
      generations.reverse().forEach(add);
      toast.success(
        `${generations.length} ${generations.length > 1 ? "gerações enviadas" : "geração enviada"} ao FLORA. ${kind === "video" ? "Vídeo leva de 4 a 6 min." : "Frame leva cerca de 2 min."}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  const needsImageWarning = kind === "video" && !hasReference;

  return (
    <Workspace
      id="estudio-geracao"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Geração</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">FLORA</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{DESCRIPTION}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{DESCRIPTION}</TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          <OpenAppButton app="flora" />
        </>
      }
      presets={[
        { id: "padrao", label: "Padrão", layout: { prompt: 68, ajustes: 32, geracoes: "collapsed" } },
        { id: "lado", label: "Com gerações", layout: { prompt: 36, ajustes: 24, geracoes: 40 } },
        { id: "geracoes", label: "Foco nas gerações", layout: { prompt: "collapsed", ajustes: "collapsed", geracoes: 100 } },
      ]}
    >
      <WorkspacePanel id="prompt" title="Prompt e referência" defaultSize={68} fill minSize={20} bodyClassName="flex flex-col gap-3 p-4">
        {!configured && <MissingKey envVar="FLORA_API_KEY" where="app.flora.ai → Settings → API Keys (a chave começa com ak_)" />}
        <Tabs value={kind} onValueChange={switchKind}>
          <TabsList>
            <TabsTrigger value="image">Frame / imagem</TabsTrigger>
            <TabsTrigger value="video">Vídeo</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Referências: fotos do produto (frame) ou frames iniciais (vídeo); várias nos modelos que aceitam. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
          <Link2 className="size-3.5" />
          {kind === "image" ? "Fotos do produto:" : "Frames iniciais:"}
          {refCount === 0 && <span>nenhuma</span>}
          {images.map((f, i) => (
            <RefChip key={imagePreviews[i]} src={imagePreviews[i]} label={f.name} onRemove={() => setImages((cur) => cur.filter((_, j) => j !== i))} />
          ))}
          {refItems.map((g) => (
            <RefChip key={g.id} src={mediaUrl(g)} label={g.prompt} onRemove={() => setRefIds((cur) => cur.filter((id) => id !== g.id))} />
          ))}
          <span className="flex-1" />
          {refCount > 0 && (
            <span className="font-mono tabular-nums">
              {refCount}/{MAX_REFERENCES}
            </span>
          )}
          <Button variant="outline" size="xs" asChild>
            <label className="cursor-pointer">
              <ImagePlus />
              {refCount ? "Adicionar" : "Enviar fotos"}
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        {multiBlocked && (
          <p className="text-xs text-warn">
            {family.label} aceita só 1 imagem de referência. Com {refCount} imagens, troque o modelo para: {multiFamilies.join(", ")}.
          </p>
        )}
        {needsImageWarning && (
          <p className="text-xs text-warn">
            Sem frame inicial o vídeo sai só do texto e o produto pode virar outro. Escolha um frame aprovado nas gerações (Usar como referência).
          </p>
        )}

        <div className="rounded-lg border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
          <label htmlFor="flora-prompt" className="sr-only">Prompt</label>
          <Textarea
            id="flora-prompt"
            rows={8}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="resize-y border-0 bg-transparent! shadow-none focus-visible:ring-0"
            placeholder="Descreva a cena…"
          />
        </div>
        {prompt.trim() && finalPrompt !== prompt.trim() && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{operation === "cod" ? "Linhas adicionadas pelas regras do COD" : "Linha adicionada (idioma da fala)"}</summary>
            <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap">{finalPrompt.slice(prompt.trim().length).trim()}</pre>
          </details>
        )}
      </WorkspacePanel>

      <WorkspacePanel id="ajustes" title="Modelo e custo" defaultSize={32} minSize={16} bodyClassName="flex flex-col gap-4 p-4">
        <Field label="Modelo" id="fl-model">
          <Select value={familyId} onValueChange={pickFamily}>
            <SelectTrigger id="fl-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {families.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                  <span className="font-mono text-[11px] text-muted-foreground">~{usd(f.baseCostUsd)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {family.note}{" "}
            {refCount > 1 && family.fromImages
              ? `Usando a versão com ${refCount} imagens de referência.`
              : hasReference
                ? "Usando a versão a partir de imagem."
                : "Sem referência: versão só texto."}
            {family.fromImages ? "" : " Aceita 1 imagem de referência."}
          </p>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          {paramsFor(family, hasReference).map((p) => (
            <Field key={p.name} label={p.label} id={`fl-${p.name}`}>
              <Select value={values[p.name] ?? p.default} onValueChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}>
                <SelectTrigger id={`fl-${p.name}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {p.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
          <Field label="Variações" id="fl-count">
            <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
              <SelectTrigger id="fl-count" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Regras" id="fl-op">
            <Select value={operation} onValueChange={(v) => setOperation(v as Operation)}>
              <SelectTrigger id="fl-op" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cod">Dropshipping COD</SelectItem>
                <SelectItem value="none">Nenhuma</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {operation === "cod" && kind === "video" && (
            <Field label="Mercado" id="fl-market">
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger id="fl-market" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {operation === "none" && kind === "video" && (
            <Field label="Idioma da fala" id="fl-speech">
              <Select value={speech} onValueChange={setSpeech}>
                <SelectTrigger id="fl-speech" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automático</SelectItem>
                  {MARKETS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        {operation === "cod" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Adiciona ao prompt: só adultos, sem texto na tela{kind === "video" ? ", fala contínua no idioma do mercado" : ""}.
          </p>
        )}

        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CircleDollarSign className="size-3.5" />
            Custo {estimate?.approximate ? "aprox." : "estimado"}
          </span>
          <b className="font-mono text-foreground tabular-nums">{estimate ? usd(estimate.value) : "—"}</b>
        </div>
        <Button className="bg-rec text-white hover:bg-rec/85" disabled={!configured || busy || !prompt.trim() || multiBlocked} onClick={generate}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? "Enviando…" : `Gerar ${count > 1 ? `${count} ` : ""}${kind === "video" ? (count > 1 ? "vídeos" : "vídeo") : count > 1 ? "frames" : "frame"}`}
        </Button>
      </WorkspacePanel>

      <WorkspacePanel
        id="geracoes"
        title="Gerações"
        defaultSize={40}
        minSize={20}
        defaultCollapsed
        badge={items.length}
        actions={<HistoryActions count={items.length} onClear={clear} />}
        bodyClassName="@container p-4"
      >
        <HistoryPanel
          bare
          count={items.length}
          loaded={loaded}
          empty="Os frames e vídeos aparecem aqui. Aprove um frame e use como referência para animar."
          className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4"
        >
          {items.map((g) => {
            const isRef = refIds.includes(g.id);
            return (
              <div key={g.id} className="relative">
                <GenerationCard
                  g={g}
                  onDelete={(id) => {
                    setRefIds((cur) => cur.filter((r) => r !== id));
                    remove(id);
                  }}
                  meta={`${g.params.modelName} · ${g.params.aspect_ratio ?? ""}${g.params.duration ? ` · ${g.params.duration}s` : ""}${typeof g.params.cost === "number" ? ` · ${usd(g.params.cost)}` : ""}`}
                  className={cn(isRef && "border-rec ring-2 ring-rec/40")}
                />
                {g.status === "done" && g.kind === "image" && (
                  <Button size="xs" variant={isRef ? "default" : "secondary"} className="absolute top-2 left-2 shadow" onClick={() => toggleReference(g)}>
                    {isRef ? <Check /> : <Link2 />}
                    {isRef ? "Referência" : "Usar como referência"}
                  </Button>
                )}
              </div>
            );
          })}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}

function RefChip({ src, label, onRemove }: { src?: string; label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-md border bg-muted py-0.5 pr-1 pl-0.5 text-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local */}
      {src && <img src={src} alt="" className="size-7 rounded object-cover" />}
      <span className="max-w-48 truncate">{label}</span>
      <button type="button" aria-label="Tirar referência" onClick={onRemove} className="rounded p-0.5 hover:bg-background">
        <X className="size-3" />
      </button>
    </span>
  );
}
