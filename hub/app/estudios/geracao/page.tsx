import { connection } from "next/server";

import { FloraStudio } from "@/components/studios/flora-studio";
import { mcp } from "@/lib/server/mcp-client";

export default async function GeracaoPage() {
  await connection();
  const configured = (await mcp("flora").connectionStatus()).connected;
  return (
    <main className="h-workspace">
      <FloraStudio configured={configured} />
    </main>
  );
}
