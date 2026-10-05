import { connection } from "next/server";

import { PipelineView } from "@/components/pipeline/pipeline-view";
import { getBoard } from "@/lib/server/board";
import { listGenerations } from "@/lib/server/store";

export default async function PipelinePage() {
  await connection(); // quadro lido do disco a cada acesso, não no build
  const [board, generations] = await Promise.all([getBoard(), listGenerations()]);
  return (
    <main className="h-workspace">
      <PipelineView initialBoard={board} initialGenerations={generations} />
    </main>
  );
}
