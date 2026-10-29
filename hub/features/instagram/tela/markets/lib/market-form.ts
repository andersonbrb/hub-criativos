import {
  CreateChannelInputSchema,
  CreateMarketInputSchema,
  UpdateMarketInputSchema,
  type CreateChannelInput,
  type CreateMarketInput,
  type GlossaryTerm,
  type Market,
  type UpdateMarketInput,
} from '@sbs/contracts';

export interface GlossaryRow extends GlossaryTerm {
  key: string;
}

export interface MarketFormValues {
  code: string;
  name: string;
  locale: string;
  timezone: string;
  productName: string;
  offerUrl: string;
  glossary: GlossaryRow[];
  forbiddenTerms: string[];
  status: Market['status'];
}

/** Erros por campo: `code`, `glossary.2.source`, `_form`… */
export type FieldErrors = Record<string, string>;

let glossaryCounter = 0;
export function newGlossaryRow(term: Partial<GlossaryTerm> = {}): GlossaryRow {
  glossaryCounter += 1;
  return { key: `term-${glossaryCounter}`, source: term.source ?? '', target: term.target ?? '' };
}

export function emptyMarketForm(): MarketFormValues {
  return {
    code: '',
    name: '',
    locale: '',
    timezone: '',
    productName: '',
    offerUrl: '',
    glossary: [],
    forbiddenTerms: [],
    status: 'active',
  };
}

export function marketToForm(market: Market): MarketFormValues {
  return {
    code: market.code,
    name: market.name,
    locale: market.locale,
    timezone: market.timezone,
    productName: market.productName,
    offerUrl: market.offerUrl,
    glossary: market.glossary.map((term) => newGlossaryRow(term)),
    forbiddenTerms: [...market.forbiddenTerms],
    status: market.status,
  };
}

const CODE_PATTERN = /^[a-z0-9-]{2,20}$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(locale: string): boolean {
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(locale)) return false;
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

const fieldMessages = {
  code: 'Use de 2 a 20 letras minúsculas, números ou hífen (ex.: es-latam).',
  name: 'Informe o nome do mercado.',
  locale: 'Use uma tag de idioma válida (ex.: es-419, fr-FR).',
  timezone: 'Use um fuso IANA válido (ex.: Europe/Paris).',
  productName: 'Informe o nome do produto neste mercado.',
  offerUrl: 'Informe um link http(s) válido.',
  forbiddenTerms: 'Remova termos vazios.',
};

/** Normaliza o formulário: corta espaços e descarta linhas de glossário totalmente vazias. */
function normalize(values: MarketFormValues) {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    locale: values.locale.trim(),
    timezone: values.timezone.trim(),
    productName: values.productName.trim(),
    offerUrl: values.offerUrl.trim(),
    glossaryRows: values.glossary
      .map((row) => ({ ...row, source: row.source.trim(), target: row.target.trim() }))
      .filter((row) => row.source !== '' || row.target !== ''),
    forbiddenTerms: values.forbiddenTerms.map((term) => term.trim()).filter(Boolean),
  };
}

function domainChecks(
  data: ReturnType<typeof normalize>,
  mode: 'create' | 'edit',
  errors: FieldErrors,
) {
  if (mode === 'create' && !CODE_PATTERN.test(data.code)) errors['code'] ??= fieldMessages.code;
  if (!data.name) errors['name'] ??= fieldMessages.name;
  if (!data.productName) errors['productName'] ??= fieldMessages.productName;
  if (!isValidLocale(data.locale)) errors['locale'] ??= fieldMessages.locale;
  if (!isValidTimeZone(data.timezone)) errors['timezone'] ??= fieldMessages.timezone;
  if (!/^https?:\/\//i.test(data.offerUrl)) errors['offerUrl'] ??= fieldMessages.offerUrl;

  const sources = new Map<string, number>();
  data.glossaryRows.forEach((row, index) => {
    if (!row.source) errors[`glossary.${index}.source`] ??= 'Informe o termo original.';
    if (!row.target) errors[`glossary.${index}.target`] ??= 'Informe a tradução.';
    const key = row.source.toLocaleLowerCase();
    if (row.source && sources.has(key)) {
      errors[`glossary.${index}.source`] ??= 'Este termo já está no glossário.';
    }
    sources.set(key, index);
  });
}

function collectSchemaErrors(issues: readonly { path: PropertyKey[] }[], errors: FieldErrors) {
  for (const issue of issues) {
    const path = issue.path.map(String);
    const key = path.join('.');
    const top = path[0] ?? '_form';
    if (top === 'glossary') {
      errors[key] ??= path[2] === 'target' ? 'Informe a tradução.' : 'Informe o termo original.';
    } else {
      errors[top] ??= Object.hasOwn(fieldMessages, top)
        ? fieldMessages[top as keyof typeof fieldMessages]
        : 'Valor inválido.';
    }
  }
}

export type MarketFormResult<T> = { ok: true; input: T } | { ok: false; errors: FieldErrors };

/** Valida com o esquema do contrato + regras do domínio (código, fuso, glossário). */
export function validateCreateMarket(
  values: MarketFormValues,
): MarketFormResult<CreateMarketInput> {
  const data = normalize(values);
  const errors: FieldErrors = {};
  domainChecks(data, 'create', errors);
  const parsed = CreateMarketInputSchema.safeParse({
    code: data.code,
    name: data.name,
    locale: data.locale,
    timezone: data.timezone,
    productName: data.productName,
    offerUrl: data.offerUrl,
    glossary: data.glossaryRows.map(({ source, target }) => ({ source, target })),
    forbiddenTerms: data.forbiddenTerms,
  });
  if (!parsed.success) collectSchemaErrors(parsed.error.issues, errors);
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

export function validateUpdateMarket(
  values: MarketFormValues,
): MarketFormResult<UpdateMarketInput> {
  const data = normalize(values);
  const errors: FieldErrors = {};
  domainChecks(data, 'edit', errors);
  const parsed = UpdateMarketInputSchema.safeParse({
    name: data.name,
    locale: data.locale,
    timezone: data.timezone,
    productName: data.productName,
    offerUrl: data.offerUrl,
    glossary: data.glossaryRows.map(({ source, target }) => ({ source, target })),
    forbiddenTerms: data.forbiddenTerms,
    status: values.status,
  });
  if (!parsed.success) collectSchemaErrors(parsed.error.issues, errors);
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

export interface ChannelFormValues {
  handle: string;
  displayName: string;
}

export function validateCreateChannel(
  marketId: string,
  values: ChannelFormValues,
  postingPlan: CreateChannelInput['postingPlan'],
): MarketFormResult<CreateChannelInput> {
  const parsed = CreateChannelInputSchema.safeParse({
    marketId,
    handle: values.handle.trim().replace(/^@/, ''),
    displayName: values.displayName.trim(),
    postingPlan,
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const top = String(issue.path[0] ?? '_form');
    if (top === 'handle') {
      errors['handle'] ??= 'Use até 30 letras, números, ponto ou _, sem @.';
    } else if (top === 'displayName') {
      errors['displayName'] ??= 'Informe o nome de exibição.';
    } else {
      errors['_form'] ??= 'Revise a grade de postagem.';
    }
  }
  return { ok: false, errors };
}

/** Junta erros de campo vindos da API (`details.fieldErrors`) aos do formulário. */
export function mergeFieldErrors(local: FieldErrors, remote: FieldErrors): FieldErrors {
  return { ...remote, ...local };
}
