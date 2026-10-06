import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Gráficos animados da edição final (renderizados com fundo transparente e sobrepostos ao vídeo pelo ffmpeg).
// Áreas: topo (título, contador), meio (destaque, lista) e acima da legenda (CTA); a legenda fica no rodapé.

export type Grafico = {
  tipo: "titulo" | "destaque" | "lista" | "contador" | "cta";
  texto: string;
  sub?: string;
  itens?: string[];
  inicio: number; // s
  duracao: number; // s
  cor?: string; // destaque (#RRGGBB)
};

export type GraficosProps = { elementos: Grafico[]; duracao: number };

const FONT = "'Arial Black', 'Segoe UI Black', Impact, sans-serif";
const sombra = "0 6px 24px rgba(0,0,0,0.35)";

// Saída suave nos últimos 0,25s de cada gráfico.
function useSaida(duracao: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.round(duracao * fps);
  return interpolate(frame, [total - 8, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function Titulo({ g }: { g: Grafico }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const saida = useSaida(g.duracao);
  const palavras = g.texto.toUpperCase().split(/\s+/).filter(Boolean);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 230, opacity: saida }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 18px", maxWidth: 900, padding: "0 40px" }}>
        {palavras.map((p, i) => {
          const s = spring({ frame: frame - i * 3, fps, config: { damping: 14, stiffness: 180 } });
          return (
            <span
              key={i}
              style={{
                fontFamily: FONT,
                fontSize: 92,
                lineHeight: 1.05,
                color: "white",
                background: i === palavras.length - 1 ? g.cor ?? "#22FF66" : "rgba(10,10,10,0.82)",
                padding: "6px 18px",
                transform: `translateY(${(1 - s) * 60}px)`,
                opacity: s,
                boxShadow: sombra,
                ...(i === palavras.length - 1 ? { color: "#0A0A0A" } : {}),
              }}
            >
              {p}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Destaque({ g }: { g: Grafico }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const saida = useSaida(g.duracao);
  const s = spring({ frame, fps, config: { damping: 9, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: saida, top: -260 }}>
      <div
        style={{
          transform: `scale(${0.3 + s * 0.7}) rotate(${-4 + (1 - s) * -10}deg)`,
          background: g.cor ?? "#22FF66",
          color: "#0A0A0A",
          fontFamily: FONT,
          padding: "26px 54px",
          textAlign: "center",
          boxShadow: sombra,
          border: "6px solid #0A0A0A",
        }}
      >
        <div style={{ fontSize: 130, lineHeight: 1 }}>{g.texto.toUpperCase()}</div>
        {g.sub && <div style={{ fontSize: 44, marginTop: 10, letterSpacing: 1 }}>{g.sub.toUpperCase()}</div>}
      </div>
    </AbsoluteFill>
  );
}

function Lista({ g }: { g: Grafico }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const saida = useSaida(g.duracao);
  const itens = g.itens?.length ? g.itens : g.texto.split(/\s*[;|]\s*/).filter(Boolean);
  const passo = Math.max(6, Math.floor((g.duracao * fps * 0.6) / Math.max(1, itens.length)));
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 80, top: -200, opacity: saida }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {itens.map((t, i) => {
          const s = spring({ frame: frame - i * passo, fps, config: { damping: 15, stiffness: 170 } });
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, transform: `translateX(${(1 - s) * -120}px)`, opacity: s }}>
              <span
                style={{
                  width: 74,
                  height: 74,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: g.cor ?? "#22FF66",
                  color: "#0A0A0A",
                  fontFamily: FONT,
                  fontSize: 52,
                  boxShadow: sombra,
                }}
              >
                <svg width="48" height="48" viewBox="0 0 24 24">
                  <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#0A0A0A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span style={{ fontFamily: FONT, fontSize: 62, color: "white", background: "rgba(10,10,10,0.82)", padding: "6px 18px", boxShadow: sombra }}>
                {t.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Contador({ g }: { g: Grafico }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const saida = useSaida(g.duracao);
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 160 } });
  // Começa em 09:59 (ou no "sub", ex.: "04:59") e desce um segundo por segundo.
  const [m0, s0] = (g.sub?.match(/^(\d{1,2}):(\d{2})$/) ? g.sub : "09:59").split(":").map(Number);
  const restante = Math.max(0, m0 * 60 + s0 - Math.floor(frame / fps));
  const mm = String(Math.floor(restante / 60)).padStart(2, "0");
  const ss = String(restante % 60).padStart(2, "0");
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 220, opacity: saida }}>
      <div style={{ transform: `scale(${0.6 + 0.4 * s})`, textAlign: "center", background: "rgba(10,10,10,0.88)", padding: "18px 40px", boxShadow: sombra }}>
        <div style={{ fontFamily: FONT, fontSize: 46, color: "white" }}>{(g.texto || "Oferta acaba em").toUpperCase()}</div>
        <div style={{ fontFamily: FONT, fontSize: 120, color: g.cor ?? "#22FF66", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
          {mm}:{ss}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Cta({ g }: { g: Grafico }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const saida = useSaida(g.duracao);
  const s = spring({ frame, fps, config: { damping: 11, stiffness: 150 } });
  const pulso = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 2.4);
  const seta = interpolate(Math.sin((frame / fps) * Math.PI * 2.4), [-1, 1], [0, 26], { easing: Easing.inOut(Easing.ease) });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 520, opacity: saida }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, transform: `translateY(${(1 - s) * 140}px)`, opacity: s }}>
        <div
          style={{
            transform: `scale(${pulso})`,
            background: g.cor ?? "#22FF66",
            color: "#0A0A0A",
            fontFamily: FONT,
            fontSize: 58,
            lineHeight: 1.1,
            textAlign: "center",
            maxWidth: 880,
            padding: "22px 50px",
            borderRadius: 60,
            boxShadow: sombra,
            border: "5px solid #0A0A0A",
          }}
        >
          {(g.texto || "Toque em Saiba mais").toUpperCase()}
        </div>
        {/* Seta desenhada (a fonte não garante o caractere ↓) */}
        <svg width="90" height="90" viewBox="0 0 24 24" style={{ transform: `translateY(${seta}px)`, filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.45))" }}>
          <path d="M12 3v14m0 0l-6-6m6 6l6-6" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </AbsoluteFill>
  );
}

const COMPONENTES = { titulo: Titulo, destaque: Destaque, lista: Lista, contador: Contador, cta: Cta };

export function Graficos({ elementos }: GraficosProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {elementos.map((g, i) => {
        const C = COMPONENTES[g.tipo];
        if (!C) return null;
        return (
          <Sequence key={i} from={Math.round(g.inicio * fps)} durationInFrames={Math.max(1, Math.round(g.duracao * fps))} layout="none">
            <C g={g} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
