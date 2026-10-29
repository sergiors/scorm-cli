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
   * the loading placeholder, so a failed image never leaves the frame showing a
   * placeholder forever.
   */
  error?: ReactNode
  /** Optional media preview shown until the frame reports it is ready. */
  poster?: string
}

/**
 * The reserved frame for an authored block image. The AST carries no intrinsic
 * media dimensions, so a stable 16:9 box is reserved through the shadcn
 * {@link AspectRatio} primitive to prevent layout shift while the image loads;
 * the poster preview and the image itself use `object-contain`, keeping portrait
 * or arbitrarily shaped content uncropped rather than stretched. Until the image
 * reports {@link MediaFrameProps.ready}, an optional poster fills the frame;
 * without one, a small non-animated shadcn skeleton is used. The frame has no
 * shimmer, fade or transition of its own.
 *
 * A {@link MediaFrameProps.error} message takes over from the placeholder: a
 * failed load is a settled state, so it shows a small static error instead of
 * leaving the reserved box waiting on media that will never arrive.
 */
export function MediaFrame({
  ready,
  error,
  poster,
  className,
  children,
  ...props
}: MediaFrameProps) {
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
      ) : ready ? null : poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          data-slot="media-frame-poster"
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <Skeleton aria-hidden="true" className="absolute inset-0 animate-none rounded-none" />
      )}
    </AspectRatio>
  )
}
