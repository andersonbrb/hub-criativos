// Modelo do editor de vídeo, compartilhado entre a tela (prévia com Remotion) e o servidor (render com ffmpeg).
// Tempos em segundos. Clipes e legendas guardam o tempo da MÍDIA DE ORIGEM; o tempo da timeline é calculado.
// Assim, cortar, dividir ou reordenar clipes leva as legendas junto, sem precisar retimar.

export type EditorSource = {
  id: string; // id da geração do hub
  label: string;
  url: string; // /api/media/<arquivo>
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type EditorClip = { id: string; sourceId: string; in: number; out: number };

// text aceita *destaque* (palavra na cor de destaque).
export type EditorCaption = { id: string; sourceId: string; start: number; end: number; text: string };

export const CAPTION_FONTS = ["Arial Black", "Impact", "Segoe UI Black", "Verdana"] as const;

export type CaptionStyle = {
  font: (typeof CAPTION_FONTS)[number];
  size: number; // tamanho ASS numa saída de 1080 px de largura
  position: number; // centro da legenda, em % da altura a partir do topo
  color: string; // #RRGGBB
  highlight: string;
  outline: number; // contorno em px (ou margem da caixa)
  box: boolean; // caixa escura atrás do texto
  uppercase: boolean;
  pop: boolean; // animação de entrada
};

export const DEFAULT_STYLE: CaptionStyle = {
  font: "Arial Black",
  size: 96,
  position: 70,
  color: "#FFFFFF",
  highlight: "#FFD23F",
  outline: 6,
  box: false,
  uppercase: false,
  pop: true,
};

export type EditorProject = {
  id: string;
  title: string;
  originId: string; // geração que abriu o projeto
  width: number;
  height: number;
  fps: number;
  sources: Record<string, EditorSource>;
  clips: EditorClip[];
  captions: EditorCaption[];
  captionsEnabled: boolean;
  style: CaptionStyle;
  exports: string[]; // ids das gerações exportadas
  createdAt: string;
  updatedAt: string;
};

export type EditorProjectSummary = Pick<EditorProject, "id" | "title" | "originId" | "updatedAt"> & { clips: number };

export type PlacedClip = EditorClip & { offset: number; duration: number };

export function placeClips(project: Pick<EditorProject, "clips">): { clips: PlacedClip[]; total: number } {
  let offset = 0;
  const clips = project.clips.map((c) => {
    const duration = Math.max(0, c.out - c.in);
    const placed = { ...c, offset, duration };
    offset += duration;
    return placed;
  });
  return { clips, total: offset };
}

export type PlacedCaption = { key: string; captionId: string; start: number; end: number; text: string };

// Legendas no tempo da timeline. Uma legenda que atravessa um corte vira pedaços; a que cai num trecho cortado some.
export function placeCaptions(project: Pick<EditorProject, "clips" | "captions">): PlacedCaption[] {
  const out: PlacedCaption[] = [];
  for (const clip of placeClips(project).clips) {
    for (const cap of project.captions) {
      if (cap.sourceId !== clip.sourceId) continue;
      const s = Math.max(cap.start, clip.in);
      const e = Math.min(cap.end, clip.out);
      if (e - s < 0.05) continue;
      out.push({ key: `${clip.id}:${cap.id}`, captionId: cap.id, start: clip.offset + s - clip.in, end: clip.offset + e - clip.in, text: cap.text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Clipe sob o tempo t da timeline e o tempo correspondente na origem.
export function locate(project: Pick<EditorProject, "clips">, t: number): { clip: PlacedClip; sourceTime: number } | null {
  const { clips } = placeClips(project);
  const clip = clips.find((c) => t >= c.offset && t < c.offset + c.duration) ?? clips.at(-1);
  if (!clip) return null;
  return { clip, sourceTime: Math.min(clip.out, Math.max(clip.in, clip.in + t - clip.offset)) };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

// Divide o clipe sob o playhead em dois (base dos jump cuts: dividir e apagar o trecho).
export function splitAt(project: EditorProject, t: number): EditorProject {
  const hit = locate(project, t);
  if (!hit || hit.sourceTime - hit.clip.in < 0.1 || hit.clip.out - hit.sourceTime < 0.1) return project;
  const clips = project.clips.flatMap((c) =>
    c.id !== hit.clip.id
      ? [c]
      : [
          { ...c, out: hit.sourceTime },
          { ...c, id: newId(), in: hit.sourceTime },
        ],
  );
  return { ...project, clips };
}

// Agrupa palavras com tempo em legendas curtas (quebra em pontuação, pausa longa ou limite de palavras).
export function wordsToCaptions(
  words: { text: string; start: number; end: number }[],
  sourceId: string,
  perCaption: number,
): EditorCaption[] {
  const captions: EditorCaption[] = [];
  let group: typeof words = [];
  const flush = () => {
    if (!group.length) return;
    captions.push({
      id: newId(),
      sourceId,
      start: group[0].start,
      end: group.at(-1)!.end,
      text: group.map((w) => w.text).join(" "),
    });
    group = [];
  };
  for (const w of words) {
    const prev = group.at(-1);
    if (prev && w.start - prev.end > 0.6) flush();
    group.push(w);
    if (group.length >= perCaption || /[.!?…,;:]$/.test(w.text)) flush();
  }
  flush();
  // Fecha buracos curtos para a legenda não piscar entre frases.
  for (let i = 0; i < captions.length - 1; i++) {
    if (captions[i + 1].start - captions[i].end < 0.25) captions[i].end = captions[i + 1].start;
  }
  return captions;
}

// Proporção da fonte ASS (altura da linha) para o font-size do CSS, para a prévia bater com o render.
export const ASS_TO_CSS = 1 / 1.15;

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
