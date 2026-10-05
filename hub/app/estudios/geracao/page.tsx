import { connection } from "next/server";

import { FloraStudio } from "@/components/studios/flora-studio";
import { hasKey } from "@/lib/server/env";

export default async function GeracaoPage() {
  await connection();
  const configured = hasKey("flora");
  return (
    <main className="h-workspace">
      <FloraStudio configured={configured} />
    </main>
  );
}
