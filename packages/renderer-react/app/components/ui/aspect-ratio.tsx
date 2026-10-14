import * as React from 'react'
import { cn } from 'cn'
import { AspectRatio as AspectRatioPrimitive } from 'radix-ui'

function AspectRatio({
  className,
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" className={cn(className)} {...props} />
}

export { AspectRatio }
