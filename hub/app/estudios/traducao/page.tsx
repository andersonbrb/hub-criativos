import { connection } from "next/server";

import { TranslateStudio } from "@/components/studios/translate-studio";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

export default async function TraducaoPage() {
  await exigirPagina("estudios");
  await connection();
  return (
    <main className="h-workspace">
      <TranslateStudio />
    </main>
  );
}
