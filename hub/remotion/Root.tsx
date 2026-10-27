import { Composition } from "remotion";

import { Camada, type CamadaProps } from "./Camada";
import { Graficos, type GraficosProps } from "./Graficos";

// Composições renderizadas pelo servidor (lib/server/motion.ts), 30 fps, duração = a do vídeo editado.
// Camada: a camada visual de todas as edições (1080 de largura, altura do formato). Graficos: só os gráficos (antiga).
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
    </>
  );
}
