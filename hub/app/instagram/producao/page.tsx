import type { Metadata } from "next";

import { PipelineView } from "@/features/instagram/tela/pipeline/components/pipeline-view";

export const metadata: Metadata = { title: "Produção" };

export default function InstagramProducaoPage() {
  return <PipelineView />;
}
