import { CheckCircle2 } from 'lucide-react';

export interface CompletionNoticeProps {
  complete: boolean;
}

export function CompletionNotice({ complete }: CompletionNoticeProps) {
  if (!complete) {
    return null;
  }

  return (
    <div
      role='status'
      aria-live='polite'
      className='flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-200'
    >
      <CheckCircle2 aria-hidden='true' className='size-5 shrink-0' />
      <div>
        <p className='font-medium'>Package complete</p>
        <p className='text-sm text-emerald-900/80 dark:text-emerald-200/80'>
          You have visited every item in this package.
        </p>
      </div>
    </div>
  );
}
