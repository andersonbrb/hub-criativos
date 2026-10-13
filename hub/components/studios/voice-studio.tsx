"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { Field, GenerationCard, HistoryActions, HistoryPanel, MissingKey, useGenerations } from "@/components/studios/shared";
import { VoicePicker, type PickerVoice } from "@/components/studios/voice-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { AUDIO_TAGS, DEFAULT_ELEVEN_MODEL, ELEVEN_MODELS, elevenModelLabel, isHalfCreditModel } from "@/lib/elevenlabs-models";
import { apiFetch, type Generation } from "@/lib/generations";

const DESCRIPTION =
  "Texto para fala com as vozes da sua conta ElevenLabs. As narrações ficam salvas no hub e vão para o Avatar e o Editor.";

type Voice = PickerVoice;

// Modelos vêm de lib/elevenlabs-models.ts (o mesmo que o servidor usa). O MCP do ElevenLabs não tem ajustes de voz
// (estabilidade, similaridade, estilo, velocidade): só modelo e voz.
const MODELS = ELEVEN_MODELS;

export function VoiceStudio({ configured }: { configured: boolean }) {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  // Sempre começa no modelo mais avançado.
  const [modelId, setModelId] = useState(DEFAULT_ELEVEN_MODEL);
  const [busy, setBusy] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const { items, loaded, add, remove, clear } = useGenerations("elevenlabs");

  useEffect(() => {
    if (!configured) return;
    apiFetch<{ voices: Voice[] }>("/api/elevenlabs/voices")
      .then((d) => {
        setVoices(d.voices);
        setVoiceId((cur) => cur || d.voices[0]?.id || "");
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setVoicesLoaded(true));
  }, [configured]);

  const voice = voices.find((v) => v.id === voiceId);
  const model = MODELS.find((m) => m.id === modelId)!;
  const credits = isHalfCreditModel(modelId) ? Math.ceil(text.length / 2) : text.length;
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Insere a tag de emoção onde está o cursor (antes da frase que ela deve colorir).
  function insertTag(tag: string) {
    const el = textRef.current;
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const piece = `${before && !/\s$/.test(before) ? " " : ""}${tag} `;
    setText(before + piece + text.slice(at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + piece.length, at + piece.length);
    });
  }

  async function generate() {
    setBusy(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>("/api/elevenlabs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, voiceName: voice?.name, modelId }),
      });
      add(generation);
      toast.success("Narração gerada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Workspace
      id="estudio-voz"
      className="h-full"
      toolbar={
        <>
          <h1 className="shrink-0 font-heading text-lg font-bold tracking-tight">Voz</h1>
          <span className="shrink-0 rounded border px-1.5 font-mono text-[0.6875rem] text-muted-foreground">ElevenLabs</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{DESCRIPTION}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{DESCRIPTION}</TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          <OpenAppButton app="elevenlabs" />
        </>
      }
      presets={[
        { id: "padrao", label: "Padrão", layout: { roteiro: 68, ajustes: 32, historico: "collapsed" } },
        { id: "lado", label: "Com histórico", layout: { roteiro: 45, ajustes: 25, historico: 30 } },
        { id: "historico", label: "Foco no histórico", layout: { roteiro: "collapsed", ajustes: "collapsed", historico: 100 } },
      ]}
    >
      <WorkspacePanel id="roteiro" title="Roteiro" defaultSize={68} fill minSize={20} bodyClassName="flex flex-col">
        {!configured && (
          <div className="p-4 pb-0">
            <MissingKey envVar="ELEVENLABS_API_KEY" where="elevenlabs.io → Developers → API Keys" />
          </div>
        )}
        <label htmlFor="tts-text" className="sr-only">Texto da narração</label>
        {model.audioTags && (
          <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
            <span className="mr-1 text-[0.6875rem] text-muted-foreground" title="Coloque a tag antes da frase. Use poucas: uma a cada uma ou duas frases.">
              Emoção:
            </span>
            {AUDIO_TAGS.map((t) => (
              <button
                key={t.tag}
                type="button"
                title={`Insere ${t.tag} no cursor`}
                onClick={() => insertTag(t.tag)}
                className="border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:border-rec hover:text-foreground"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <Textarea
          ref={textRef}
          id="tts-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={5000}
          placeholder="Cole aqui o roteiro aprovado pelo agente de Copy…"
          className="min-h-64 flex-1 resize-none rounded-none border-0 bg-transparent! p-5 text-base leading-relaxed shadow-none focus-visible:ring-0"
        />
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background px-4 py-3 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{text.length.toLocaleString("pt-BR")} / 5.000</span>
          <span>≈ {credits.toLocaleString("pt-BR")} créditos</span>
          <span className="flex-1" />
          <Button
            className="bg-rec text-white hover:bg-rec/85"
            disabled={!configured || busy || !text.trim() || !voiceId}
            onClick={generate}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? "Gerando…" : "Gerar narração"}
          </Button>
        </div>
      </WorkspacePanel>

      <WorkspacePanel id="ajustes" title="Configurações" defaultSize={32} minSize={16} bodyClassName="flex flex-col gap-5 p-4">
        <Field label="Voz" id="tts-voice">
          {configured ? (
            <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} loading={!voicesLoaded} />
          ) : (
            <p className="text-xs text-muted-foreground">Conecte o ElevenLabs em Integrações para ver suas vozes.</p>
          )}
        </Field>

        <Field label="Modelo" id="tts-model">
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger id="tts-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{model.note}</p>
        </Field>

      </WorkspacePanel>

      <WorkspacePanel
        id="historico"
        title="Histórico"
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
          empty="As narrações geradas aparecem aqui."
          className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3"
        >
          {items.map((g) => (
            <GenerationCard
              key={g.id}
              g={g}
              onDelete={remove}
              meta={`${g.params.voiceName || "Voz"} · ${elevenModelLabel(String(g.params.modelId ?? ""))} · ${new Date(g.createdAt).toLocaleString("pt-BR")}`}
            />
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}
