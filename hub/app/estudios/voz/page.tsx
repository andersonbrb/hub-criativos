import { connection } from "next/server";

import { VoiceStudio } from "@/components/studios/voice-studio";
import { mcp } from "@/lib/server/mcp-client";

export default async function VozPage() {
  await connection(); // confere a conexão MCP a cada acesso, não no build
  const configured = (await mcp("elevenlabs").connectionStatus()).connected;
  return (
    <main className="h-workspace">
      <VoiceStudio configured={configured} />
    </main>
  );
}
