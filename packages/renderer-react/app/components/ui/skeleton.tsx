import * as React from 'react'
import { cn } from 'cn'

/**
 * A shadcn/ui-shaped loading placeholder: a plain, decorative block with no text
 * and no motion of its own beyond the default `animate-pulse` from its own
 * classes. It carries no accessibility semantics — no `role`, no status text and
 * no `aria-hidden` — so that decision belongs to the caller: a consumer chooses
 * whether the placeholder is inert decoration or announces a pending state (for
 * example a `role="status"` region with visually hidden text, or a static
 * placeholder via `animate-none`).
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}

export { Skeleton }
