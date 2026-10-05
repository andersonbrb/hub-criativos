import { Editor } from "@/components/editor/editor";

// /editor?p=<projeto> abre um projeto; /editor?gen=<geração> abre (ou retoma) a edição de um vídeo do hub.
export default async function EditorPage({ searchParams }: PageProps<"/editor">) {
  const { p, gen } = await searchParams;
  return (
    <main className="h-workspace">
      <Editor initialProjectId={typeof p === "string" ? p : null} initialGenerationId={typeof gen === "string" ? gen : null} />
    </main>
  );
}
