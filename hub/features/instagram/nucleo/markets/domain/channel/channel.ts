import { AggregateRoot, ChannelId, MarketId, domainEvent } from '@sbs/shared-kernel';
import { MarketErrors } from '../errors';
import { PostingPlan, type PostingSlot } from './posting-plan';

export type ConnectionStatus = 'disconnected' | 'connected';

export interface ChannelSnapshot {
  id: string;
  version: number;
  marketId: string;
  platform: 'instagram';
  handle: string;
  displayName: string;
  connectionStatus: ConnectionStatus;
  externalAccountId: string | null;
  postingPlan: PostingSlot[];
}

const HANDLE_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;

/** `@Momento.SB` → `momento.sb`. */
export function normalizeChannelHandle(raw: string): string {
  const handle = raw.trim().replace(/^@/, '');
  if (!HANDLE_PATTERN.test(handle)) throw MarketErrors.invalidHandle(raw);
  return handle.toLowerCase();
}

/** Uma conta do Instagram de um mercado. */
export class Channel extends AggregateRoot<ChannelId> {
  private constructor(
    id: ChannelId,
    version: number,
    private _marketId: MarketId,
    readonly platform: 'instagram',
    private _handle: string,
    private _displayName: string,
    private _connectionStatus: ConnectionStatus,
    private _externalAccountId: string | null,
    private _postingPlan: PostingPlan,
  ) {
    super(id, version);
  }

  static create(
    id: ChannelId,
    props: { marketId: MarketId; handle: string; displayName: string; postingPlan?: PostingSlot[] },
    now: Date,
  ): Channel {
    const handle = normalizeChannelHandle(props.handle);
    const displayName = props.displayName.trim();
    if (!displayName) throw MarketErrors.invalidDisplayName();

    const channel = new Channel(
      id,
      0,
      props.marketId,
      'instagram',
      handle,
      displayName,
      'disconnected',
      null,
      props.postingPlan ? PostingPlan.of(props.postingPlan) : PostingPlan.default(),
    );
    channel.record(
      domainEvent('markets.channel_created', now, {
        channelId: id,
        marketId: props.marketId,
        handle: channel.handle,
      }),
    );
    return channel;
  }

  static fromSnapshot(s: ChannelSnapshot): Channel {
    return new Channel(
      ChannelId(s.id),
      s.version,
      MarketId(s.marketId),
      s.platform,
      s.handle,
      s.displayName,
      s.connectionStatus,
      s.externalAccountId,
      PostingPlan.of(s.postingPlan),
    );
  }

  get marketId(): MarketId {
    return this._marketId;
  }
  get handle(): string {
    return this._handle;
  }
  get displayName() {
    return this._displayName;
  }
  get connectionStatus() {
    return this._connectionStatus;
  }
  get externalAccountId() {
    return this._externalAccountId;
  }
  get postingPlan(): PostingPlan {
    return this._postingPlan;
  }

  updatePostingPlan(slots: PostingSlot[]): void {
    this._postingPlan = PostingPlan.of(slots);
  }

  connect(externalAccountId: string): void {
    const id = externalAccountId.trim();
    if (!id) throw MarketErrors.invalidHandle(externalAccountId);
    this._externalAccountId = id;
    this._connectionStatus = 'connected';
  }

  disconnect(): void {
    this._connectionStatus = 'disconnected';
  }

  /**
   * Vincula à conta do Instagram que fez login: o @ passa a ser o que o Instagram informa
   * (nunca digitado), e o canal fica conectado.
   */
  linkInstagramAccount(username: string, externalAccountId: string): void {
    this._handle = normalizeChannelHandle(username);
    this.connect(externalAccountId);
  }

  /** Muda o mercado (país) a que a conta pertence. */
  moveToMarket(marketId: MarketId): void {
    this._marketId = marketId;
  }

  toSnapshot(): ChannelSnapshot {
    return {
      id: this.id,
      version: this.version,
      marketId: this._marketId,
      platform: this.platform,
      handle: this._handle,
      displayName: this._displayName,
      connectionStatus: this._connectionStatus,
      externalAccountId: this._externalAccountId,
      postingPlan: this._postingPlan.slots.map((s) => ({ ...s })),
    };
  }
}
