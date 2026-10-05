"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Library, Pause, Play, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Seletor de vozes do ElevenLabs organizado como a biblioteca deles: por gênero e faixa de idade.
// gender/age vêm dos labels da voz; nas clonadas sem labels, são deduzidos pelo nome (marcados com "~").

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

const GENDERS = [
  { id: "all", label: "Todas" },
  { id: "female", label: "Feminino" },
  { id: "male", label: "Masculino" },
  { id: "neutral", label: "Neutro" },
] as const;

const AGES = [
  { id: "all", label: "Todas as idades" },
  { id: "young", label: "Jovem" },
  { id: "middle_aged", label: "Meia-idade" },
  { id: "old", label: "Idoso(a)" },
] as const;

const GENDER_LABEL: Record<string, string> = { female: "Feminino", male: "Masculino", neutral: "Neutro", "": "Sem classificação" };
const AGE_LABEL: Record<string, Record<string, string>> = {
  female: { young: "Jovem", middle_aged: "Meia-idade", old: "Idosa", "": "Idade não informada" },
  male: { young: "Jovem", middle_aged: "Meia-idade", old: "Idoso", "": "Idade não informada" },
  neutral: { young: "Jovem", middle_aged: "Meia-idade", old: "Idoso(a)", "": "Idade não informada" },
  "": { young: "Jovem", middle_aged: "Meia-idade", old: "Idoso(a)", "": "" },
};
const GENDER_ORDER = ["female", "male", "neutral", ""];
const AGE_ORDER = ["young", "middle_aged", "old", ""];

const CATEGORY: Record<string, string> = { cloned: "clonada", generated: "criada", professional: "profissional", premade: "padrão" };

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
  const [gender, setGender] = useState<(typeof GENDERS)[number]["id"]>("all");
  const [age, setAge] = useState<(typeof AGES)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = voices.filter(
    (v) =>
      (gender === "all" || v.gender === gender) &&
      (age === "all" || v.age === age) &&
      (!q || `${v.name} ${v.description} ${v.accent ?? ""} ${v.useCase ?? ""}`.toLowerCase().includes(q)),
  );

  // Grupos na ordem gênero → idade, como na biblioteca do ElevenLabs.
  const groups = useMemo(() => {
    const map = new Map<string, PickerVoice[]>();
    for (const v of filtered) {
      const key = `${v.gender}|${v.gender ? v.age : ""}`;
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const [g, a] = key.split("|");
        return { key, g, a, list: list.sort((x, y) => x.name.localeCompare(y.name, "pt-BR")) };
      })
      .sort((x, y) => GENDER_ORDER.indexOf(x.g) - GENDER_ORDER.indexOf(y.g) || AGE_ORDER.indexOf(x.a) - AGE_ORDER.indexOf(y.a));
  }, [filtered]);

  const countBy = (id: string) => (id === "all" ? voices.length : voices.filter((v) => v.gender === id).length);

  function togglePreview(v: PickerVoice) {
    audioRef.current?.pause();
    if (playing === v.id || !v.previewUrl) return setPlaying(null);
    const a = new Audio(v.previewUrl);
    a.onended = () => setPlaying(null);
    audioRef.current = a;
    a.play().then(() => setPlaying(v.id)).catch(() => toast.error("Não consegui tocar a prévia."));
  }

  const selected = voices.find((v) => v.id === value);

  return (
    <div className="flex flex-col gap-2">
      {selected && (
        <div className="flex items-center gap-2 rounded-lg border border-rec/50 bg-rec/10 px-3 py-2 text-sm">
          <Check className="size-4 shrink-0 text-rec" />
          <span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {[GENDER_LABEL[selected.gender], selected.gender && AGE_LABEL[selected.gender][selected.age]].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar voz, sotaque, uso…" className="pl-8" aria-label="Buscar voz" />
        </div>
        <Button variant="outline" size="sm" asChild title="Abrir a biblioteca de vozes do ElevenLabs em uma nova guia">
          <a href={VOICE_LIBRARY_URL} target="_blank" rel="noreferrer">
            <Library />
            Biblioteca
            <ArrowUpRight />
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Gênero">
        {GENDERS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={gender === g.id}
            onClick={() => setGender(g.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              gender === g.id ? "border-rec bg-rec/15 text-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {g.label} <span className="font-mono tabular-nums opacity-70">{countBy(g.id)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Faixa de idade">
        {AGES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={age === a.id}
            onClick={() => setAge(a.id)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs transition-colors",
              age === a.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto rounded-lg border bg-card">
        {loading ? (
          <p className="p-4 text-center text-xs text-muted-foreground">Carregando vozes…</p>
        ) : groups.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma voz com esse filtro. Adicione vozes à sua conta pela{" "}
            <a href={VOICE_LIBRARY_URL} target="_blank" rel="noreferrer" className="underline">
              biblioteca do ElevenLabs
            </a>
            .
          </p>
        ) : (
          groups.map((grp) => (
            <section key={grp.key}>
              <h3 className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/90 px-3 py-1 text-[11px] font-semibold tracking-wider text-foreground/80 uppercase backdrop-blur">
                <span>{[GENDER_LABEL[grp.g], grp.g ? AGE_LABEL[grp.g][grp.a] : ""].filter(Boolean).join(" · ")}</span>
                <span className="font-mono tabular-nums">{grp.list.length}</span>
              </h3>
              <ul>
                {grp.list.map((v) => {
                  const active = v.id === value;
                  const tags = [v.accent, v.useCase, v.category !== "premade" ? CATEGORY[v.category] : ""].filter(Boolean);
                  return (
                    <li key={v.id} className={cn("flex items-center gap-1 border-b last:border-b-0", active && "bg-rec/10")}>
                      <button
                        type="button"
                        aria-label={playing === v.id ? `Parar prévia de ${v.name}` : `Ouvir ${v.name}`}
                        disabled={!v.previewUrl}
                        onClick={() => togglePreview(v)}
                        className="ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-30"
                      >
                        {playing === v.id ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onChange(v.id)}
                        aria-pressed={active}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {v.name}
                            {v.guessed && (
                              <span className="ml-1 text-[10px] text-muted-foreground" title="Gênero/idade deduzidos pelo nome (a voz não tem essa informação no ElevenLabs)">
                                ~
                              </span>
                            )}
                          </span>
                          {tags.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{tags.join(" · ")}</span>}
                        </span>
                        {active && <Check className="size-4 shrink-0 text-rec" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Aparecem as vozes da sua conta. Para usar uma voz da biblioteca, adicione-a à conta no ElevenLabs e recarregue esta página.
      </p>
    </div>
  );
}
