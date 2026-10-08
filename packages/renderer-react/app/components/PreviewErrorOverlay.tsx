import { TriangleAlert } from 'lucide-react';
import type { Locale } from '../lib/i18n';
import { useI18n } from '../lib/use-i18n';

export interface PreviewErrorOverlayProps {
  message: string;
}

interface PreviewMessages {
  contentError: string;
  contentErrorHint: string;
}

/**
 * Kept local (rather than in the shared player dictionary) so the dev-only
 * copy stays beside the component it belongs to.
 */
const PREVIEW_MESSAGES: Record<Locale, PreviewMessages> = {
  en: {
    contentError: 'Content error',
    contentErrorHint:
      'Fix the content and save. The preview reloads automatically once the content is valid again.',
  },
  'pt-BR': {
    contentError: 'Erro de conteúdo',
    contentErrorHint:
      'Corrija o conteúdo e salve. A pré-visualização recarrega automaticamente assim que o conteúdo for válido novamente.',
  },
};

/**
 * Author-facing overlay shown when `scorm dev` reports a content error.
 *
 * It is intentionally non-blocking (a bottom banner rather than a full-screen
 * modal) so the last valid preview stays inspectable while the author fixes the
 * content. The dev server clears it and reloads on the next successful update.
 */
export function PreviewErrorOverlay({ message }: PreviewErrorOverlayProps) {
  const { locale } = useI18n();
  const copy = PREVIEW_MESSAGES[locale];

  return (
    <div
      role='alert'
      aria-live='assertive'
      className='pointer-events-none fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6'
    >
      <div className='pointer-events-auto mx-auto flex max-w-3xl items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-foreground shadow-lg backdrop-blur'>
        <TriangleAlert
          aria-hidden='true'
          className='mt-0.5 size-5 shrink-0 text-destructive'
        />
        <div className='min-w-0 flex-1 space-y-1'>
          <p className='font-medium'>{copy.contentError}</p>
          <p className='break-words text-sm text-muted-foreground'>{message}</p>
          <p className='text-xs text-muted-foreground'>
            {copy.contentErrorHint}
          </p>
        </div>
      </div>
    </div>
  );
}
