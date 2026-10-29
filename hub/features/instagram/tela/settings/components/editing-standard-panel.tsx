'use client';

import type { EditingGuidelines, EditingStandard, EditingStyle } from '@sbs/contracts';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/features/instagram/tela/ui/card';
import { ErrorState, Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input, Select, Textarea } from '@/features/instagram/tela/ui/input';
import { Segmented } from '@/features/instagram/tela/ui/segmented';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { formatDateTime } from '@/features/instagram/tela/lib/format';
import { useEditingStandard, useUpdateEditingStandard } from '../hooks/use-editing-standard';

const GUIDELINES: { key: keyof EditingGuidelines; label: string; hint: string }[] = [
  {
    key: 'principles',
    label: 'Regras gerais',
    hint: 'Valem para o diretor de edição e todos os especialistas: tom, público, limites.',
  },
  { key: 'hook', label: 'Hook', hint: 'Especialista no gancho dos 3 primeiros segundos.' },
  { key: 'body', label: 'Body', hint: 'Especialista no desenvolvimento: o que destacar.' },
  { key: 'cta', label: 'CTA', hint: 'Especialista na chamada para ação do final.' },
  {
    key: 'headlines',
    label: 'Headlines e legendas',
    hint: 'Especialista no título fixo e nas legendas na tela.',
  },
];

const FONTS: EditingStyle['font'][] = [
  'Montserrat',
  'Poppins',
  'Inter',
  'Lora',
  'Playfair Display',
];

const TOGGLES: { key: 'showCaptions' | 'showHeadline' | 'showCtaCard'; label: string }[] = [
  { key: 'showCaptions', label: 'Legendas sincronizadas' },
  { key: 'showHeadline', label: 'Headline fixa no topo' },
  { key: 'showCtaCard', label: 'Cartão de CTA no final' },
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor)`}
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} maxLength={7} />
      </div>
    </Field>
  );
}

/** Miniatura 9:16 com o estilo escolhido (gancho, headline, legenda e CTA). */
function StylePreview({ style }: { style: EditingStyle }) {
  const font = { fontFamily: `"${style.font}", system-ui, sans-serif`, fontWeight: 800 };
  return (
    <div
      aria-hidden
      className="relative mx-auto aspect-[9/16] w-40 overflow-hidden rounded-xl bg-gradient-to-b from-[#3a3f4a] to-[#14171d] text-center shadow-card"
    >
      {style.showHeadline ? (
        <span
          className="absolute top-[6%] left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-[0.55rem] whitespace-nowrap"
          style={{ ...font, color: style.textColor }}
        >
          Oración a San Benito
        </span>
      ) : null}
      <span
        className="absolute top-[18%] left-1/2 w-[84%] -translate-x-1/2 rounded-md bg-black/55 px-1.5 py-1 text-[0.7rem] leading-tight"
        style={{ ...font, color: style.textColor }}
      >
        ¿Sientes que nadie te escucha?
      </span>
      {style.showCtaCard ? (
        <span
          className="absolute top-[42%] left-1/2 -translate-x-1/2 rounded-md px-2 py-1 text-[0.65rem] whitespace-nowrap text-[#111]"
          style={{ ...font, background: style.highlightColor }}
        >
          Comenta AMÉN
        </span>
      ) : null}
      {style.showCaptions ? (
        <span
          className={`absolute left-1/2 w-[90%] -translate-x-1/2 text-[0.8rem] uppercase ${
            style.captionsPosition === 'bottom' ? 'bottom-[15%]' : 'top-[60%]'
          }`}
          style={{ ...font, color: style.textColor, textShadow: '0 1px 3px rgba(0,0,0,.8)' }}
        >
          protege tu <span style={{ color: style.highlightColor }}>hogar</span>
        </span>
      ) : null}
    </div>
  );
}

function EditingStandardForm({ standard }: { standard: EditingStandard }) {
  const update = useUpdateEditingStandard();
  const [guidelines, setGuidelines] = useState(standard.guidelines);
  const [style, setStyle] = useState(standard.style);
  const setStyleField = <K extends keyof EditingStyle>(key: K, value: EditingStyle[K]) =>
    setStyle((current) => ({ ...current, [key]: value }));

  function save() {
    update.mutate(
      { guidelines, style },
      {
        onSuccess: () =>
          toast.success('Padrão de Edição salvo', {
            description: 'Vale para as próximas edições de reels.',
          }),
        onError: (error) =>
          toast.error('Não foi possível salvar', { description: errorMessage(error) }),
      },
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Instruções dos agentes</CardTitle>
            <CardDescription>
              O diretor de edição consulta os especialistas de Hook, Body, CTA e Headlines/legendas;
              cada um decide manter ou adaptar seguindo estas instruções.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {GUIDELINES.map(({ key, label, hint }) => (
            <Field key={key} label={label} hint={hint}>
              <Textarea
                value={guidelines[key]}
                onChange={(event) =>
                  setGuidelines((current) => ({ ...current, [key]: event.target.value }))
                }
                rows={key === 'principles' ? 5 : 3}
                maxLength={4000}
                required
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Estilo na tela</CardTitle>
            <CardDescription>Fonte, cores e o que aparece no vídeo editado.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <Field label="Fonte">
              <Select
                value={style.font}
                onChange={(event) =>
                  setStyleField('font', event.target.value as EditingStyle['font'])
                }
              >
                {FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label="Cor do texto"
                value={style.textColor}
                onChange={(value) => setStyleField('textColor', value)}
              />
              <ColorField
                label="Cor de destaque"
                value={style.highlightColor}
                onChange={(value) => setStyleField('highlightColor', value)}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">Posição das legendas</p>
              <Segmented
                label="Posição das legendas"
                value={style.captionsPosition}
                onChange={(value) => setStyleField('captionsPosition', value)}
                options={[
                  { value: 'bottom', label: 'Embaixo' },
                  { value: 'middle', label: 'No meio' },
                ]}
              />
            </div>
            <div className="space-y-2">
              {TOGGLES.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={style[key]}
                    onChange={(event) => setStyleField(key, event.target.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <StylePreview style={style} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {standard.updatedAt ? (
          <p className="mr-auto text-xs text-ink-subtle">
            Última edição por {standard.updatedBy ?? '—'} em {formatDateTime(standard.updatedAt)}
          </p>
        ) : (
          <p className="mr-auto text-xs text-ink-subtle">Padrão inicial da plataforma.</p>
        )}
        <Button type="submit" variant="primary" loading={update.isPending}>
          {update.isPending ? null : <Save aria-hidden />}
          Salvar padrão
        </Button>
      </div>
    </form>
  );
}

/** Configurações → Padrão de Edição (manual dos agentes de edição dos reels). */
export function EditingStandardPanel() {
  const standard = useEditingStandard();
  if (standard.isPending) return <Skeleton className="h-96" />;
  if (standard.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o Padrão de Edição"
        error={standard.error}
        onRetry={() => void standard.refetch()}
      />
    );
  }
  return (
    <EditingStandardForm key={standard.data.updatedAt ?? 'inicial'} standard={standard.data} />
  );
}
