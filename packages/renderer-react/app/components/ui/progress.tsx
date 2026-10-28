import * as React from 'react'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from 'cn'

function Progress({
  className,
  value,
  ...props
}: Omit<ProgressPrimitive.Root.Props, 'value'> & {
  value?: number | null
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value === undefined ? 0 : value}
      className={cn(
        'relative flex h-3 w-full items-center overflow-x-hidden rounded-full bg-muted',
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Track data-slot="progress-track" className="size-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full bg-primary transition-all"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
