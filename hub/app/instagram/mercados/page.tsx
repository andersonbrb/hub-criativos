import type { Metadata } from "next";

import { MarketsView } from "@/features/instagram/tela/markets/components/markets-view";

export const metadata: Metadata = { title: "Mercados" };

export default function InstagramMercadosPage() {
  return <MarketsView />;
}
