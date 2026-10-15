import { MontageStudio } from "@/components/studios/montage-studio";
import { exigirPagina } from "@/features/acesso/servicos/sessao";

// Edição final do criativo (cortes, juntar vídeos, b-rolls nos momentos certos, legenda no padrão).
// Roda local com o pipeline do playbook (scripts/montagem.py). As edições de IA do Higgsfield foram removidas.
export default async function EdicaoPage() {
  await exigirPagina("estudios");
  return (
    <main className="h-workspace">
      <MontageStudio />
    </main>
  );
}
