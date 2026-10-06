"use client";

import { useState } from "react";
import {
  Check,
  Clapperboard,
  LayoutGrid,
  MessageSquare,
  Mic,
  Moon,
  Palette,
  Sparkles,
  Sun,
  UserRound,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { setDesign, useDesign } from "@/components/design";
import { setTheme, useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_DESIGN, DESIGNS, type Design } from "@/lib/designs";
import { cn } from "@/lib/utils";

// Página /design: uma miniatura do hub em cada direção de design, no claro ou no escuro, e o botão de aplicar.
// Cada miniatura é um contêiner com data-design (app/designs.css), então mostra as cores, fontes e acabamentos reais.

function Preview({ design, mode }: { design: Design; mode: "dark" | "light" }) {
  return (
    <div
      data-design={design.id}
      className={cn(
        mode,
        "flex h-[380px] overflow-hidden rounded-[calc(var(--radius)+4px)] border bg-background text-foreground",
      )}
    >
      {/* Menu lateral */}
      <aside className="hidden w-40 shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar p-2.5 text-sidebar-foreground sm:flex">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-rec text-white">
            <Clapperboard className="size-3.5" />
          </span>
          <span className="font-heading text-sm leading-tight">
            Hub de Criativos
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 text-xs">
          {[
            { icon: MessageSquare, label: "Chat principal", active: true },
            { icon: LayoutGrid, label: "Fluxo" },
            { icon: Sparkles, label: "Geração", tool: "FLORA" },
            { icon: Mic, label: "Voz", tool: "ElevenLabs" },
            { icon: UserRound, label: "Avatar", tool: "HeyGen" },
          ].map((i) => (
            <span
              key={i.label}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5",
                i.active &&
                  "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              <i.icon className="size-3.5" />
              <span className="flex-1 truncate">{i.label}</span>
              {i.tool && (
                <span className="font-mono text-[9px] text-muted-foreground">
                  {i.tool}
                </span>
              )}
            </span>
          ))}
        </nav>
      </aside>

      {/* Área principal */}
      <div className="hub-canvas flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h3 className="font-heading text-lg">Geração</h3>
          <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">
            FLORA
          </span>
          <span className="flex-1" />
          <Button variant="outline" size="xs">
            Abrir no FLORA
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden p-3 md:grid-cols-[1fr_0.9fr]">
          <Card className="hub-panel gap-2.5 p-3">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-foreground/85 uppercase">
              <span className="size-1.5 rounded-full bg-rec" /> Prompt
            </span>
            <Textarea
              rows={3}
              readOnly
              value="Mulher de 35 anos segurando a garrafa térmica na cozinha, luz da manhã, estilo UGC"
              className="min-h-0 text-xs md:text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                readOnly
                value="9:16"
                className="h-7 text-xs md:text-xs"
                aria-label="Proporção"
              />
              <Input
                readOnly
                value="Qualidade média"
                className="h-7 text-xs md:text-xs"
                aria-label="Qualidade"
              />
            </div>
            <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Custo estimado</span>
              <b className="font-mono text-foreground">US$ 0,25</b>
            </div>
            <Button size="sm" className="bg-rec text-white hover:bg-rec/85">
              <Wand2 />
              Gerar frame
            </Button>
          </Card>

          <div className="hidden min-h-0 flex-col gap-2.5 md:flex">
            {/* Chat */}
            <Card className="hub-panel gap-2 p-2.5 text-xs">
              <p className="ml-auto max-w-[85%] rounded-lg bg-muted px-2.5 py-1.5">
                3 ganchos de 3s para o ângulo do café
              </p>
              <p className="max-w-[92%] leading-relaxed">
                <b className="font-heading font-normal">Gancho 1:</b> &ldquo;Meu
                café ainda está pelando… e eu servi há 12 horas.&rdquo;
              </p>
              <span className="flex items-center gap-1.5 self-start rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Check className="size-3 text-ok" /> elevenlabs_tts · narração
                pronta
              </span>
            </Card>
            {/* Kanban */}
            <Card className="hub-panel gap-1.5 border-l-4 border-l-rec p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <b>AD07 · Garrafa térmica</b>
                <span className="rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-medium text-ok">
                  Pronto
                </span>
              </div>
              <span className="text-muted-foreground">
                COD · Chile · 3 variações
              </span>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  Gerando
                </span>
                <span className="rounded-full bg-rec/15 px-1.5 py-0.5 text-[10px] font-medium text-rec">
                  Avatar
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesignGallery() {
  const current = useDesign();
  const theme = useTheme();
  // As prévias abrem no claro (o usuário pediu um visual mais leve); dá para alternar.
  const [mode, setMode] = useState<"dark" | "light">("light");
  const previewMode = mode;

  function apply(d: Design) {
    setDesign(d.id);
    // Direções leves levam o hub para o claro junto (o escuro delas continua disponível no botão de tema).
    if (d.prefers === "light" && theme !== "light") setTheme("light");
    toast.success(`Design "${d.name}" aplicado no hub.`);
  }

  return (
    <main className="flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-heading text-2xl">
            <Palette className="size-5" /> Aparência
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Escolha a direção de design do hub. Cada prévia usa as cores, fontes
            e acabamentos de verdade. Aplicar muda o hub inteiro na hora, e dá
            para voltar quando quiser.
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-lg border p-0.5"
          role="radiogroup"
          aria-label="Prévia no claro ou no escuro"
        >
          {(["dark", "light"] as const).map((m) => (
            <Button
              key={m}
              role="radio"
              aria-checked={previewMode === m}
              variant={previewMode === m ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMode(m)}
            >
              {m === "dark" ? <Moon /> : <Sun />}
              {m === "dark" ? "Escuro" : "Claro"}
            </Button>
          ))}
        </div>
      </header>

      {[
        {
          title: "Padrão do hub",
          hint: "O design que vale para todos, em qualquer navegador.",
          items: DESIGNS.filter((d) => d.id === DEFAULT_DESIGN),
        },
        {
          title: "Leves",
          hint: "Claras por padrão, com o escuro suave.",
          items: DESIGNS.filter((d) => d.prefers === "light" && d.id !== DEFAULT_DESIGN),
        },
        {
          title: "Mais opções",
          hint: "Direções mais marcantes e a antiga, para comparar.",
          items: DESIGNS.filter((d) => d.prefers !== "light" && d.id !== DEFAULT_DESIGN),
        },
      ].map((group) => (
        <section key={group.title} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2 border-b pb-1.5">
            <h2 className="font-heading text-xl">{group.title}</h2>
            <span className="text-xs text-muted-foreground">{group.hint}</span>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {group.items.map((d) => {
              const active = current === d.id;
              return (
                <section
                  key={d.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-3",
                    active && "border-rec ring-2 ring-rec/30",
                  )}
                >
                  <Preview design={d} mode={previewMode} />
                  <div className="flex flex-wrap items-start justify-between gap-3 px-1">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-heading text-lg">{d.name}</h2>
                        <span className="flex gap-1" aria-hidden>
                          {d.swatches[previewMode].map((c) => (
                            <span
                              key={c}
                              className="size-3.5 rounded-full border"
                              style={{ background: c }}
                            />
                          ))}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {d.tagline}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <b className="text-foreground/80">Mistura:</b> {d.mix} ·{" "}
                        <b className="text-foreground/80">Fontes:</b> {d.fonts}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Button
                        className={cn(
                          active ? "" : "bg-rec text-white hover:bg-rec/85",
                        )}
                        variant={active ? "outline" : "default"}
                        disabled={active}
                        onClick={() => apply(d)}
                      >
                        {active ? <Check /> : <Palette />}
                        {active ? "Em uso" : "Aplicar no hub"}
                      </Button>
                      {d.prefers === "light" && (
                        <span className="text-[11px] text-muted-foreground">
                          Leve: aplica no claro
                        </span>
                      )}
                      {active && mode !== theme && (
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() => setTheme(mode)}
                        >
                          Usar o hub no {mode === "dark" ? "escuro" : "claro"}
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
