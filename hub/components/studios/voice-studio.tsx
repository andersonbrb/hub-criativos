"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { OpenAppButton } from "@/components/open-app-button";
import { Field, GenerationCard, HistoryActions, HistoryPanel, MissingKey, SliderField, useGenerations } from "@/components/studios/shared";
import { VoicePicker, type PickerVoice } from "@/components/studios/voice-picker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace, WorkspacePanel } from "@/components/workspace";
import { apiFetch, type Generation } from "@/lib/generations";

const DESCRIPTION =
  "Texto para fala com as vozes da sua conta ElevenLabs. As narrações ficam salvas no hub e vão para o Avatar e o Editor.";

type Voice = PickerVoice;

const MODELS = [
  { id: "eleven_v4", label: "Eleven v4", note: "Melhor qualidade, mais natural" },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo", note: "Quase a mesma qualidade, bem mais rápido" },
  { id: "eleven_v3", label: "Eleven v3", note: "Expressivo, aceita tags como [risos]" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2", note: "O mais estável para textos longos" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5", note: "O mais barato e rápido" },
];

const DEFAULTS = { stability: 0.5, similarity: 0.75, style: 0, speed: 1 };

const SAMPLE =
  "Eu parei de tomar café por 7 dias… e olha o que aconteceu. Na primeira noite eu já senti diferença. Comecei a usar o SonoLeve 30 minutos antes de deitar e acordei descansada pela primeira vez em meses.";

export function VoiceStudio({ configured }: { configured: boolean }) {
  const [text, setText] = useState(SAMPLE);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState("eleven_multilingual_v2");
  const [settings, setSettings] = useState(DEFAULTS);
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
  const credits = modelId === "eleven_flash_v2_5" ? Math.ceil(text.length / 2) : text.length;

  async function generate() {
    setBusy(true);
    try {
      const { generation } = await apiFetch<{ generation: Generation }>("/api/elevenlabs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, voiceName: voice?.name, modelId, ...settings }),
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
          <span className="shrink-0 rounded border px-1.5 font-mono text-[11px] text-muted-foreground">ElevenLabs</span>
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
        <Textarea
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
            <p className="text-xs text-muted-foreground">Conecte a chave do ElevenLabs para ver suas vozes.</p>
          )}
          {voice?.description && <p className="line-clamp-2 text-xs text-muted-foreground">{voice.description}</p>}
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

        <SliderField
          label="Velocidade"
          min={0.7}
          max={1.2}
          value={settings.speed}
          onChange={(speed) => setSettings((s) => ({ ...s, speed }))}
          format={(v) => `${v.toFixed(2)}×`}
          left="Mais lenta"
          right="Mais rápida"
        />
        <SliderField
          label="Estabilidade"
          value={settings.stability}
          onChange={(stability) => setSettings((s) => ({ ...s, stability }))}
          left="Mais variável"
          right="Mais estável"
        />
        <SliderField
          label="Similaridade"
          value={settings.similarity}
          onChange={(similarity) => setSettings((s) => ({ ...s, similarity }))}
          left="Baixa"
          right="Alta"
        />
        <SliderField
          label="Exagero de estilo"
          value={settings.style}
          onChange={(style) => setSettings((s) => ({ ...s, style }))}
          left="Nenhum"
          right="Exagerado"
        />
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setSettings(DEFAULTS)}>
          <RotateCcw />
          Restaurar padrão
        </Button>
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
              meta={`${g.params.voiceName || "Voz"} · ${MODELS.find((m) => m.id === g.params.modelId)?.label ?? g.params.modelId} · ${new Date(g.createdAt).toLocaleString("pt-BR")}`}
            />
          ))}
        </HistoryPanel>
      </WorkspacePanel>
    </Workspace>
  );
}
