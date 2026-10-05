// Tipos compartilhados entre servidor e cliente para tudo que os estúdios geram.

// "upload" = arquivo anexado no chat (foto do produto, vídeo, áudio). "editor" = vídeo exportado pelo editor do hub.
// "montagem" = montagem automática local do infoproduto (cortes de silêncio + legendas + b-rolls, scripts/montagem.py).
export type GenerationTool = "elevenlabs" | "heygen" | "higgsfield" | "flora" | "upload" | "editor" | "montagem";
export type MediaKind = "audio" | "video" | "image";
export type GenerationStatus = "pending" | "running" | "done" | "failed";

export type Generation = {
  id: string;
  tool: GenerationTool;
  kind: MediaKind;
  status: GenerationStatus;
  prompt: string;
  params: Record<string, string | number | boolean | null>;
  // Arquivo salvo em hub/.data/media, servido por /api/media/<file>
  file?: string;
  // URL remota original (quando a ferramenta devolve um link)
  remoteUrl?: string;
  // ID do job na ferramenta, para acompanhar o status
  jobId?: string;
  error?: string;
  // Salva por você na Biblioteca: "Limpar" nos estúdios não apaga.
  saved?: boolean;
  createdAt: string;
};

export const mediaUrl = (g: Generation) => (g.file ? `/api/media/${g.file}` : g.remoteUrl);

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}
