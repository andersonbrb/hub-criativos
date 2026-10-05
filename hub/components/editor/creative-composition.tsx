"use client";

import { AbsoluteFill, Html5Video, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ASS_TO_CSS, placeCaptions, placeClips, type CaptionStyle, type EditorProject } from "@/lib/editor";

// Prévia do projeto no Remotion Player. Segue as mesmas regras do render com ffmpeg (lib/server/editor.ts):
// clipes em sequência, vídeo encaixado no quadro com barras pretas, legenda ASS centrada em style.position.

export type CompositionProps = { project: EditorProject };

export function CreativeComposition({ project }: CompositionProps) {
  const { fps } = useVideoConfig();
  const { clips } = placeClips(project);
  const captions = project.captionsEnabled ? placeCaptions(project) : [];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clips.map((c) => {
        const src = project.sources[c.sourceId];
        const duration = Math.max(1, Math.round(c.duration * fps));
        return (
          <Sequence key={c.id} from={Math.round(c.offset * fps)} durationInFrames={duration} layout="none">
            <AbsoluteFill>
              <Html5Video
                src={src.url}
                trimBefore={Math.round(c.in * fps)}
                durationInFrames={duration}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {captions.map((c) => (
        <Sequence key={c.key} from={Math.round(c.start * fps)} durationInFrames={Math.max(1, Math.round((c.end - c.start) * fps))} layout="none">
          <Caption text={c.text} style={project.style} width={project.width} height={project.height} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function Caption({ text, style, width, height }: { text: string; style: CaptionStyle; width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = Math.min(width, height) / 1080;
  const pop = style.pop ? 0.82 + 0.18 * Math.min(1, spring({ frame, fps, durationInFrames: Math.round(0.14 * fps), config: { damping: 200 } })) : 1;
  const parts = (style.uppercase ? text.toUpperCase() : text).split(/(\*[^*]+\*)/g).filter(Boolean);
  const outline = style.outline * scale;

  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.08,
        right: width * 0.08,
        top: (height * style.position) / 100,
        transform: `translateY(-50%) scale(${pop})`,
        textAlign: "center",
        fontFamily: `"${style.font}", sans-serif`,
        fontWeight: 900,
        fontSize: style.size * scale * ASS_TO_CSS,
        lineHeight: 1.15,
        color: style.color,
        whiteSpace: "pre-wrap",
      }}
    >
      <span
        style={
          style.box
            ? { background: "rgba(0,0,0,.75)", padding: `${0.1 * style.size * scale}px ${Math.max(outline, 14 * scale)}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
            : { WebkitTextStroke: `${outline * 2}px #000`, paintOrder: "stroke fill" }
        }
      >
        {parts.map((p, i) => (p.startsWith("*") ? <span key={i} style={{ color: style.highlight }}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>))}
      </span>
    </div>
  );
}
