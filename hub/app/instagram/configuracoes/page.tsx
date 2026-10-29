import type { Metadata } from "next";

import { SettingsView } from "@/features/instagram/tela/settings/components/settings-view";

export const metadata: Metadata = { title: "Configurações" };

export default function InstagramConfiguracoesPage() {
  return <SettingsView />;
}
