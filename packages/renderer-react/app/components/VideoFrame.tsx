import type { ComponentProps, ReactNode } from 'react'
import { Play } from 'lucide-react'
import { cn } from '../lib/utils'
import { AspectRatio } from './ui/aspect-ratio'
import { Skeleton } from './ui/skeleton'

export interface VideoFrameProps extends ComponentProps<'div'> {
  /**
   * Whether the provider player has reported a usable duration. Until then the
   * static placeholder fills the frame so the reserved geometry never collapses.
   */
  ready: boolean
  /**
   * A readable message to show when the provider failed to load. It replaces the
   * loading placeholder, so a failed video never leaves the frame showing a
   * placeholder (or a provider's black player) forever.
   */
  error?: ReactNode
  /** Optional authored poster shown until the provider player is ready. */
  poster?: string
}

/**
 * The reserved frame owned by an authored video. The AST carries no intrinsic
 * dimensions, so a stable 16:9 box is reserved through the shadcn
 * {@link AspectRatio} primitive to prevent layout shift while the provider
 * player loads. An optional poster uses `object-contain`; until the player
 * reports {@link VideoFrameProps.ready}, it fills the frame. Without a poster,
 * a low-fidelity player silhouette stands in (see {@link VideoPlaceholder}).
 * The frame has no shimmer, fade or transition of its own.
 *
 * A {@link VideoFrameProps.error} message takes over from the placeholder: a
 * failed load is a settled state, so it shows a small static error instead of
 * leaving the reserved box waiting on media that will never arrive.
 */
export function VideoFrame({
  ready,
  error,
  poster,
  className,
  children,
  ...props
}: VideoFrameProps) {
  return (
    <AspectRatio
      ratio={16 / 9}
      data-slot="video-frame"
      className={cn('relative w-full overflow-hidden', className)}
      {...props}
    >
      {children}
      {error ? (
        <div
          role="alert"
          data-slot="video-frame-error"
          className="absolute inset-0 flex items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground"
        >
          {error}
        </div>
      ) : ready ? null : poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          data-slot="video-frame-poster"
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <VideoPlaceholder />
      )}
    </AspectRatio>
  )
}

/**
 * A low-fidelity player silhouette standing in for a video that has not rendered
 * yet: the same static fill an image placeholder uses, with a subdued play glyph
 * drawn from the existing shadcn {@link Skeleton}. It is purely decorative — no
 * shimmer, fade or transition, and no functional or focusable control — and is
 * marked `aria-hidden`, so assistive tech reads the frame's own accessible label
 * rather than a fake player.
 */
function VideoPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-slot="video-frame-placeholder"
      data-kind="video"
      className="absolute inset-0"
    >
      <Skeleton className="absolute inset-0 animate-none rounded-none" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted-foreground/15">
          <Play className="size-5 fill-muted-foreground/50 stroke-none" />
        </div>
      </div>
    </div>
  )
}
