import type { ContentFormat } from '@sbs/shared-kernel';
import type { FeedPost, ReferenceFeed } from '../../application';
import type { PostMetricsProps } from '../../domain';

interface SeedPost {
  externalId: string;
  shortcode: string;
  format: ContentFormat;
  hoursAgo: number;
  caption: string;
  metrics: PostMetricsProps;
  /** Reels: vídeo de exemplo. Carrosséis: quantidade de slides. */
  video?: string;
  slides?: number;
}

const SAMPLE_VIDEOS = 'https://storage.googleapis.com/gtv-videos-bucket/sample';

/**
 * Posts de uma página católica devocional brasileira. As métricas são variadas de propósito
 * para que o ranking tenha vencedores claros, posts recentes demais e formatos não adaptáveis.
 */
const SEED: readonly SeedPost[] = [
  {
    externalId: '18047213958201301',
    shortcode: 'DBx7kQ2sR1a',
    format: 'reel',
    hoursAgo: 6,
    video: 'ForBiggerBlazes.mp4',
    caption:
      'Oração de São Bento para proteção do lar 🙏\n\nReze com fé antes de dormir e entregue sua casa e sua família nas mãos de Deus.\n\nComente "AMÉM" se você recebe essa bênção.\n\n#saobento #oracao #protecao #fe',
    metrics: {
      views: 180_000,
      reach: 120_000,
      likes: 9_800,
      comments: 640,
      saves: 4_100,
      shares: 5_200,
    },
  },
  {
    externalId: '18047213958201302',
    shortcode: 'DBv3pLm9T2b',
    format: 'carousel',
    hoursAgo: 50,
    slides: 5,
    caption:
      '7 orações poderosas para começar o dia ☀️\n\nArraste para o lado e salve para rezar todas as manhãs.\n\n#oracaodamanha #fe #catolicos #deus',
    metrics: {
      views: 64_000,
      reach: 41_000,
      likes: 5_200,
      comments: 310,
      saves: 6_800,
      shares: 2_900,
    },
  },
  {
    externalId: '18047213958201303',
    shortcode: 'DBt8wXc4U3c',
    format: 'reel',
    hoursAgo: 74,
    video: 'ForBiggerEscapes.mp4',
    caption:
      'Medalha de São Bento: o significado de cada letra ✝️\n\nC.S.P.B. — Crux Sancti Patris Benedicti. Você sabia o que a sua medalha diz?\n\n#medalhadesaobento #saobento #catolicismo',
    metrics: {
      views: 95_000,
      reach: 60_000,
      likes: 6_100,
      comments: 420,
      saves: 3_300,
      shares: 2_700,
    },
  },
  {
    externalId: '18047213958201304',
    shortcode: 'DBr2hNk7V4d',
    format: 'image',
    hoursAgo: 98,
    caption:
      'Bom dia com fé! Que Deus abençoe o seu dia e guarde a sua casa. 💛\n\n#bomdia #fe #deusnocomando',
    metrics: { views: 22_000, reach: 18_000, likes: 2_100, comments: 150, saves: 120, shares: 300 },
  },
  {
    externalId: '18047213958201305',
    shortcode: 'DBp6jRt1W5e',
    format: 'carousel',
    hoursAgo: 122,
    slides: 6,
    caption:
      'Como consagrar sua casa a São Bento (passo a passo) 🏠\n\n1. Benza cada cômodo\n2. Coloque a medalha na porta de entrada\n3. Reze a oração de consagração em família\n\nSalve este post para fazer no fim de semana.\n\n#consagracao #saobento #protecaodolar',
    metrics: {
      views: 48_000,
      reach: 33_000,
      likes: 3_900,
      comments: 280,
      saves: 4_700,
      shares: 2_100,
    },
  },
  {
    externalId: '18047213958201306',
    shortcode: 'DBn1dYf5X6f',
    format: 'reel',
    hoursAgo: 146,
    video: 'ForBiggerFun.mp4',
    caption:
      'Salmo 91 narrado: "Aquele que habita no esconderijo do Altíssimo…" 📖\n\nOuça até o final e compartilhe com quem precisa de proteção.\n\n#salmo91 #biblia #oracao',
    metrics: {
      views: 70_000,
      reach: 52_000,
      likes: 3_500,
      comments: 260,
      saves: 1_300,
      shares: 900,
    },
  },
  {
    externalId: '18047213958201307',
    shortcode: 'DBl5gHs8Y7g',
    format: 'reel',
    hoursAgo: 194,
    video: 'ForBiggerJoyrides.mp4',
    caption:
      'Oração contra inveja e mau-olhado 🛡️\n\nSão Bento, afastai de nós todo o mal. Reze com o coração aberto e marque alguém que precisa.\n\n#oracaocontrainveja #saobento #protecao',
    metrics: {
      views: 130_000,
      reach: 88_000,
      likes: 8_800,
      comments: 1_900,
      saves: 5_200,
      shares: 6_100,
    },
  },
  {
    externalId: '18047213958201308',
    shortcode: 'DBj9kVb2Z8h',
    format: 'carousel',
    hoursAgo: 218,
    slides: 3,
    caption:
      'Terço da Misericórdia: como rezar em 3 passos 📿\n\nÀs 15h, a hora da misericórdia, una-se a nós em oração.\n\n#tercodamisericordia #jesusmisericordioso #fe',
    metrics: {
      views: 30_000,
      reach: 21_000,
      likes: 1_800,
      comments: 90,
      saves: 1_500,
      shares: 400,
    },
  },
  {
    externalId: '18047213958201309',
    shortcode: 'DBh3mCn6A9i',
    format: 'reel',
    hoursAgo: 266,
    video: 'ForBiggerMeltdowns.mp4',
    caption:
      'Testemunho: a medalha que protegeu minha família 🙌\n\nA dona Maria conta como a fé em São Bento a sustentou no momento mais difícil.\n\n#testemunho #saobento #milagre',
    metrics: { views: 52_000, reach: 39_000, likes: 2_900, comments: 540, saves: 600, shares: 700 },
  },
  {
    externalId: '18047213958201310',
    shortcode: 'DBf7qDp9B0j',
    format: 'carousel',
    hoursAgo: 314,
    slides: 7,
    caption:
      'Novena de São Bento — do 1º ao 9º dia 🕯️\n\nUma oração por dia, durante nove dias, pelas suas intenções. Salve para não perder nenhum dia!\n\n#novena #saobento #oracao #fe',
    metrics: {
      views: 41_000,
      reach: 29_000,
      likes: 3_100,
      comments: 410,
      saves: 5_900,
      shares: 1_700,
    },
  },
  {
    externalId: '18047213958201311',
    shortcode: 'DBd1sFq3C1k',
    format: 'image',
    hoursAgo: 386,
    caption:
      '"Entrega o teu caminho ao Senhor, confia nele, e o mais Ele fará." Salmo 37,5 ✨\n\n#frasedodia #fe #biblia',
    metrics: { views: 15_000, reach: 12_500, likes: 1_400, comments: 60, saves: 90, shares: 110 },
  },
  {
    externalId: '18047213958201312',
    shortcode: 'DBb5vGr7D2l',
    format: 'reel',
    hoursAgo: 458,
    video: 'ElephantsDream.mp4',
    caption:
      'Bênção da casa com água benta e oração 💧\n\nPasse em cada cômodo rezando: "Pela intercessão de São Bento, que o mal não entre aqui."\n\n#bencaodacasa #aguabenta #saobento',
    metrics: { views: 60_000, reach: 45_000, likes: 3_000, comments: 200, saves: 900, shares: 800 },
  },
];

/** Crescimento das métricas a cada nova leitura, para exercitar a atualização no sync. */
const GROWTH_PER_CALL = 0.04;

/**
 * Feed determinístico da conta de referência para dev e testes.
 * As datas são relativas ao `now` da primeira chamada e ficam fixas depois disso,
 * como num feed real; os ids externos são sempre os mesmos.
 */
export class FakeReferenceFeed implements ReferenceFeed {
  private calls = 0;
  private anchor: Date | null = null;

  async fetchRecent(_source: { id: string; handle: string }, now: Date): Promise<FeedPost[]> {
    const anchor = (this.anchor ??= new Date(now));
    const growth = 1 + GROWTH_PER_CALL * this.calls;
    this.calls += 1;
    return SEED.map((seed) => toFeedPost(seed, anchor, growth));
  }
}

function toFeedPost(seed: SeedPost, anchor: Date, growth: number): FeedPost {
  const media = mediaOf(seed);
  return {
    externalId: seed.externalId,
    format: seed.format,
    caption: seed.caption,
    permalink: `https://www.instagram.com/p/${seed.shortcode}/`,
    thumbnailUrl: media.thumbnailUrl,
    mediaUrls: media.mediaUrls,
    publishedAt: new Date(anchor.getTime() - seed.hoursAgo * 3_600_000),
    metrics: grow(seed.metrics, growth),
  };
}

function mediaOf(seed: SeedPost): { thumbnailUrl: string; mediaUrls: string[] } {
  const picsum = (key: string) => `https://picsum.photos/seed/${key}/1080/1350`;
  const cover = picsum(`sbs-${seed.shortcode}`);
  if (seed.format === 'reel') {
    return {
      thumbnailUrl: cover,
      mediaUrls: [`${SAMPLE_VIDEOS}/${seed.video ?? 'ForBiggerBlazes.mp4'}`],
    };
  }
  if (seed.format === 'carousel') {
    const slides = Array.from({ length: seed.slides ?? 3 }, (_, i) =>
      picsum(`sbs-${seed.shortcode}-${i + 1}`),
    );
    return { thumbnailUrl: slides[0] ?? cover, mediaUrls: slides };
  }
  return { thumbnailUrl: cover, mediaUrls: [cover] };
}

function grow(metrics: PostMetricsProps, factor: number): PostMetricsProps {
  const g = (n: number) => Math.round(n * factor);
  return {
    views: g(metrics.views),
    reach: g(metrics.reach),
    likes: g(metrics.likes),
    comments: g(metrics.comments),
    saves: g(metrics.saves),
    shares: g(metrics.shares),
  };
}
