import { ReferenceErrors } from '../errors';

export interface PostMetricsProps {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}

const METRIC_NAMES = ['views', 'reach', 'likes', 'comments', 'saves', 'shares'] as const;

/** Métricas de um post no Instagram. Contadores inteiros, nunca negativos. */
export class PostMetrics {
  private constructor(
    readonly views: number,
    readonly reach: number,
    readonly likes: number,
    readonly comments: number,
    readonly saves: number,
    readonly shares: number,
  ) {}

  static of(props: PostMetricsProps): PostMetrics {
    for (const name of METRIC_NAMES) {
      const value = props[name];
      if (!Number.isInteger(value) || value < 0) throw ReferenceErrors.invalidMetrics(name, value);
    }
    return new PostMetrics(
      props.views,
      props.reach,
      props.likes,
      props.comments,
      props.saves,
      props.shares,
    );
  }

  static zero(): PostMetrics {
    return new PostMetrics(0, 0, 0, 0, 0, 0);
  }

  /**
   * Engajamento ponderado: salvar e compartilhar pesam mais porque indicam conteúdo que o
   * público quer rever e espalhar.
   *
   * - Com alcance (insights da conta, como dona): por mil pessoas alcançadas. O denominador
   *   usa o maior entre alcance e visualizações para não inflar reels com alcance subnotificado.
   * - Sem alcance (dados públicos do perfil: não há alcance, salvamentos nem compartilhamentos,
   *   e fotos/carrosséis não mostram visualizações): o engajamento absoluto. Dividir só os reels
   *   pelas visualizações deixaria fotos e carrosséis numa escala diferente.
   *
   * Todos os posts de uma conta vêm da mesma fonte, então o ranking fica numa escala só.
   */
  get performanceScore(): number {
    const weighted = this.likes + 2 * this.comments + 3 * this.saves + 4 * this.shares;
    if (this.reach === 0) return weighted;
    const audience = Math.max(this.reach, this.views);
    return Math.round((weighted / audience) * 1000 * 100) / 100;
  }

  equals(other: PostMetrics): boolean {
    return METRIC_NAMES.every((name) => this[name] === other[name]);
  }

  toProps(): PostMetricsProps {
    return {
      views: this.views,
      reach: this.reach,
      likes: this.likes,
      comments: this.comments,
      saves: this.saves,
      shares: this.shares,
    };
  }
}
