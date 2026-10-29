// Tipos compartilhados entre servidor e cliente para tudo que os estúdios geram.

// "upload" = arquivo anexado no chat (foto do produto, vídeo, áudio). "editor" = vídeo exportado pelo editor do hub.
// "montagem" = montagem automática local do infoproduto (cortes de silêncio + legendas + b-rolls, scripts/montagem.py).
// "heygen-traducao" = vídeo traduzido pelo HeyGen (pelo MCP, créditos do plano; lib/server/video-translation.ts).
// "instagram" = mídia da linha de produção do Instagram (features/instagram): cópia do post de referência, vídeo sem
// legenda, traduzido, editado e as imagens adaptadas. params.instagramChave é o nome do arquivo no Instagram.
export type GenerationTool = "elevenlabs" | "heygen" | "heygen-traducao" | "higgsfield" | "flora" | "upload" | "editor" | "montagem" | "instagram";
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
  // Nome dado por você (renomear no card). Não substitui o prompt, que é o que os agentes leem.
  name?: string;
  createdAt: string;
  // Quando ficou pronta ou falhou (calibra a previsão de tempo das próximas).
  finishedAt?: string;
  // Vídeo guardado no Google Drive (features/drive): é a ÚNICA cópia. `file` continua sendo a chave do endereço
  // /api/media/<file>, que passa a buscar o vídeo no Drive.
  drive?: { id: string; pasta: string };
  // O arquivo foi apagado ou foi para a lixeira direto no Drive: o hub esconde a geração (espelho do Drive).
  foraDoDrive?: boolean;
};

export const mediaUrl = (g: Generation) => (g.file ? `/api/media/${g.file}` : g.remoteUrl);

// Regra do dono: vídeo só fica guardado no Google Drive. Vídeo pronto que ainda não chegou lá não aparece como pronto:
// a Biblioteca e o Fluxo não mostram, e o card diz que está subindo (ou esperando o Drive).
export const videoForaDoDrive = (g: Generation) => g.kind === "video" && g.status === "done" && !g.drive;

// Vídeo novo subindo para o Drive agora (dentro do prazo, sem falha no envio): a tela acompanha até chegar lá.
export const subindoParaODrive = (g: Generation) => videoForaDoDrive(g) && typeof g.params.prazoNoHub === "string" && g.params.paraDrive !== true;

// O que as listas da Biblioteca e do Fluxo mostram.
export const apareceNasListas = (g: Generation) => !videoForaDoDrive(g);

// Nome mostrado no card: o seu, senão o da tela que listou (ex.: nome da edição), senão o prompt.
export const generationTitle = (g: Generation, fallback?: string) => g.name || fallback || g.prompt;

// Nome do arquivo ao baixar: o nome dado (ou o começo do prompt), sem caracteres inválidos.
export function downloadName(g: Generation) {
  const ext = (g.file ?? g.remoteUrl ?? "").split("?")[0].split(".").pop() || (g.kind === "audio" ? "mp3" : g.kind === "image" ? "png" : "mp4");
  const base = (g.name || g.prompt || g.tool)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return `${base || g.id}.${ext}`;
}

// ---------- Previsão de tempo ----------
// Segundos que cada tipo costuma levar (média observada no hub). null = sem previsão (mostra só "Gerando…").
export function expectedSeconds(g: Generation): number | null {
  const p = g.params;
  const dur = Number(p.duration ?? p.durationSec ?? 0) || 0;
  switch (g.tool) {
    case "flora":
      if (g.kind === "image") return 35;
      return Math.max(90, 60 + dur * 18); // vídeo: ~1,5 a 4 min conforme a duração
    case "heygen":
      return 240;
    case "heygen-traducao":
      return 600;
    case "montagem":
      if (p.formato === "sem-legenda") return Math.max(60, (Number(p.duracao) || 20) * 22); // LaMa na CPU: ~0,6 s por quadro
      if (p.formato === "batida") return 45;
      return 100 + (p.graficos ? 60 : 0) + (p.efeitos ? 20 : 0);
    case "editor":
      return 60;
    case "elevenlabs":
      return 15;
    default:
      return null;
  }
}

// Progresso estimado pelo tempo decorrido: sobe rápido no começo e desacelera, sem passar de 97% até ficar pronto.
export function estimateProgress(g: Generation, now = Date.now(), expected = expectedSeconds(g)) {
  if (!expected) return null;
  const elapsed = Math.max(0, (now - new Date(g.createdAt).getTime()) / 1000);
  const ratio = elapsed / expected;
  const pct = ratio < 1 ? ratio * 90 : 90 + 7 * (1 - Math.exp(-(ratio - 1) * 2));
  return { pct: Math.min(97, Math.round(pct)), remaining: Math.max(0, Math.round(expected - elapsed)), late: ratio >= 1 };
}

export const formatRemaining = (s: number) => (s >= 60 ? `~${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `~${s} s`);

// Organização que esta tela carregou (o layout grava em <html data-organizacao>). Vai em toda chamada: se outra aba
// trocou de organização, o servidor responde 409 e a tela recarrega já na organização nova, em vez de gravar numa o
// que era para a outra.
function comAOrganizacaoDaTela(init?: RequestInit): RequestInit | undefined {
  const org = typeof document === "undefined" ? undefined : document.documentElement.dataset.organizacao;
  if (!org) return init;
  const headers = new Headers(init?.headers);
  if (!headers.has("x-hub-organizacao")) headers.set("x-hub-organizacao", org);
  return { ...init, headers };
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, comAOrganizacaoDaTela(init));
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && (data as { codigo?: string }).codigo === "organizacao_trocada" && typeof window !== "undefined") window.location.reload();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}
