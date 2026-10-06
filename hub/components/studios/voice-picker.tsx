"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Pause, Play, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Seletor de vozes do ElevenLabs, enxuto: mostra a voz escolhida e os gêneros; a lista só abre ao clicar num
// gênero, já organizada por faixa de idade (como na biblioteca do ElevenLabs). Escolher uma voz fecha a lista.
// gender/age vêm dos labels da voz; nas clonadas sem labels, são deduzidos pelo nome.

export type PickerVoice = {
  id: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string | null;
  gender: "female" | "male" | "neutral" | "";
  age: "young" | "middle_aged" | "old" | "";
  guessed?: boolean;
  accent?: string;
  useCase?: string;
};

export const VOICE_LIBRARY_URL = "https://elevenlabs.io/app/voice-library";

type GenderTab = "female" | "male" | "other";

const GENDERS: { id: GenderTab; label: string }[] = [
  { id: "female", label: "Feminino" },
  { id: "male", label: "Masculino" },
  { id: "other", label: "Outras" },
];

const AGES = [
  { id: "all", label: "Todas" },
  { id: "young", label: "Jovem" },
  { id: "middle_aged", label: "Meia-idade" },
  { id: "old", label: "Idosa(o)" },
] as const;

const AGE_ORDER = ["young", "middle_aged", "old", ""];
const AGE_TITLE: Record<string, string> = { young: "Jovem", middle_aged: "Meia-idade", old: "Idosa(o)", "": "Idade não informada" };
const GENDER_SHORT: Record<string, string> = { female: "Feminino", male: "Masculino", neutral: "Neutro", "": "" };

const tabOf = (v: PickerVoice): GenderTab => (v.gender === "female" ? "female" : v.gender === "male" ? "male" : "other");

export function VoicePicker({
  voices,
  value,
  onChange,
  loading,
}: {
  voices: PickerVoice[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState<GenderTab | null>(null);
  const [age, setAge] = useState<(typeof AGES)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selected = voices.find((v) => v.id === value);
  const count = (tab: GenderTab) => voices.filter((v) => tabOf(v) === tab).length;

  const groups = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const list = voices.filter((v) => tabOf(v) === open && (age === "all" || v.age === age) && (!q || `${v.name} ${v.accent ?? ""}`.toLowerCase().includes(q)));
    return AGE_ORDER.map((a) => ({ age: a, list: list.filter((v) => v.age === a).sort((x, y) => x.name.localeCompare(y.name, "pt-BR")) })).filter((g) => g.list.length);
  }, [voices, open, age, query]);

  function togglePreview(v: PickerVoice) {
    audioRef.current?.pause();
    if (playing === v.id || !v.previewUrl) return setPlaying(null);
    const a = new Audio(v.previewUrl);
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    a.play().then(() => setPlaying(v.id)).catch(() => toast.error("Não consegui tocar a prévia."));
  }

  function toggleGender(tab: GenderTab) {
    setOpen((cur) => (cur === tab ? null : tab));
    setAge("all");
    setQuery("");
  }

  const playButton = (v: PickerVoice) => (
    <button
      type="button"
      aria-label={playing === v.id ? `Parar prévia de ${v.name}` : `Ouvir ${v.name}`}
      disabled={!v.previewUrl}
      onClick={() => togglePreview(v)}
      className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-30"
    >
      {playing === v.id ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Voz escolhida */}
      <div className="flex items-center gap-1 rounded-lg border border-rec/50 bg-rec/10 py-1 pr-3 pl-1">
        {selected ? (
          <>
            {playButton(selected)}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {[GENDER_SHORT[selected.gender], selected.age ? AGE_TITLE[selected.age] : ""].filter(Boolean).join(" · ")}
            </span>
          </>
        ) : (
          <span className="px-2 py-1 text-sm text-muted-foreground">{loading ? "Carregando vozes…" : "Escolha uma voz abaixo"}</span>
        )}
      </div>

      {/* Gêneros: cada um abre/fecha a sua lista */}
      <div className="flex flex-wrap items-center gap-1.5">
        {GENDERS.map((g) => {
          const n = count(g.id);
          if (!n && g.id === "other") return null;
          const active = open === g.id;
          return (
            <button
              key={g.id}
              type="button"
              aria-expanded={active}
              onClick={() => toggleGender(g.id)}
              disabled={loading || !n}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                active ? "border-rec bg-rec/15 text-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {g.label}
              <span className="font-mono tabular-nums opacity-60">{n}</span>
              <ChevronDown className={cn("size-3 transition-transform", active && "rotate-180")} />
            </button>
          );
        })}
        <a
          href={VOICE_LIBRARY_URL}
          target="_blank"
          rel="noreferrer"
          title="Abrir a biblioteca de vozes do ElevenLabs em uma nova guia. Vozes adicionadas à sua conta aparecem aqui ao recarregar."
          className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Biblioteca
          <ArrowUpRight className="size-3" />
        </a>
      </div>

      {/* Lista do gênero escolhido */}
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
          <div className="flex flex-wrap items-center gap-1">
            {AGES.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={age === a.id}
                onClick={() => setAge(a.id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] transition-colors",
                  age === a.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pelo nome" className="h-7 pl-8 text-xs" aria-label="Buscar voz" />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Nenhuma voz com esse filtro.</p>
            ) : (
              groups.map((g) => (
                <section key={g.age}>
                  <h3 className="sticky top-0 z-10 bg-card px-1 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {AGE_TITLE[g.age]} · {g.list.length}
                  </h3>
                  <ul>
                    {g.list.map((v) => {
                      const active = v.id === value;
                      return (
                        <li key={v.id} className={cn("flex items-center rounded-md", active ? "bg-rec/10" : "hover:bg-muted/60")}>
                          {playButton(v)}
                          <button
                            type="button"
                            onClick={() => {
                              onChange(v.id);
                              setOpen(null);
                            }}
                            aria-pressed={active}
                            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">{v.name}</span>
                            {active && <Check className="size-3.5 shrink-0 text-rec" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
