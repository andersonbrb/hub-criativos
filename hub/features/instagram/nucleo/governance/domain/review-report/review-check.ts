import { GovernanceErrors } from '../errors';

export const REVIEW_CHECK_STATUSES = ['pass', 'warn', 'fail'] as const;
export type ReviewCheckStatus = (typeof REVIEW_CHECK_STATUSES)[number];

export interface ReviewCheckProps {
  /** Identificador estável (`snake_case`), usado pelo painel e pela API. */
  code: string;
  /** Nome curto da checagem, para o revisor. */
  label: string;
  status: ReviewCheckStatus;
  /** Só reprovações (`fail`) podem bloquear a aprovação. */
  blocking: boolean;
  /** Explicação para o revisor do que foi encontrado. */
  message: string;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** Resultado de uma checagem automática (por regra ou por IA). Imutável. */
export class ReviewCheck {
  private constructor(
    readonly code: string,
    readonly label: string,
    readonly status: ReviewCheckStatus,
    readonly blocking: boolean,
    readonly message: string,
  ) {}

  static of(props: ReviewCheckProps): ReviewCheck {
    const code = typeof props.code === 'string' ? props.code.trim() : '';
    if (!CODE_PATTERN.test(code)) {
      throw GovernanceErrors.invalidReviewCheck(`código "${String(props.code)}" inválido.`, {
        code: props.code,
      });
    }
    if (!(REVIEW_CHECK_STATUSES as readonly string[]).includes(props.status)) {
      throw GovernanceErrors.invalidReviewCheck(
        `situação "${String(props.status)}" desconhecida.`,
        {
          code,
          status: props.status,
        },
      );
    }
    if (typeof props.blocking !== 'boolean') {
      throw GovernanceErrors.invalidReviewCheck(`"${code}" sem indicação de bloqueio.`, { code });
    }
    // Um aviso que bloqueia confundiria o revisor: o score diz "aviso", o botão diz "não pode".
    if (props.blocking && props.status !== 'fail') {
      throw GovernanceErrors.invalidReviewCheck(
        `só reprovações podem ser bloqueantes ("${code}").`,
        {
          code,
          status: props.status,
        },
      );
    }
    const label = requireText(props.label, code, 'nome');
    const message = requireText(props.message, code, 'mensagem');
    return new ReviewCheck(code, label, props.status, props.blocking, message);
  }

  static pass(code: string, label: string, message: string): ReviewCheck {
    return ReviewCheck.of({ code, label, status: 'pass', blocking: false, message });
  }

  static warn(code: string, label: string, message: string): ReviewCheck {
    return ReviewCheck.of({ code, label, status: 'warn', blocking: false, message });
  }

  static fail(code: string, label: string, message: string, blocking = true): ReviewCheck {
    return ReviewCheck.of({ code, label, status: 'fail', blocking, message });
  }

  get isBlockingIssue(): boolean {
    return this.status === 'fail' && this.blocking;
  }

  toProps(): ReviewCheckProps {
    return {
      code: this.code,
      label: this.label,
      status: this.status,
      blocking: this.blocking,
      message: this.message,
    };
  }
}

function requireText(value: unknown, code: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw GovernanceErrors.invalidReviewCheck(`"${code}" sem ${field}.`, { code });
  return trimmed;
}
