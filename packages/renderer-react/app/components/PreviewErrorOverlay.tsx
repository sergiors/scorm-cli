import { TriangleAlert } from 'lucide-react';

export interface PreviewErrorOverlayProps {
  message: string;
}

/**
 * Author-facing overlay shown when `scorm dev` reports a content error.
 *
 * It is intentionally non-blocking (a bottom banner rather than a full-screen
 * modal) so the last valid preview stays inspectable while the author fixes the
 * content. The dev server clears it and reloads on the next successful update.
 */
export function PreviewErrorOverlay({ message }: PreviewErrorOverlayProps) {
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
          <p className='font-medium'>Content error</p>
          <p className='break-words text-sm text-muted-foreground'>{message}</p>
          <p className='text-xs text-muted-foreground'>
            Fix the content and save. The preview reloads automatically once the
            content is valid again.
          </p>
        </div>
      </div>
    </div>
  );
}
