import { connection } from "next/server";

import { AvatarStudio } from "@/components/studios/avatar-studio";
import { hasKey } from "@/lib/server/env";

export default async function AvatarPage() {
  await connection();
  const configured = hasKey("heygen");
  return (
    <main className="h-workspace">
      <AvatarStudio configured={configured} />
    </main>
  );
}
