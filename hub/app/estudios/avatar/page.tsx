import { connection } from "next/server";

import { AvatarStudio } from "@/components/studios/avatar-studio";
import { mcp } from "@/lib/server/mcp-client";

export default async function AvatarPage() {
  await connection();
  const configured = (await mcp("heygen").connectionStatus()).connected;
  return (
    <main className="h-workspace">
      <AvatarStudio configured={configured} />
    </main>
  );
}
