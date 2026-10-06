"use client";

import { useState } from "react";
import { Check, Download, Eye, ImagePlus, Loader2, WandSparkles, X } from "lucide-react";

import { ChatView, type StartChat, type ViewItem } from "@/components/chat/chat-view";
import { Field } from "@/components/studios/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { downloadName, mediaUrl } from "@/lib/generations";
import { CREATIVE_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

// Criativo automático: a pessoa diz o que quer anunciar (texto e/ou foto do produto), escolhe poucas opções e o
// agente "auto" (lib/agent-profiles.ts) faz tudo até o vídeo final. A conversa continua aberta para responder às
// perguntas dele e pedir ajustes.

const FORMATS = [
  { value: "auto", label: "A IA escolhe", hint: "Recomendado", text: "a IA escolhe" },
  { value: "pessoa", label: "Pessoa falando", hint: "Uma pessoa apresenta o produto, com cenas extras", text: "pessoa falando (avatar UGC + cenas extras)" },
  { value: "produto", label: "Produto em cena", hint: "O produto aparecendo em uso, com fala", text: "produto em cena (vídeo do produto com fala)" },
] as const;

const DURATIONS = [15, 30, 45] as const;

// Para onde a chamada final (CTA) leva a pessoa.
const CTAS = [
  { value: "auto", label: "A IA escolhe", text: "a IA escolhe pelo produto" },
  { value: "whatsapp", label: "Chamar no WhatsApp", text: "chamar no WhatsApp" },
  { value: "botao", label: "Clicar no botão abaixo", text: "clicar no botão abaixo do vídeo (Saiba mais / Comprar agora)" },
  { value: "link", label: "Clicar no link", text: "clicar no link (da bio ou do anúncio)" },
  { value: "site", label: "Comprar no site", text: "comprar no site / loja online" },
  { value: "direct", label: "Mandar mensagem no direct", text: "mandar mensagem no direct" },
  { value: "outro", label: "Outro", text: "" },
] as const;

const MODES = [
  { value: "perguntar", label: "Me fazer algumas perguntas antes", hint: "Mais assertivo. A IA pergunta até 4 coisas e mostra o roteiro antes de gastar.", text: "Me fazer perguntas antes" },
  { value: "sozinho", label: "Fazer tudo sozinho", hint: "Mais rápido. A IA decide tudo e não pergunta nada: entrega o vídeo pronto.", text: "Fazer tudo sozinho" },
] as const;

const STEPS = ["Entender o produto", "Roteiro", "Voz", "Vídeos", "Edição final", "Pronto"];

export function AutoCreative({ initialId, configured }: { initialId: string | null; configured: boolean }) {
  return (
    <ChatView
      key="auto"
      agentId="auto"
      path="/criativo-automatico"
      heading="Criativo automático"
      initialId={initialId}
      initialDraft=""
      configured={configured}
      startScreen={(start) => <StartForm start={start} configured={configured} />}
      renderTop={(items, running) => <Progress items={items} running={running} />}
    />
  );
}

function StartForm({ start, configured }: { start: StartChat; configured: boolean }) {
  const [about, setAbout] = useState("");
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [format, setFormat] = useState<(typeof FORMATS)[number]["value"]>("auto");
  const [lang, setLang] = useState("pt");
  const [country, setCountry] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(30);
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("perguntar");
  const [sayPrice, setSayPrice] = useState(false);
  const [price, setPrice] = useState("");
  const [cta, setCta] = useState<(typeof CTAS)[number]["value"]>("auto");
  const [ctaOther, setCtaOther] = useState("");
  const [busy, setBusy] = useState(false);

  const ready =
    configured &&
    (about.trim().length > 0 || photos.length > 0) &&
    (!sayPrice || price.trim().length > 0) &&
    (cta !== "outro" || ctaOther.trim().length > 0) &&
    !busy;

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const added = [...list].filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...added].slice(0, 4));
  }

  function submit() {
    if (!ready) return;
    setBusy(true);
    const language = CREATIVE_LANGUAGES.find((l) => l.id === lang);
    const ctaText = cta === "outro" ? ctaOther.trim() : CTAS.find((c) => c.value === cta)!.text;
    const text = [
      "[CRIATIVO AUTOMÁTICO]",
      `O que anunciar: ${about.trim() || "(veja a foto do produto)"}`,
      `Formato: ${FORMATS.find((f) => f.value === format)!.text}`,
      `Idioma do criativo: ${language?.label ?? "Português"}${country.trim() ? ` · País/mercado: ${country.trim()}` : ""}`,
      `Duração: cerca de ${duration} segundos`,
      `Modo de trabalho: ${MODES.find((m) => m.value === mode)!.text}`,
      `Valor do produto: ${sayPrice ? `${price.trim()} (falar no CTA e mostrar no destaque animado)` : "não falar o valor no anúncio"}`,
      `Chamada final (CTA): ${ctaText}`,
      `Fotos do produto: ${photos.length ? `${photos.length} anexada${photos.length > 1 ? "s" : ""}` : "nenhuma"}`,
      "",
      "Produza o criativo completo até o vídeo final editado.",
    ].join("\n");
    start(text, photos.map((p) => p.file), lang);
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <div>
        <p className="flex items-center gap-2 font-heading text-2xl font-bold">
          <WandSparkles className="size-6 text-rec" aria-hidden />
          Criativo automático
        </p>
        <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
          Diga o que você quer anunciar ou mande a foto do produto. A IA escreve o roteiro, cria a voz, a pessoa falando, as cenas e
          entrega o vídeo editado, pronto para subir. Você acompanha cada etapa aqui.
        </p>
      </div>

      <Field label="O que você quer anunciar?" id="auto-about" hint="tema, nicho, produto, oferta, preço, link">
        <Textarea
          id="auto-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={4}
          maxLength={3000}
          placeholder="Ex.: Pastelaria de bairro em São Paulo, delivery pelo WhatsApp, combo de 4 pastéis por R$ 49,90. Público: quem chega cansado do trabalho."
          className="resize-y text-sm"
        />
      </Field>

      <Field label="Foto do produto (opcional)" hint={`${photos.length}/4`}>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- prévia local */}
              <img src={p.url} alt={p.file.name} className="size-20 border object-cover" />
              <button
                type="button"
                aria-label={`Remover ${p.file.name}`}
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setPhotos((prev) => prev.filter((_, j) => j !== i));
                }}
                className="absolute -top-1.5 -right-1.5 border bg-background p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {photos.length < 4 && (
            <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed text-[0.6875rem] text-muted-foreground hover:border-foreground/40 hover:text-foreground">
              <ImagePlus className="size-5" />
              Adicionar
              <input type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
            </label>
          )}
        </div>
      </Field>

      <Field label="Formato do vídeo">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato do vídeo">
          {FORMATS.map((f) => (
            <Choice key={f.value} active={format === f.value} onClick={() => setFormat(f.value)} label={f.label} hint={f.hint} />
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Idioma do anúncio" id="auto-lang">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger id="auto-lang" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATIVE_LANGUAGES.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="País (opcional)" id="auto-country">
          <Input id="auto-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Ex.: Brasil, México" maxLength={40} />
        </Field>
        <Field label="Duração">
          <div className="grid grid-cols-3 gap-1 border p-1" role="radiogroup" aria-label="Duração">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={duration === d}
                onClick={() => setDuration(d)}
                className={cn("py-1.5 text-xs font-medium transition-colors", duration === d ? "bg-rec text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {d}s
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Como a IA deve trabalhar">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Como a IA deve trabalhar">
          {MODES.map((m) => (
            <Choice key={m.value} active={mode === m.value} onClick={() => setMode(m.value)} label={m.label} hint={m.hint} />
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Falar o valor do produto no anúncio?" id="auto-price">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1 border p-1" role="radiogroup" aria-label="Falar o valor do produto">
              {[
                { v: false, l: "Não" },
                { v: true, l: "Sim" },
              ].map((o) => (
                <button
                  key={o.l}
                  type="button"
                  role="radio"
                  aria-checked={sayPrice === o.v}
                  onClick={() => setSayPrice(o.v)}
                  className={cn("py-1.5 text-xs font-medium transition-colors", sayPrice === o.v ? "bg-rec text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  {o.l}
                </button>
              ))}
            </div>
            {sayPrice && (
              <Input
                id="auto-price"
                autoFocus
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                maxLength={60}
                placeholder="Ex.: R$ 49,90 ou 4 por R$ 49,90"
                aria-label="Valor do produto"
              />
            )}
          </div>
        </Field>
        <Field label="Para onde o anúncio leva a pessoa?" id="auto-cta" hint="chamada final">
          <div className="flex flex-col gap-2">
            <Select value={cta} onValueChange={(v) => setCta(v as typeof cta)}>
              <SelectTrigger id="auto-cta" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CTAS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cta === "outro" && (
              <Input
                autoFocus
                value={ctaOther}
                onChange={(e) => setCtaOther(e.target.value)}
                maxLength={120}
                placeholder="Ex.: ligar para a loja, visitar o endereço…"
                aria-label="Chamada final"
              />
            )}
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button size="lg" className="bg-rec text-white hover:bg-rec/85" disabled={!ready} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <WandSparkles />}
          {busy ? "Começando…" : "Criar meu criativo"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {!configured
            ? "O chat não está disponível neste servidor."
            : "Leva de 10 a 20 minutos. Pode sair desta tela: a produção continua e fica na lista de conversas."}
        </span>
      </div>
    </div>
  );
}

function Choice({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-0.5 border p-3 text-left transition-colors",
        active ? "border-rec bg-rec/5" : "hover:border-foreground/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <span className={cn("size-2.5 shrink-0 border", active ? "border-rec bg-rec" : "border-muted-foreground")} aria-hidden />
        {label}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

// Etapas: pelos marcadores "Etapa N de 6" que o agente escreve e pelo que já foi gerado (o que der mais avanço).
function progressOf(items: ViewItem[]) {
  let done = 0;
  const texts = items.flatMap((it) => (it.kind === "assistant" ? [it.text] : []));
  for (const t of texts) for (const m of t.matchAll(/Etapa\s+(\d)\s+de\s+6/gi)) done = Math.max(done, Number(m[1]));
  if (texts.length) done = Math.max(done, 0);
  const tools = items.flatMap((it) => (it.kind === "tool" ? [it] : []));
  const ok = (name: string) => tools.some((t) => t.name === name && t.done && !t.error);
  const gens = tools.flatMap((t) => t.generations);
  if (ok("elevenlabs_tts")) done = Math.max(done, 3);
  const final = [...gens].reverse().find((g) => g.tool === "montagem" && g.status === "done");
  if (final) done = Math.max(done, 5);
  if (final && texts.some((t) => /criativo está pronto/i.test(t))) done = 6;
  return { done, final };
}

function Progress({ items, running }: { items: ViewItem[]; running: boolean }) {
  const { done, final } = progressOf(items);
  const last = items.at(-1);
  const waiting = !running && done < 6 && last?.kind === "assistant" && /\?\s*$/.test(last.text.trim());
  const url = final ? mediaUrl(final) : undefined;
  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-6 flex flex-col gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <ol className="grid grid-cols-6 gap-1" aria-label="Etapas do criativo">
        {STEPS.map((s, i) => {
          const state = i < done ? "done" : i === done && (running || done === 0) ? "active" : "todo";
          return (
            <li key={s} className="flex flex-col gap-1">
              <span className={cn("h-1", state === "done" ? "bg-rec" : state === "active" ? "animate-pulse bg-rec/50" : "bg-muted")} />
              <span className={cn("flex items-center gap-1 text-[0.6875rem] leading-tight", state === "todo" ? "text-muted-foreground" : "text-foreground")}>
                {state === "done" && <Check className="size-3 shrink-0 text-rec" aria-hidden />}
                <span className="truncate">{s}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {waiting && <p className="text-xs font-medium text-rec">A IA está esperando sua resposta: responda na caixa abaixo para continuar.</p>}
      {final && url && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">Vídeo final pronto.</span>
          <Button variant="outline" size="xs" asChild>
            <a href={`/ver/${final.id}`} target="_blank" rel="noreferrer">
              <Eye />
              Assistir
            </a>
          </Button>
          <Button variant="outline" size="xs" asChild>
            <a href={url} download={downloadName(final)}>
              <Download />
              Baixar
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
