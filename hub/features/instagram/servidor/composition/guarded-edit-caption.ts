import type { ReviewEditedCaption } from '@sbs/governance';
import { ContentPieceId, NotFoundError } from '@sbs/shared-kernel';
import type {
  ContentPiece,
  ContentPieceRepository,
  EditCaption,
  EditCaptionInput,
} from '@sbs/studio';

/**
 * A edição de legenda acontece depois da revisão automática. Sem esta guarda, o revisor
 * poderia salvar um texto que a governança bloquearia (ex.: um termo proibido ou uma promessa
 * de cura). Aqui o texto editado passa de novo pela revisão da governança, com o mesmo
 * critério da legenda gerada:
 *
 * - regras: falha bloqueante recusa a edição (`caption_blocked_by_rules`);
 * - IA: o resultado vira o novo relatório da revisão, salvo junto com a edição; falha
 *   bloqueante impede a aprovação, como na produção. IA fora do ar ou lenta vira aviso.
 *
 * Salvar o mesmo texto não faz nada (nem chama a IA).
 */
export class GuardedEditCaption {
  constructor(
    private readonly editCaption: EditCaption,
    private readonly pieces: ContentPieceRepository,
    private readonly reviewEditedCaption: ReviewEditedCaption,
  ) {}

  async execute(input: EditCaptionInput): Promise<ContentPiece> {
    const piece = await this.pieces.findById(ContentPieceId(input.contentPieceId));
    if (!piece) throw new NotFoundError('Peça de conteúdo', input.contentPieceId);
    // Fora de `awaiting_approval` o próprio studio recusa a edição; não gasta a IA antes.
    if (piece.status !== 'awaiting_approval') return this.editCaption.execute(input);
    if (piece.hasCaption(input.caption, input.hashtags)) return piece;

    const report = await this.reviewEditedCaption.execute({
      contentPieceId: input.contentPieceId,
      caption: input.caption,
      hashtags: input.hashtags,
    });
    return this.editCaption.execute({
      ...input,
      review: {
        reportId: report.id,
        score: report.score,
        hasBlockingIssues: report.hasBlockingIssues,
      },
    });
  }
}
