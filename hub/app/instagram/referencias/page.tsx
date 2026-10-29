import type { Metadata } from "next";

import { ReferenceView } from "@/features/instagram/tela/reference/components/reference-view";

export const metadata: Metadata = { title: "Referências" };

export default function InstagramReferenciasPage() {
  return <ReferenceView />;
}
