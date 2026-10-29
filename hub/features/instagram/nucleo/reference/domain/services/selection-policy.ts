import { ReferenceErrors } from '../errors';
import { compareByPerformance, type ReferencePost } from '../reference-post/reference-post';

export interface SelectionPolicyConfig {
  /** Fatia do topo do ranking que pode ser selecionada, em %. */
  topPercent: number;
  /** Idade mínima: antes disso as métricas ainda não assentaram. */
  minAgeHours: number;
  /** Quantos posts novos no máximo por execução. */
  maxPerRun: number;
  /** Idade máxima: conteúdo antigo deixa de representar o que funciona hoje. */
  maxAgeDays: number;
}

export const DEFAULT_SELECTION_POLICY: Readonly<SelectionPolicyConfig> = {
  topPercent: 20,
  minAgeHours: 24,
  maxPerRun: 3,
  maxAgeDays: 30,
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Escolhe, entre os posts da conta de referência, os de melhor desempenho para adaptar. */
export class SelectionPolicy {
  readonly config: Readonly<SelectionPolicyConfig>;

  constructor(config: Partial<SelectionPolicyConfig> = {}) {
    const merged: SelectionPolicyConfig = {
      topPercent: config.topPercent ?? DEFAULT_SELECTION_POLICY.topPercent,
      minAgeHours: config.minAgeHours ?? DEFAULT_SELECTION_POLICY.minAgeHours,
      maxPerRun: config.maxPerRun ?? DEFAULT_SELECTION_POLICY.maxPerRun,
      maxAgeDays: config.maxAgeDays ?? DEFAULT_SELECTION_POLICY.maxAgeDays,
    };
    validate(merged);
    this.config = merged;
  }

  /**
   * O corte do percentil é calculado sobre **todos** os posts adaptáveis da janela,
   * inclusive os já selecionados (e ignorados): assim o padrão de "top" não cai só
   * porque os melhores já foram aproveitados. Só os `new` desse topo são devolvidos.
   */
  pickWinners(posts: readonly ReferencePost[], now: Date): ReferencePost[] {
    const ranked = posts
      .filter((post) => post.isAdaptable && this.isWithinWindow(post, now))
      .sort(compareByPerformance);
    // Arredonda para cima para que janelas pequenas ainda tenham ao menos um vencedor.
    const cut = Math.ceil((ranked.length * this.config.topPercent) / 100);
    return ranked
      .slice(0, cut)
      .filter((post) => post.status === 'new')
      .slice(0, this.config.maxPerRun);
  }

  private isWithinWindow(post: ReferencePost, now: Date): boolean {
    const age = now.getTime() - post.publishedAt.getTime();
    return age >= this.config.minAgeHours * HOUR_MS && age <= this.config.maxAgeDays * DAY_MS;
  }
}

function validate(c: SelectionPolicyConfig): void {
  if (!Number.isFinite(c.topPercent) || c.topPercent <= 0 || c.topPercent > 100)
    throw ReferenceErrors.invalidSelectionPolicy('o percentual do topo deve estar entre 0 e 100.');
  if (!Number.isFinite(c.minAgeHours) || c.minAgeHours < 0)
    throw ReferenceErrors.invalidSelectionPolicy('a idade mínima não pode ser negativa.');
  if (!Number.isFinite(c.maxAgeDays) || c.maxAgeDays * 24 <= c.minAgeHours)
    throw ReferenceErrors.invalidSelectionPolicy('a idade máxima deve ser maior que a mínima.');
  if (!Number.isInteger(c.maxPerRun) || c.maxPerRun < 1)
    throw ReferenceErrors.invalidSelectionPolicy('selecione ao menos um post por execução.');
}
