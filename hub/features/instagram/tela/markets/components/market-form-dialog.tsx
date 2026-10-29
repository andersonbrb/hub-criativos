'use client';

import type { Market } from '@sbs/contracts';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input, Select } from '@/features/instagram/tela/ui/input';
import { errorMessage, isApiError } from '@/features/instagram/tela/lib/api/errors';
import { useCreateMarket, useUpdateMarket } from '../hooks/use-markets';
import {
  emptyMarketForm,
  marketToForm,
  mergeFieldErrors,
  validateCreateMarket,
  validateUpdateMarket,
  type FieldErrors,
  type MarketFormValues,
} from '../lib/market-form';
import { GlossaryEditor, TermsInput } from './glossary-editor';

interface MarketFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem mercado: criação. Com mercado: edição. */
  market?: Market;
  /** Chamado com o mercado recém-criado (ex.: para já selecioná-lo num seletor de país). */
  onCreated?: (market: Market) => void;
}

export function MarketFormDialog({ open, onOpenChange, market, onCreated }: MarketFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title={market ? `Editar ${market.name}` : 'Novo mercado'}
        description={
          market
            ? 'As mudanças valem para as próximas adaptações deste mercado.'
            : 'Um mercado (país) define idioma, fuso, produto e oferta. Depois, conecte a conta do Instagram dele.'
        }
      >
        {open ? (
          <MarketForm
            key={market?.id ?? 'new'}
            market={market}
            onDone={() => onOpenChange(false)}
            {...(onCreated ? { onCreated } : {})}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MarketForm({
  market,
  onDone,
  onCreated,
}: {
  market?: Market;
  onDone: () => void;
  onCreated?: (market: Market) => void;
}) {
  const [values, setValues] = useState<MarketFormValues>(() =>
    market ? marketToForm(market) : emptyMarketForm(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateMarket();
  const update = useUpdateMarket();
  const mutation = market ? update : create;
  const apiError = mutation.error;

  function set<K extends keyof MarketFormValues>(key: K, value: MarketFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function onApiError(error: unknown) {
    if (isApiError(error)) setErrors(mergeFieldErrors({}, error.fieldErrors));
  }

  function submit() {
    if (market) {
      const result = validateUpdateMarket(values);
      if (!result.ok) return setErrors(result.errors);
      setErrors({});
      update.mutate(
        { id: market.id, input: result.input },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} atualizado`);
            onDone();
          },
          onError: onApiError,
        },
      );
    } else {
      const result = validateCreateMarket(values);
      if (!result.ok) return setErrors(result.errors);
      setErrors({});
      create.mutate(result.input, {
        onSuccess: (saved) => {
          toast.success(`${saved.name} criado`, {
            description: 'Agora conecte a conta do Instagram deste país.',
          });
          onCreated?.(saved);
          onDone();
        },
        onError: onApiError,
      });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" error={errors['name']} required>
          <Input
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="Espanha"
          />
        </Field>
        <Field
          label="Código"
          hint={market ? 'O código não muda depois de criado.' : 'Minúsculas, números e hífen.'}
          error={errors['code']}
          required
        >
          <Input
            value={values.code}
            onChange={(event) => set('code', event.target.value.toLowerCase())}
            placeholder="es"
            disabled={Boolean(market)}
          />
        </Field>
        <Field
          label="Idioma (locale)"
          hint="Tag BCP 47, ex.: es-ES, fr-FR."
          error={errors['locale']}
          required
        >
          <Input
            value={values.locale}
            onChange={(event) => set('locale', event.target.value)}
            placeholder="es-ES"
          />
        </Field>
        <Field
          label="Fuso horário"
          hint="Fuso IANA, ex.: Europe/Madrid."
          error={errors['timezone']}
          required
        >
          <Input
            value={values.timezone}
            onChange={(event) => set('timezone', event.target.value)}
            placeholder="Europe/Madrid"
            list="timezone-options"
          />
        </Field>
        <Field label="Nome do produto" error={errors['productName']} required>
          <Input
            value={values.productName}
            onChange={(event) => set('productName', event.target.value)}
            placeholder="San Benito"
          />
        </Field>
        <Field label="Link da oferta" error={errors['offerUrl']} required>
          <Input
            type="url"
            value={values.offerUrl}
            onChange={(event) => set('offerUrl', event.target.value)}
            placeholder="https://"
          />
        </Field>
        {market ? (
          <Field label="Situação" hint="Mercados pausados não recebem novas adaptações.">
            <Select
              value={values.status}
              onChange={(event) =>
                set('status', event.target.value === 'paused' ? 'paused' : 'active')
              }
            >
              <option value="active">Ativo</option>
              <option value="paused">Pausado</option>
            </Select>
          </Field>
        ) : null}
      </div>
      <datalist id="timezone-options">
        {[
          'Europe/Madrid',
          'Europe/Paris',
          'America/Mexico_City',
          'America/Bogota',
          'America/Argentina/Buenos_Aires',
          'America/Santiago',
          'Europe/Lisbon',
          'Europe/Rome',
          'America/New_York',
        ].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <GlossaryEditor
        rows={values.glossary}
        onChange={(rows) => set('glossary', rows)}
        errors={errors}
      />

      <TermsInput
        label="Termos proibidos"
        hint="Palavras que nunca podem aparecer, como o nome do produto de outro mercado."
        terms={values.forbiddenTerms}
        onChange={(terms) => set('forbiddenTerms', terms)}
        error={errors['forbiddenTerms']}
      />

      {apiError ? (
        <InlineAlert title="Não foi possível salvar o mercado">
          {errorMessage(apiError)}
        </InlineAlert>
      ) : Object.keys(errors).length > 0 ? (
        <InlineAlert tone="warning" title="Revise os campos destacados" />
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {market ? 'Salvar mercado' : 'Criar mercado'}
        </Button>
      </DialogFooter>
    </form>
  );
}
