'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/features/instagram/tela/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/features/instagram/tela/ui/dialog';
import { InlineAlert } from '@/features/instagram/tela/ui/feedback';
import { Field } from '@/features/instagram/tela/ui/field';
import { Textarea } from '@/features/instagram/tela/ui/input';
import { errorMessage } from '@/features/instagram/tela/lib/api/errors';
import { validateNote } from '../lib/review-rules';

interface NoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'suggestion' | 'reason';
  title: string;
  description: ReactNode;
  fieldLabel: string;
  placeholder: string;
  hint: string;
  submitLabel: string;
  submitVariant: 'changes' | 'danger-solid';
  pending: boolean;
  error: unknown;
  onSubmit: (text: string) => void;
}

/** Diálogo com um texto obrigatório (sugestão de ajuste ou motivo de reprovação). */
function NoteDialog({
  open,
  onOpenChange,
  kind,
  title,
  description,
  fieldLabel,
  placeholder,
  hint,
  submitLabel,
  submitVariant,
  pending,
  error,
  onSubmit,
}: NoteDialogProps) {
  const [text, setText] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setText('');
      setValidation(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title={title} description={description}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateNote(text, kind);
            setValidation(problem);
            if (!problem) onSubmit(text.trim());
          }}
        >
          <Field label={fieldLabel} hint={hint} error={validation ?? undefined} required>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (validation) setValidation(validateNote(event.target.value, kind));
              }}
              placeholder={placeholder}
              rows={5}
              autoFocus
              required
            />
          </Field>
          {error ? (
            <InlineAlert className="mt-4" title="Não foi possível registrar a decisão">
              {errorMessage(error)}
            </InlineAlert>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant={submitVariant} loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: unknown;
  onSubmit: (text: string) => void;
}

export function RequestChangesDialog(props: DecisionDialogProps) {
  return (
    <NoteDialog
      {...props}
      kind="suggestion"
      title="Reprovar e voltar para edição"
      description="A peça volta para a edição (vídeo ou imagens) com o seu motivo. A mídia guardada e a tradução já aprovadas são reaproveitadas; a nova versão volta para a sua aprovação."
      fieldLabel="Motivo"
      placeholder="Ex.: O CTA cobre o rosto no final e o gancho ficou fraco; use uma pergunta."
      hint="Seja específico: o que mudar na edição e por quê. A legenda também é refeita com este motivo."
      submitLabel="Voltar para edição"
      submitVariant="changes"
    />
  );
}

export function RejectDialog(props: DecisionDialogProps) {
  return (
    <NoteDialog
      {...props}
      kind="reason"
      title="Reprovar adaptação"
      description="Encerra a peça: ela não será publicada neste mercado. Não é possível desfazer."
      fieldLabel="Motivo"
      placeholder="Ex.: O tema não faz sentido para o público deste mercado."
      hint="O motivo fica registrado no histórico da peça."
      submitLabel="Reprovar"
      submitVariant="danger-solid"
    />
  );
}
