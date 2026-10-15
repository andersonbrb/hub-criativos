import { connection } from "next/server";

import { AvatarStudio } from "@/components/studios/avatar-studio";
import { mcp } from "@/lib/server/mcp-client";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export default async function AvatarPage() {
  await exigirPagina("estudios");
  await connection();
  const configured = (await mcp("heygen").connectionStatus()).connected;
  return (
    <main className="h-workspace">
      <AvatarStudio configured={configured} />
    </main>
  );
}
