import { useEffect, useState, type ReactNode } from "react";
import { AbsoluteFill, continueRender, delayRender, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { Graficos, type Grafico } from "./Graficos";

// Camada visual de TODAS as edições de criativo (regra do dono, 27/10/2026: o Remotion é o motor visual principal).
// Desenha, com fundo transparente, o que fica por cima do vídeo: legenda (edição final e editor), palavras gigantes
// (edição na batida), faixa de aviso, barra de progresso, setas do CTA e os gráficos animados. O ffmpeg do sistema só
// sobrepõe esta camada ao vídeo cortado (lib/server/motion.ts). As medidas são as do quadro de 1080 de largura.

// Fontes de scripts/fonts (o render roda com --public-dir apontando para lá).
const FONTES: [string, string, number][] = [
  ["Poppins", "Poppins-Bold.ttf", 700],
  ["Anton", "Anton-Regular.ttf", 400],
  ["Montserrat", "Montserrat-Bold.ttf", 700],
  ["Montserrat", "Montserrat-Regular.ttf", 400],
];

let fontesProntas: Promise<void> | null = null;
function carregarFontes() {
  fontesProntas ??= Promise.all(
    FONTES.map(async ([familia, arquivo, peso]) => {
      const f = new FontFace(familia, `url(${staticFile(arquivo)})`, { weight: String(peso) });
      await f.load();
      document.fonts.add(f);
    }),
  ).then(() => undefined);
  return fontesProntas;
}

export type Palavra = { t: string; s: number; destaque?: boolean; quebra?: boolean };
export type BlocoDeLegenda = { ini: number; fim: number; palavras: Palavra[]; escalaX?: number };

export type Legenda = {
  fonte: string;
  // Tamanho no padrão ASS (o mesmo número do kit do Sávio); vira px de CSS aqui.
  tamanho: number;
  peso: number;
  y: number; // centro da legenda (px)
  cor: string;
  destaque: string;
  contorno: number; // px do contorno ASS
  sombra?: number;
  caixa?: boolean;
  pop: "savio" | "suave" | "nenhum";
  modo: "bloco" | "palavra";
  margem?: number; // px de cada lado
  blocos: BlocoDeLegenda[];
};

// Edição na batida: até 2 linhas de palavras gigantes por cena, com "slam" na entrada ou pulsando na batida (CTA).
export type Slam = { ini: number; fim: number; linhas: { texto: string; px: number; y: number; cor: string }[]; pulsos?: number[] };

export type CamadaProps = {
  duracao: number;
  altura: number;
  largura?: number; // padrão 1080 (o editor pode exportar em outro tamanho)
  legenda?: Legenda | null;
  slams?: Slam[];
  aviso?: { texto: string; topo: number; px: number } | null;
  barra?: { y: number; cor: string } | null;
  cta?: { inicio: number; y: number; escala: number; centros: [number, number] } | null;
  elementos?: Grafico[];
};

// O ASS mede a fonte pela altura da linha; o CSS pelo "em". Mesma conversão da prévia do editor (lib/editor.ts).
const ASS_TO_CSS = 1 / 1.15;

export function Camada(props: CamadaProps) {
  // Espera as fontes antes de desenhar o primeiro quadro (sem elas a legenda sairia na fonte errada).
  const [handle] = useState(() => delayRender("fontes"));
  useEffect(() => {
    carregarFontes().then(
      () => continueRender(handle),
      () => continueRender(handle),
    );
  }, [handle]);
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {props.aviso ? <Aviso {...props.aviso} altura={props.altura} /> : null}
      {props.elementos?.length ? <Graficos elementos={props.elementos} duracao={props.duracao} /> : null}
      {props.legenda ? <Legendas legenda={props.legenda} /> : null}
      {(props.slams ?? []).map((s, i) => (
        <Trecho key={`s${i}`} ini={s.ini} fim={s.fim}>
          <SlamNaTela slam={s} />
        </Trecho>
      ))}
      {props.barra ? <Barra {...props.barra} duracao={props.duracao} /> : null}
      {props.cta ? <Setas {...props.cta} duracao={props.duracao} /> : null}
    </AbsoluteFill>
  );
}

function Trecho({ ini, fim, children }: { ini: number; fim: number; children: ReactNode }) {
  const { fps } = useVideoConfig();
  const de = Math.round(ini * fps);
  return (
    <Sequence from={de} durationInFrames={Math.max(1, Math.round(fim * fps) - de)} layout="none">
      {children}
    </Sequence>
  );
}

function Legendas({ legenda }: { legenda: Legenda }) {
  return (
    <>
      {legenda.blocos.map((b, i) => (
        <Trecho key={i} ini={b.ini} fim={b.fim}>
          <Bloco bloco={b} legenda={legenda} />
        </Trecho>
      ))}
    </>
  );
}

// Escala do "pop" de entrada. savio: 0,82 → 1,06 em 80 ms → 1,00 em 150 ms (o mesmo do kit, antes no ASS).
function escalaDoPop(ms: number, pop: Legenda["pop"]) {
  if (pop === "nenhum") return 1;
  if (pop === "suave") return ms >= 140 ? 1 : 0.82 + (0.18 * ms) / 140;
  if (ms <= 80) return 0.82 + (0.24 * ms) / 80;
  if (ms <= 150) return 1.06 - (0.06 * (ms - 80)) / 70;
  return 1;
}

function Bloco({ bloco, legenda }: { bloco: BlocoDeLegenda; legenda: Legenda }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const agora = bloco.ini + frame / fps;
  const k = escalaDoPop(ms, legenda.pop);
  const sx = bloco.escalaX ?? 1;
  const margem = legenda.margem ?? 40;
  const palavras = (contorno: boolean) =>
    bloco.palavras.map((p, i) => (
      <span key={i}>
        {i > 0 && !bloco.palavras[i - 1].quebra ? " " : ""}
        <span style={{ color: contorno ? undefined : p.destaque ? legenda.destaque : undefined, opacity: legenda.modo === "palavra" && i > 0 && agora < p.s ? 0 : 1 }}>{p.t}</span>
        {p.quebra ? "\n" : ""}
      </span>
    ));
  return (
    <div
      style={{
        position: "absolute",
        left: margem,
        width: width - 2 * margem,
        top: legenda.y,
        transform: `translateY(-50%) scale(${k * sx}, ${k})`,
        textAlign: "center",
        fontFamily: `"${legenda.fonte}", "Arial Black", sans-serif`,
        fontWeight: legenda.peso,
        fontSize: legenda.tamanho * ASS_TO_CSS,
        lineHeight: 1.12,
        color: legenda.cor,
        whiteSpace: "pre-wrap",
      }}
    >
      {legenda.caixa ? (
        <span
          style={{ background: "rgba(0,0,0,.75)", padding: `${0.1 * legenda.tamanho}px ${Math.max(legenda.contorno, 14)}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
        >
          {palavras(false)}
        </span>
      ) : (
        // Contorno por baixo e letra por cima (como o ASS): o contorno de uma letra nunca risca a vizinha.
        <span style={{ position: "relative", display: "inline-block" }}>
          <span
            aria-hidden
            style={{
              color: "#000",
              WebkitTextStroke: `${legenda.contorno * 2}px #000`,
              textShadow: legenda.sombra ? `${legenda.sombra}px ${legenda.sombra}px 0 rgba(0,0,0,.6)` : undefined,
            }}
          >
            {palavras(true)}
          </span>
          <span style={{ position: "absolute", inset: 0 }}>{palavras(false)}</span>
        </span>
      )}
    </div>
  );
}

function SlamNaTela({ slam }: { slam: Slam }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const agora = slam.ini + frame / fps;
  // Entrada: 1,5x → 1x em 110 ms. CTA: pulsa 1,08x em cada batida.
  let k = slam.pulsos?.length ? 1 : ms < 110 ? 1.5 - (0.5 * ms) / 110 : 1;
  for (const h of slam.pulsos ?? []) {
    const d = (agora - h) * 1000;
    if (d >= 0 && d < 60) k = 1 + (0.08 * d) / 60;
    else if (d >= 60 && d < 280) k = 1.08 - (0.08 * (d - 60)) / 220;
  }
  return (
    <>
      {slam.linhas.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: l.y,
            transform: `translateY(-50%) scale(${i === slam.linhas.length - 1 || slam.linhas.length === 1 ? k : 1})`,
            textAlign: "center",
            fontFamily: '"Anton", Impact, sans-serif',
            fontSize: l.px * ASS_TO_CSS,
            lineHeight: 1,
            color: l.cor,
            textShadow: "9px 9px 0 rgba(0,0,0,.41)",
            whiteSpace: "nowrap",
          }}
        >
          {l.texto}
        </div>
      ))}
    </>
  );
}

function Aviso({ texto, topo, px, altura }: { texto: string; topo: number; px: number; altura: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: topo,
        height: altura - topo,
        background: "rgba(0,0,0,.985)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 40px",
        textAlign: "center",
        fontFamily: '"Poppins", sans-serif',
        fontWeight: 700,
        fontSize: px * ASS_TO_CSS,
        color: "white",
      }}
    >
      {texto}
    </div>
  );
}

function Barra({ y, cor, duracao }: { y: number; cor: string; duracao: number }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  return <div style={{ position: "absolute", left: 0, top: y, height: 14, width: (width * frame) / fps / Math.max(0.01, duracao), background: cor }} />;
}

// As 2 setas vermelhas do Sávio (sem botão): entram no CTA e ficam até o fim, subindo e descendo 20 px a 1,5 Hz.
function Setas({ inicio, y, escala, centros, duracao }: { inicio: number; y: number; escala: number; centros: [number, number]; duracao: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < inicio || t > duracao) return null;
  const s = Math.max(40, Math.round(170 * escala));
  const dy = 20 * Math.sin(2 * Math.PI * 1.5 * (t - inicio));
  // Haste no terço de cima + ponta embaixo (o mesmo desenho do script antigo), contorno preto.
  const seta = (
    <svg width={s} height={s} viewBox="0 0 100 100">
      <path d="M33 4 H67 V45 H96 L50 96 L4 45 H33 Z" fill="rgb(225,20,20)" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
  return (
    <>
      {centros.map((c, i) => (
        <div key={i} style={{ position: "absolute", left: c - s / 2, top: y + dy }}>
          {seta}
        </div>
      ))}
    </>
  );
}
