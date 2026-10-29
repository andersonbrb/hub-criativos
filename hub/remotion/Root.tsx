import { Composition } from "remotion";

import { Camada, type CamadaProps } from "./Camada";
import { Graficos, type GraficosProps } from "./Graficos";
import { ReelInstagram, type ReelInstagramProps } from "./ReelInstagram";

// Composições renderizadas pelo servidor (lib/server/motion.ts), 30 fps, duração = a do vídeo editado.
// Camada: a camada visual de todas as edições (1080 de largura, altura do formato). Graficos: só os gráficos (antiga).
// ReelInstagram: os textos do reel adaptado do Instagram, no tamanho e no fps do vídeo traduzido.
export function Root() {
  return (
    <>
    <Composition
      id="Camada"
      component={Camada}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={150}
      defaultProps={{ duracao: 5, altura: 1920 } satisfies CamadaProps}
      calculateMetadata={({ props }) => {
        const p = props as CamadaProps;
        return { durationInFrames: Math.max(1, Math.ceil(p.duracao * 30)), height: p.altura, width: p.largura ?? 1080 };
      }}
    />
    <Composition
      id="Graficos"
      component={Graficos}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={150}
      defaultProps={{ elementos: [], duracao: 5 } satisfies GraficosProps}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil((props as GraficosProps).duracao * 30)) })}
    />
    <Composition
      id="ReelInstagram"
      component={ReelInstagram}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={240}
      defaultProps={{
        width: 1080,
        height: 1920,
        fps: 30,
        durationInSeconds: 8,
        style: { font: "Montserrat", textColor: "#FFFFFF", highlightColor: "#F5C542", captionsPosition: "bottom" },
        hook: { text: "¿Sientes que nadie escucha tu oración?", endSecond: 2.5 },
        headline: { text: "Oración a San Benito", startSecond: 2.5, endSecond: 5 },
        cta: { text: "Comenta AMÉN 🙏", startSecond: 5 },
        captions: [],
        emphasis: [],
      } satisfies ReelInstagramProps}
      calculateMetadata={({ props }) => {
        const p = props as ReelInstagramProps;
        return { fps: p.fps, width: p.width, height: p.height, durationInFrames: Math.max(1, Math.ceil(p.durationInSeconds * p.fps)) };
      }}
    />
    </>
  );
}
