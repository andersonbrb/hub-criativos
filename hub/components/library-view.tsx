"use client";

import { useEffect, useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
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
  montagem: "Edição",
  "heygen-traducao": "Tradução",
  instagram: "Instagram",
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9 2xl:max-w-[96rem]">
      <PageHeader
        eyebrow="Produção"
        title="Biblioteca"
        description="Os criativos finais (edição, editor e tradução) entram aqui sozinhos quando ficam prontos. Para salvar qualquer outra geração, use o marcador no card."
      >
        <Tabs value={filter} onValueChange={(v) => setFilter(v as MediaKind | "all")}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
                <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{count(f.value)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {!loaded ? (
        <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
      ) : shown.length === 0 ? (
        <EmptyState icon={Library} title={items.length === 0 ? "Nada aqui ainda" : "Nada salvo neste filtro"}>
          {items.length === 0
            ? "Os criativos finais entram sozinhos; nos estúdios, o marcador de um card traz qualquer geração para cá."
            : "Troque o filtro acima para ver o resto da Biblioteca."}
        </EmptyState>
      ) : (
        <div className="hub-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
