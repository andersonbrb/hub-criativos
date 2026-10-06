import { connection } from "next/server";

import { TranslateStudio } from "@/components/studios/translate-studio";

export default async function TraducaoPage() {
  await connection();
  return (
    <main className="h-workspace">
      <TranslateStudio />
    </main>
  );
}
