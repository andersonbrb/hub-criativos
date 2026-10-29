'use client';

import { EditCaptionInputSchema } from '@sbs/contracts';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/features/instagram/tela/ui/button';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Input, Textarea } from '@/features/instagram/tela/ui/input';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { cn } from '@/features/instagram/tela/lib/cn';
import { formatNumber } from '@/features/instagram/tela/lib/format';
import { useEditCaption } from '../hooks/use-content-piece';
import {
  CAPTION_LIMIT,
  HASHTAG_LIMIT,
  formatHashtags,
  parseHashtags,
  publishedLength,
} from '../lib/review-rules';

export function CaptionText({
  caption,
  hashtags,
}: {
  caption: string;
  hashtags: readonly string[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed whitespace-pre-line text-ink">
        {caption || <span className="text-ink-subtle">Sem legenda.</span>}
      </p>
      {hashtags.length > 0 ? (
        <p className="text-sm leading-relaxed text-primary">{formatHashtags(hashtags)}</p>
      ) : null}
    </div>
  );
}

interface CaptionEditorProps {
  pieceId: string;
  caption: string;
  hashtags: readonly string[];
}

/** Edição da legenda e das hashtags da revisão atual (PUT caption). */
export function CaptionEditor({ pieceId, caption, hashtags }: CaptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draftCaption, setDraftCaption] = useState(caption);
  const [draftTags, setDraftTags] = useState(formatHashtags(hashtags));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const mutation = useEditCaption(pieceId);

  const parsedTags = parseHashtags(draftTags);
  const length = publishedLength(draftCaption, parsedTags);
  const overLimit = length > CAPTION_LIMIT;

  function startEditing() {
    setDraftCaption(caption);
    setDraftTags(formatHashtags(hashtags));
    setFieldErrors({});
    mutation.reset();
    setEditing(true);
  }

  function save() {
    const input = { caption: draftCaption, hashtags: parsedTags };
    const parsed = EditCaptionInputSchema.safeParse(input);
    const errors: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'hashtags' ? 'hashtags' : 'caption';
        errors[key] ??=
          key === 'hashtags'
            ? issue.code === 'too_big'
              ? `Use no máximo ${HASHTAG_LIMIT} hashtags.`
              : 'Hashtags aceitam só letras, números e _.'
            : `A legenda pode ter no máximo ${formatNumber(CAPTION_LIMIT)} caracteres.`;
      }
    }
    if (overLimit) {
      errors['caption'] ??=
        `Legenda e hashtags somam ${formatNumber(length)} caracteres; o limite é ${formatNumber(CAPTION_LIMIT)}.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !parsed.success) return;
    mutation.mutate(parsed.data, {
      onSuccess: (piece) => {
        const review = piece.currentRevision.aiReview;
        if (review?.hasBlockingIssues) {
          toast.warning('Legenda salva, mas não pode ser aprovada assim', {
            description:
              'A revisão automática da nova legenda encontrou um problema que impede a aprovação. Veja os detalhes e edite de novo.',
          });
        } else {
          toast.success('Legenda salva e revisada', {
            description: review
              ? `A revisão automática da nova legenda deu nota ${formatNumber(review.score)}.`
              : undefined,
          });
        }
        setEditing(false);
      },
    });
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <CaptionText caption={caption} hashtags={hashtags} />
        <Button size="sm" variant="ghost" className="-ml-3" onClick={startEditing}>
          <Pencil aria-hidden />
          Editar legenda
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field label="Legenda" error={fieldErrors['caption']}>
        <Textarea
          value={draftCaption}
          onChange={(event) => setDraftCaption(event.target.value)}
          rows={8}
          autoFocus
        />
      </Field>
      <Field
        label="Hashtags"
        hint="Separe por espaço. O # é opcional."
        error={fieldErrors['hashtags']}
      >
        <Input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} />
      </Field>
      <p className={cn('text-xs tabular-nums', overLimit ? 'text-danger' : 'text-ink-subtle')}>
        {formatNumber(length)} de {formatNumber(CAPTION_LIMIT)} caracteres, {parsedTags.length} de{' '}
        {HASHTAG_LIMIT} hashtags
      </p>
      {mutation.isPending ? (
        <p className="text-xs text-ink-muted" role="status">
          Revisando a nova legenda com as regras e a IA. Pode levar alguns segundos.
        </p>
      ) : null}
      {mutation.isError ? (
        <InlineAlert title="Não foi possível salvar a legenda">
          {errorMessage(mutation.error)}
        </InlineAlert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={mutation.isPending}>
          Salvar legenda
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={mutation.isPending}
        >
          Descartar
        </Button>
      </div>
    </form>
  );
}
