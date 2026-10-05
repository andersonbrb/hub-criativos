import { connection } from "next/server";

import { VoiceStudio } from "@/components/studios/voice-studio";
import { hasKey } from "@/lib/server/env";

export default async function VozPage() {
  await connection(); // lê a chave a cada acesso, não no build
  const configured = hasKey("elevenlabs");
  return (
    <main className="h-workspace">
      <VoiceStudio configured={configured} />
    </main>
  );
}
