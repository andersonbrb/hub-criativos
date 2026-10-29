import { AggregateRoot, Locale, ReferenceSourceId } from '@sbs/shared-kernel';
import { ReferenceErrors } from '../errors';

export type SourceConnectionStatus = 'disconnected' | 'connected';

export interface ReferenceSourceProps {
  handle: string;
  /** Idioma dos posts originais. Padrão `pt-BR` (conta brasileira). */
  locale?: string;
  /** Conectada: os posts dela são lidos na sincronização. Padrão: conectada. */
  connected?: boolean;
}

export interface ReferenceSourceSnapshot {
  id: string;
  version: number;
  handle: string;
  locale: string;
  connectionStatus: SourceConnectionStatus;
  lastSyncedAt: string | null;
}

const HANDLE_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const DEFAULT_LOCALE = 'pt-BR';

/**
 * Uma página do Instagram de onde vêm os conteúdos originais. Só as conectadas são lidas na
 * sincronização e entram na seleção automática; desconectar não apaga os posts já importados.
 */
export class ReferenceSource extends AggregateRoot<ReferenceSourceId> {
  private constructor(
    id: ReferenceSourceId,
    version: number,
    readonly handle: string,
    readonly locale: Locale,
    private _connectionStatus: SourceConnectionStatus,
    private _lastSyncedAt: Date | null,
  ) {
    super(id, version);
  }

  static create(id: ReferenceSourceId, props: ReferenceSourceProps): ReferenceSource {
    return new ReferenceSource(
      id,
      0,
      normalizeHandle(props.handle),
      Locale(props.locale ?? DEFAULT_LOCALE),
      props.connected === false ? 'disconnected' : 'connected',
      null,
    );
  }

  static fromSnapshot(s: ReferenceSourceSnapshot): ReferenceSource {
    return new ReferenceSource(
      ReferenceSourceId(s.id),
      s.version,
      s.handle,
      Locale(s.locale),
      s.connectionStatus,
      s.lastSyncedAt === null ? null : new Date(s.lastSyncedAt),
    );
  }

  get connectionStatus() {
    return this._connectionStatus;
  }
  get lastSyncedAt() {
    return this._lastSyncedAt;
  }

  get isConnected(): boolean {
    return this._connectionStatus === 'connected';
  }

  connect(): void {
    this._connectionStatus = 'connected';
  }

  disconnect(): void {
    this._connectionStatus = 'disconnected';
  }

  markSynced(now: Date): void {
    this._lastSyncedAt = now;
  }

  toSnapshot(): ReferenceSourceSnapshot {
    return {
      id: this.id,
      version: this.version,
      handle: this.handle,
      locale: this.locale,
      connectionStatus: this._connectionStatus,
      lastSyncedAt: this._lastSyncedAt?.toISOString() ?? null,
    };
  }
}

/**
 * `@SaoBento.Oficial` → `saobento.oficial`: o Instagram não diferencia maiúsculas.
 * Aceita também o link do perfil (`https://www.instagram.com/saobento.oficial/?hl=pt`).
 */
export function normalizeHandle(raw: string): string {
  const handle = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
  if (!HANDLE_PATTERN.test(handle)) throw ReferenceErrors.invalidHandle(raw);
  return handle.toLowerCase();
}
