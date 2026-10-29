'use client';

import type { FloraImageModels, ProductionOptions, ReferencePost } from '@sbs/contracts';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { Skeleton } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Select } from '@/features/instagram/tela/ui/input';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { cn } from '@/features/instagram/tela/lib/cn';
import { useFloraImageModels } from '../hooks/use-reference';

type Translation = ProductionOptions['videoTranslation'];
type Mode = ProductionOptions['heygenMode'];

const TRANSLATIONS: { value: Translation; title: string; description: string }[] = [
  {
    value: 'auto',
    title: 'Automática (recomendado)',
    description:
      'A IA olha o vídeo: alguém falando para a câmera vai para o HeyGen; narração sem rosto, para a ElevenLabs.',
  },
  {
    value: 'heygen',
    title: 'HeyGen',
    description: 'Tradução completa com voz clonada e sincronia labial. Para quem fala na câmera.',
  },
  {
    value: 'elevenlabs',
    title: 'ElevenLabs',
    description: 'Dublagem da voz, sem mexer na imagem. Para narração, oração e trilha.',
  },
];

// No hub o HeyGen traduz sempre no modo rápido (contexto do Sávio: no Precisão a boca segue o idioma original nas
// pausas do áudio novo).
const MODES: { value: Mode; title: string; description: string }[] = [
  { value: 'speed', title: 'Rápido', description: 'Fica pronto em minutos. É o modo de todo o hub.' },
];

function OptionCard({
  name,
  checked,
  title,
  description,
  onSelect,
}: {
  name: string;
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
        checked ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-sunken',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 accent-[var(--color-primary)]"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-muted">{description}</span>
      </span>
    </label>
  );
}

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 3,
});

function modelLabel(model: FloraImageModels['models'][number]): string {
  return [
    model.name,
    model.costUsd !== null ? `${usd.format(model.costUsd)} por imagem` : null,
    model.seconds !== null ? `~${model.seconds} s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Modelo da FLORA para adaptar as imagens (slides do carrossel ou capa do reel). */
function ImageModelField({
  isReel,
  value,
  onChange,
}: {
  isReel: boolean;
  value: string | null;
  onChange: (model: string) => void;
}) {
  const flora = useFloraImageModels(true);
  const what = isReel ? 'a capa' : 'cada slide';
  return (
    <fieldset className="mt-5 space-y-2">
      <legend className="mb-2 text-sm font-semibold text-ink">Imagens (FLORA)</legend>
      {flora.isPending ? (
        <Skeleton className="h-9" />
      ) : flora.isError ? (
        <p className="text-xs text-danger">
          Não foi possível listar os modelos da FLORA: {errorMessage(flora.error)}. Vale o modelo
          padrão.
        </p>
      ) : !flora.data.connected ? (
        <p className="text-xs text-ink-muted">
          FLORA não conectada: {what} segue com o texto original. Conecte em Configurações →
          Integrações.
        </p>
      ) : (
        <Field
          label="Modelo"
          hint={`A FLORA traduz o texto de ${what}, mantendo o design. Se o revisor reprovar uma imagem, só ela é refeita.`}
        >
          <Select
            value={value ?? flora.data.defaultModel}
            onChange={(event) => onChange(event.target.value)}
          >
            {flora.data.models.map((model) => (
              <option key={model.id} value={model.id}>
                {modelLabel(model)}
                {model.id === flora.data.defaultModel ? ' (recomendado)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </fieldset>
  );
}

export interface SelectPostDialogProps {
  /** O post a selecionar (`null` fecha o diálogo). */
  post: ReferencePost | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (production: ProductionOptions) => void;
}

/** Escolhas de produção antes de selecionar: tradução do vídeo (reel) e modelo das imagens. */
export function SelectPostDialog({ post, busy, onCancel, onConfirm }: SelectPostDialogProps) {
  const [translation, setTranslation] = useState<Translation>('auto');
  const [mode, setMode] = useState<Mode>('speed');
  const [imageModel, setImageModel] = useState<string | null>(null);
  const isReel = post?.format === 'reel';

  return (
    <Dialog open={post !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent
        title={isReel ? 'Selecionar reel' : 'Selecionar carrossel'}
        description={
          isReel
            ? 'Uma adaptação para cada mercado ativo. Escolha como o vídeo e a capa serão adaptados.'
            : 'Uma adaptação para cada mercado ativo. Escolha o modelo que adapta os slides.'
        }
      >
        {isReel ? <ReelOptions {...{ translation, setTranslation, mode, setMode }} /> : null}

        <ImageModelField isReel={isReel} value={imageModel} onChange={setImageModel} />

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              onConfirm({ videoTranslation: translation, heygenMode: mode, imageModel })
            }
          >
            {busy ? null : <Check aria-hidden />}
            Selecionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReelOptions({
  translation,
  setTranslation,
  mode,
  setMode,
}: {
  translation: Translation;
  setTranslation: (value: Translation) => void;
  mode: Mode;
  setMode: (value: Mode) => void;
}) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Tradução do vídeo</legend>
        {TRANSLATIONS.map((option) => (
          <OptionCard
            key={option.value}
            name="translation"
            checked={translation === option.value}
            title={option.title}
            description={option.description}
            onSelect={() => setTranslation(option.value)}
          />
        ))}
      </fieldset>

      {translation !== 'elevenlabs' ? (
        <fieldset className="mt-5 space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Modo do HeyGen</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((option) => (
              <OptionCard
                key={option.value}
                name="heygen-mode"
                checked={mode === option.value}
                title={option.title}
                description={option.description}
                onSelect={() => setMode(option.value)}
              />
            ))}
          </div>
          <p className="text-xs text-ink-subtle">
            Se o revisor reprovar a tradução, o HeyGen traduz de novo, no mesmo modo.
          </p>
        </fieldset>
      ) : null}
    </>
  );
}
