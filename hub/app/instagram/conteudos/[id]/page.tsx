import type { Metadata } from "next";

import { ReviewView } from "@/features/instagram/tela/review/components/review-view";

export const metadata: Metadata = { title: "Revisão" };

export default async function InstagramConteudoPage({ params }: PageProps<"/instagram/conteudos/[id]">) {
  const { id } = await params;
  return <ReviewView id={id} />;
}
