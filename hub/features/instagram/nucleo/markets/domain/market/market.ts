import { AggregateRoot, Locale, MarketId, domainEvent } from '@sbs/shared-kernel';
import { MarketErrors } from '../errors';
import { Glossary, type GlossaryTerm } from './glossary';

export type MarketStatus = 'active' | 'paused';

export interface MarketProps {
  code: string;
  name: string;
  locale: string;
  timezone: string;
  productName: string;
  offerUrl: string;
  glossary: GlossaryTerm[];
  forbiddenTerms: string[];
}

export interface MarketSnapshot extends MarketProps {
  id: string;
  version: number;
  status: MarketStatus;
  createdAt: string;
}

const CODE_PATTERN = /^[a-z0-9-]{2,20}$/;

/**
 * Um país/idioma onde a oferta é vendida. Define como o conteúdo é adaptado:
 * idioma, fuso da grade de postagem, nome do produto, link da oferta e glossário.
 */
export class Market extends AggregateRoot<MarketId> {
  private constructor(
    id: MarketId,
    version: number,
    readonly code: string,
    private _name: string,
    private _locale: Locale,
    private _timezone: string,
    private _productName: string,
    private _offerUrl: string,
    private _glossary: Glossary,
    private _forbiddenTerms: string[],
    private _status: MarketStatus,
    readonly createdAt: Date,
  ) {
    super(id, version);
  }

  static create(id: MarketId, props: MarketProps, now: Date): Market {
    if (!CODE_PATTERN.test(props.code)) throw MarketErrors.invalidCode(props.code);
    const market = new Market(
      id,
      0,
      props.code,
      requireName(props.name),
      Locale(props.locale),
      requireTimezone(props.timezone),
      requireProductName(props.productName),
      requireOfferUrl(props.offerUrl),
      Glossary.of(props.glossary),
      normalizeForbiddenTerms(props.forbiddenTerms),
      'active',
      now,
    );
    market.record(domainEvent('markets.market_created', now, { marketId: id, code: props.code }));
    return market;
  }

  static fromSnapshot(s: MarketSnapshot): Market {
    return new Market(
      MarketId(s.id),
      s.version,
      s.code,
      s.name,
      Locale(s.locale),
      s.timezone,
      s.productName,
      s.offerUrl,
      Glossary.of(s.glossary),
      [...s.forbiddenTerms],
      s.status,
      new Date(s.createdAt),
    );
  }

  get name() {
    return this._name;
  }
  get locale() {
    return this._locale;
  }
  get timezone() {
    return this._timezone;
  }
  get productName() {
    return this._productName;
  }
  get offerUrl() {
    return this._offerUrl;
  }
  get glossary(): readonly GlossaryTerm[] {
    return this._glossary.terms;
  }
  get forbiddenTerms(): readonly string[] {
    return this._forbiddenTerms;
  }
  get status() {
    return this._status;
  }
  get isActive() {
    return this._status === 'active';
  }

  update(changes: Partial<Omit<MarketProps, 'code'>>): void {
    if (changes.name !== undefined) this._name = requireName(changes.name);
    if (changes.locale !== undefined) this._locale = Locale(changes.locale);
    if (changes.timezone !== undefined) this._timezone = requireTimezone(changes.timezone);
    if (changes.productName !== undefined)
      this._productName = requireProductName(changes.productName);
    if (changes.offerUrl !== undefined) this._offerUrl = requireOfferUrl(changes.offerUrl);
    if (changes.glossary !== undefined) this._glossary = Glossary.of(changes.glossary);
    if (changes.forbiddenTerms !== undefined)
      this._forbiddenTerms = normalizeForbiddenTerms(changes.forbiddenTerms);
  }

  pause(): void {
    this._status = 'paused';
  }

  activate(): void {
    this._status = 'active';
  }

  toSnapshot(): MarketSnapshot {
    return {
      id: this.id,
      version: this.version,
      code: this.code,
      name: this._name,
      locale: this._locale,
      timezone: this._timezone,
      productName: this._productName,
      offerUrl: this._offerUrl,
      glossary: this._glossary.terms.map((t) => ({ ...t })),
      forbiddenTerms: [...this._forbiddenTerms],
      status: this._status,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw MarketErrors.invalidName();
  return trimmed;
}

function requireProductName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw MarketErrors.invalidProductName();
  return trimmed;
}

function requireTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw MarketErrors.invalidTimezone(timezone);
  }
}

function requireOfferUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw MarketErrors.invalidOfferUrl(url);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw MarketErrors.invalidOfferUrl(url);
  }
  return parsed.toString();
}

function normalizeForbiddenTerms(terms: string[]): string[] {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  return [...new Set(cleaned)];
}
