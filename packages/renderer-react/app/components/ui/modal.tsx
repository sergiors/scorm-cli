import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Button } from './button';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A self-contained accessible dialog. It traps focus, closes on Escape or a
 * backdrop click, restores focus to the previously focused element, and exposes
 * `role="dialog"` + `aria-modal` semantics.
 *
 * This is deliberately framework-light: the package ships no Radix dialog
 * dependency, and the native `<dialog>` element is not used because it is not
 * available in every embedding target (nor in the test environment).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    const focusable = (): HTMLElement[] =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        : [];

    const initial = focusable()[0] ?? panel;
    initial?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const nodes = focusable();
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      <div
        aria-hidden='true'
        onClick={() => onCloseRef.current()}
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
      />
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg focus-visible:outline-none',
          className,
        )}
      >
        <div className='mb-4 flex items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h2 id={titleId} className='text-xl font-semibold tracking-tight'>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className='text-sm text-muted-foreground'>
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() => onCloseRef.current()}
            aria-label='Close dialog'
          >
            <X aria-hidden='true' />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
