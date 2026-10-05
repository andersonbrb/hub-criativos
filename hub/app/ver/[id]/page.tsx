import Link from "next/link";
import { notFound } from "next/navigation";
import { Clapperboard, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { mediaUrl } from "@/lib/generations";
import { getGeneration } from "@/lib/server/store";

const TOOL_NAMES: Record<string, string> = {
  flora: "FLORA",
  heygen: "HeyGen",
  higgsfield: "Higgsfield",
  elevenlabs: "ElevenLabs",
  upload: "Anexo",
  editor: "Editor de vídeo",
  montagem: "Montagem",
};

// Visualização de uma geração em tela cheia (link aberto a partir dos cards do chat, estúdios e quadro).
export default async function VerPage({ params }: PageProps<"/ver/[id]">) {
  const { id } = await params;
  const g = await getGeneration(id);
  const url = g && mediaUrl(g);
  if (!g || !url) notFound();

  return (
    <main className="flex h-workspace flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b px-4 py-1.5">
        <span className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{TOOL_NAMES[g.tool] ?? g.tool}</span>
        <p className="min-w-0 flex-1 truncate text-sm" title={g.prompt}>
          {g.prompt}
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={url} download>
            <Download />
            Baixar
          </a>
        </Button>
        {g.kind === "video" && (
          <Button size="sm" asChild>
            <Link href={`/editor?gen=${g.id}`}>
              <Clapperboard />
              Abrir no editor
            </Link>
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
        {g.kind === "video" ? (
          <video src={url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
        ) : g.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- mídia local gerada
          <img src={url} alt={g.prompt} className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <audio src={url} controls autoPlay className="w-full max-w-xl" />
        )}
      </div>
    </main>
  );
}
