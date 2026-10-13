import * as React from 'react'
import { cn } from 'cn'

/**
 * A shadcn/ui-shaped loading placeholder. It is deliberately inert (no text, no
 * motion beyond the pulse) so it can stand in for page content while a lazily
 * loaded Page module resolves without announcing anything to assistive
 * technology — the surrounding region marks itself `aria-hidden`.
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
