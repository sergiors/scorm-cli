import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/utils'
import { AspectRatio } from './ui/aspect-ratio'
import { Skeleton } from './ui/skeleton'

export interface MediaFrameProps extends ComponentProps<'div'> {
  /**
   * Whether the media inside has reported it is loaded/ready. Until then a
   * static placeholder fills the frame so the reserved geometry never collapses.
   */
  ready: boolean
  /**
   * A readable message to show when the media could not be loaded. It replaces
   * the loading placeholder, so a failed image or video never leaves the frame
   * showing a placeholder (or a provider's black player) forever.
   */
  error?: ReactNode
}

/**
 * The reserved frame shared by every authored media block (a block image or a
 * video). The AST carries no intrinsic media dimensions, so a stable 16:9 box
 * is reserved through the shadcn {@link AspectRatio} primitive to prevent layout
 * shift while the media loads; the media itself is expected to `object-contain`
 * inside it, keeping portrait or arbitrarily shaped content uncropped rather
 * than stretched. Until the media reports {@link MediaFrameProps.ready}, a small
 * non-animated shadcn skeleton fills the same geometry — the frame has no
 * shimmer, fade or transition of its own.
 *
 * A {@link MediaFrameProps.error} message takes over from the placeholder: a
 * failed load is a settled state, so it shows a small static error instead of
 * leaving the reserved box waiting on media that will never arrive.
 */
export function MediaFrame({ ready, error, className, children, ...props }: MediaFrameProps) {
  return (
    <AspectRatio
      ratio={16 / 9}
      data-slot="media-frame"
      className={cn('relative w-full overflow-hidden', className)}
      {...props}
    >
      {children}
      {error ? (
        <div
          role="alert"
          data-slot="media-frame-error"
          className="absolute inset-0 flex items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground"
        >
          {error}
        </div>
      ) : ready ? null : (
        <Skeleton aria-hidden="true" className="absolute inset-0 animate-none rounded-none" />
      )}
    </AspectRatio>
  )
}
