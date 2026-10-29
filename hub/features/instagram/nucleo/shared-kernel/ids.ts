import type { Brand } from './brand';
import { DomainError } from './domain-error';

export type MarketId = Brand<string, 'MarketId'>;
export type ChannelId = Brand<string, 'ChannelId'>;
export type ReferenceSourceId = Brand<string, 'ReferenceSourceId'>;
export type ReferencePostId = Brand<string, 'ReferencePostId'>;
export type ContentPieceId = Brand<string, 'ContentPieceId'>;
export type ReviewReportId = Brand<string, 'ReviewReportId'>;
export type PublicationId = Brand<string, 'PublicationId'>;
export type UserId = Brand<string, 'UserId'>;

function id<T extends string>(kind: string) {
  return (value: string): Brand<string, T> => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new DomainError('invalid_id', `${kind} inválido.`, { value });
    }
    return value as Brand<string, T>;
  };
}

export const MarketId = id<'MarketId'>('MarketId');
export const ChannelId = id<'ChannelId'>('ChannelId');
export const ReferenceSourceId = id<'ReferenceSourceId'>('ReferenceSourceId');
export const ReferencePostId = id<'ReferencePostId'>('ReferencePostId');
export const ContentPieceId = id<'ContentPieceId'>('ContentPieceId');
export const ReviewReportId = id<'ReviewReportId'>('ReviewReportId');
export const PublicationId = id<'PublicationId'>('PublicationId');
export const UserId = id<'UserId'>('UserId');
