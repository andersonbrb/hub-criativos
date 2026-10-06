import { Composition } from "remotion";

import { Graficos, type GraficosProps } from "./Graficos";

// Composição renderizada pela edição final (lib/server/motion.ts): 1080×1920, 30 fps, duração = a do vídeo editado.
export function Root() {
  return (
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
  );
}
