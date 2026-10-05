"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { GenerationCard } from "@/components/studios/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch, type Generation, type GenerationTool, type MediaKind } from "@/lib/generations";

const TOOL_LABEL: Record<GenerationTool, string> = {
  elevenlabs: "ElevenLabs",
  heygen: "HeyGen",
  higgsfield: "Higgsfield",
  flora: "FLORA",
  upload: "Upload",
  editor: "Editor",
  montagem: "Montagem",
};

const FILTERS: { value: MediaKind | "all"; label: string }[] = [
  { value: "video", label: "Vídeos" },
  { value: "image", label: "Imagens" },
  { value: "audio", label: "Áudios" },
  { value: "all", label: "Tudo" },
];

// O que você salvou nos estúdios (ícone de marcador no card). Não some ao limpar o histórico.
export function LibraryView() {
  const [items, setItems] = useState<Generation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<MediaKind | "all">("video");

  useEffect(() => {
    apiFetch<{ generations: Generation[] }>("/api/generations?saved=1")
      .then((data) => setItems(data.generations))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Não consegui carregar a Biblioteca."))
      .finally(() => setLoaded(true));
  }, []);

  const drop = (id: string) => setItems((prev) => prev.filter((g) => g.id !== id));

  async function remove(id: string) {
    try {
      await apiFetch(`/api/generations/${id}`, { method: "DELETE" });
      drop(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui apagar.");
    }
  }

  const count = (kind: MediaKind | "all") => (kind === "all" ? items.length : items.filter((g) => g.kind === kind).length);
  const shown = filter === "all" ? items : items.filter((g) => g.kind === filter);

  return (
    <main className="flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader
        title="Biblioteca"
        description="Os criativos que você salvou. Para salvar, use o marcador no card de qualquer geração pronta nos estúdios."
      >
        <Tabs value={filter} onValueChange={(v) => setFilter(v as MediaKind | "all")}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{count(f.value)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {!loaded ? (
        <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nada salvo ainda. Nos estúdios, clique no marcador de uma geração pronta para trazê-la para cá."
            : "Nada salvo neste filtro."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((g) => (
            <GenerationCard
              key={g.id}
              g={g}
              onDelete={remove}
              onSavedChange={(updated) => !updated.saved && drop(updated.id)}
              title={String(g.params.name ?? g.params.editLabel ?? g.prompt)}
              meta={`${TOOL_LABEL[g.tool]} · ${new Date(g.createdAt).toLocaleDateString("pt-BR")}`}
            />
          ))}
        </div>
      )}
    </main>
  );
}
