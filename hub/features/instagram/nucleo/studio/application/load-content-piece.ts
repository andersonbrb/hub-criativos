import { ContentPieceId, NotFoundError } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../domain';

export async function loadContentPiece(
  pieces: ContentPieceRepository,
  id: string,
): Promise<ContentPiece> {
  const piece = await pieces.findById(ContentPieceId(id));
  if (!piece) throw new NotFoundError('Peça', id);
  return piece;
}
