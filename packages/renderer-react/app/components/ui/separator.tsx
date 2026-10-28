import * as React from 'react'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from 'cn'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorPrimitive.Props & {
  /**
   * Kept for compatibility with the previous primitive. Base UI separators are
   * always exposed as `role="separator"`; a decorative separator mirrors the
   * old Radix behavior by rendering `role="none"`.
   */
  decorative?: boolean
}) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      {...(decorative ? { role: 'none' } : {})}
      className={cn(
        'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className
      )}
      {...props}
    />
  )
}

export { Separator }
