import { createTikTokStyleCaptions, type TikTokPage } from '@remotion/captions';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadLora } from '@remotion/google-fonts/Lora';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo } from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
// Camada do reel do Instagram (features/instagram): gancho, headline, legendas palavra a palavra e cartão de CTA do
// Padrão de Edição, com fundo transparente. Como a Camada das outras edições, o Remotion desenha os quadros em PNG e o
// ffmpeg do sistema sobrepõe ao vídeo traduzido (lib/server/motion.ts, sobreporComposicao).

/** O plano de edição do diretor (features/instagram/servidor/infrastructure/video/edit-plan.ts), sem o vídeo. */
export type ReelInstagramProps = {
  width: number;
  height: number;
  fps: number;
  durationInSeconds: number;
  style: {
    font: 'Montserrat' | 'Poppins' | 'Inter' | 'Lora' | 'Playfair Display';
    textColor: string;
    highlightColor: string;
    captionsPosition: 'bottom' | 'middle';
  };
  hook: { text: string; endSecond: number } | null;
  headline: { text: string; startSecond: number; endSecond: number } | null;
  cta: { text: string; startSecond: number } | null;
  captions: { text: string; startMs: number; endMs: number }[];
  emphasis: string[];
};

type EditPlan = ReelInstagramProps;

const FONT_LOADERS = {
  Montserrat: () => loadMontserrat('normal', { weights: ['800'], subsets: ['latin', 'latin-ext'] }),
  Poppins: () => loadPoppins('normal', { weights: ['800'], subsets: ['latin', 'latin-ext'] }),
  Inter: () => loadInter('normal', { weights: ['800'], subsets: ['latin', 'latin-ext'] }),
  Lora: () => loadLora('normal', { weights: ['700'], subsets: ['latin', 'latin-ext'] }),
  'Playfair Display': () =>
    loadPlayfair('normal', { weights: ['800'], subsets: ['latin', 'latin-ext'] }),
} as const;

const loaded = new Map<string, string>();
function fontFamily(font: EditPlan['style']['font']): string {
  let family = loaded.get(font);
  if (!family) {
    family = FONT_LOADERS[font]().fontFamily;
    loaded.set(font, family);
  }
  return family;
}

/** Contorno escuro que mantém o texto legível sobre qualquer imagem. */
const outline = (size: number): CSSProperties => ({
  WebkitTextStroke: `${size}px rgba(0,0,0,0.85)`,
  paintOrder: 'stroke fill',
  textShadow: `0 ${size}px ${size * 3}px rgba(0,0,0,0.55)`,
});

const normalize = (word: string) =>
  word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

function PopIn({ children, style }: { children: ReactNode; style: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });
  return (
    <div style={{ ...style, transform: `scale(${0.85 + 0.15 * scale})`, opacity: scale }}>
      {children}
    </div>
  );
}

function Hook({ text, plan, family }: { text: string; plan: EditPlan; family: string }) {
  const unit = plan.width / 1080;
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: plan.height * 0.16 }}>
      <PopIn
        style={{
          maxWidth: '86%',
          padding: `${18 * unit}px ${28 * unit}px`,
          borderRadius: 24 * unit,
          background: 'rgba(0,0,0,0.55)',
          color: plan.style.textColor,
          fontFamily: family,
          fontSize: 76 * unit,
          lineHeight: 1.12,
          textAlign: 'center',
        }}
      >
        {text}
      </PopIn>
    </AbsoluteFill>
  );
}

function Headline({ text, plan, family }: { text: string; plan: EditPlan; family: string }) {
  const unit = plan.width / 1080;
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: plan.height * 0.07 }}>
      <div
        style={{
          maxWidth: '88%',
          padding: `${10 * unit}px ${22 * unit}px`,
          borderRadius: 999,
          background: 'rgba(0,0,0,0.5)',
          color: plan.style.textColor,
          fontFamily: family,
          fontSize: 46 * unit,
          lineHeight: 1.15,
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

function Cta({ text, plan, family }: { text: string; plan: EditPlan; family: string }) {
  const unit = plan.width / 1080;
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: plan.height * 0.3 }}>
      <PopIn
        style={{
          maxWidth: '84%',
          padding: `${22 * unit}px ${34 * unit}px`,
          borderRadius: 28 * unit,
          background: plan.style.highlightColor,
          color: '#111111',
          fontFamily: family,
          fontSize: 68 * unit,
          lineHeight: 1.12,
          textAlign: 'center',
          boxShadow: `0 ${12 * unit}px ${40 * unit}px rgba(0,0,0,0.45)`,
        }}
      >
        {text}
      </PopIn>
    </AbsoluteFill>
  );
}

function CaptionPage({
  page,
  plan,
  family,
  emphasis,
}: {
  page: TikTokPage;
  plan: EditPlan;
  family: string;
  emphasis: Set<string>;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const unit = plan.width / 1080;
  const nowMs = page.startMs + (frame / fps) * 1000;
  const position: CSSProperties =
    plan.style.captionsPosition === 'bottom'
      ? { justifyContent: 'flex-end', paddingBottom: plan.height * 0.17 }
      : { justifyContent: 'center', paddingTop: plan.height * 0.18 };
  return (
    <AbsoluteFill style={{ alignItems: 'center', ...position }}>
      <div
        style={{
          maxWidth: '86%',
          fontFamily: family,
          fontSize: 82 * unit,
          lineHeight: 1.1,
          textAlign: 'center',
          textTransform: 'uppercase',
          whiteSpace: 'pre-wrap',
          ...outline(10 * unit),
        }}
      >
        {page.tokens.map((token) => {
          const active = token.fromMs <= nowMs && nowMs < token.toMs;
          const highlighted = emphasis.has(normalize(token.text));
          return (
            <span
              key={token.fromMs}
              style={{
                color: active || highlighted ? plan.style.highlightColor : plan.style.textColor,
                display: 'inline-block',
                transform: active ? `scale(1.06)` : undefined,
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** Os textos do reel adaptado (gancho, headline, legendas e CTA), sobre fundo transparente. */
export function ReelInstagram(plan: EditPlan) {
  const { fps, durationInFrames } = useVideoConfig();
  const family = fontFamily(plan.style.font);
  const emphasis = useMemo(() => new Set(plan.emphasis.map(normalize)), [plan.emphasis]);
  const pages = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: plan.captions.map((word, index) => ({
          text: index === 0 ? word.text : ` ${word.text}`,
          startMs: word.startMs,
          endMs: word.endMs,
          timestampMs: word.startMs,
          confidence: null,
        })),
        combineTokensWithinMilliseconds: 900,
      }).pages,
    [plan.captions],
  );
  const toFrame = (seconds: number) => Math.max(0, Math.round(seconds * fps));

  return (
    <AbsoluteFill>

      {pages.map((page, index) => {
        const from = toFrame(page.startMs / 1000);
        const next = pages[index + 1];
        const until = next ? toFrame(next.startMs / 1000) : durationInFrames;
        if (until <= from) return null;
        return (
          <Sequence key={page.startMs} from={from} durationInFrames={until - from} layout="none">
            <CaptionPage page={page} plan={plan} family={family} emphasis={emphasis} />
          </Sequence>
        );
      })}

      {plan.headline && plan.headline.endSecond > plan.headline.startSecond ? (
        <Sequence
          from={toFrame(plan.headline.startSecond)}
          durationInFrames={Math.max(
            1,
            toFrame(plan.headline.endSecond - plan.headline.startSecond),
          )}
        >
          <Headline text={plan.headline.text} plan={plan} family={family} />
        </Sequence>
      ) : null}

      {plan.hook ? (
        <Sequence from={0} durationInFrames={Math.max(1, toFrame(plan.hook.endSecond))}>
          <Hook text={plan.hook.text} plan={plan} family={family} />
        </Sequence>
      ) : null}

      {plan.cta ? (
        <Sequence from={toFrame(plan.cta.startSecond)}>
          <Cta text={plan.cta.text} plan={plan} family={family} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
}
