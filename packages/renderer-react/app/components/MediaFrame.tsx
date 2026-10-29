import type { ComponentProps, ReactNode } from 'react'
import { Play } from 'lucide-react'
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
  /** Optional media preview shown until the frame reports it is ready. */
  poster?: string
  /**
   * The authored media the frame reserves geometry for. Both kinds share the
   * same static fill, but a `'video'` adds a low-fidelity player silhouette (a
   * subdued play glyph and a bottom progress/control row) so the reserved box
   * reads as a player rather than an empty block. Defaults to `'image'`.
   */
  kind?: 'image' | 'video'
}

/**
 * The reserved frame shared by every authored media block (a block image or a
 * video). The AST carries no intrinsic media dimensions, so a stable 16:9 box
 * is reserved through the shadcn {@link AspectRatio} primitive to prevent layout
 * shift while the media loads; poster previews and media itself use
 * `object-contain`, keeping portrait or arbitrarily shaped content uncropped
 * rather than stretched. Until the media reports {@link MediaFrameProps.ready},
 * an optional poster fills the frame; without one, a small non-animated shadcn
 * skeleton is used. A video without a poster additionally overlays a low-fidelity
 * player silhouette (see {@link VideoPlaceholder}); the frame has no shimmer,
 * fade or transition of its own.
 *
 * A {@link MediaFrameProps.error} message takes over from the placeholder: a
 * failed load is a settled state, so it shows a small static error instead of
 * leaving the reserved box waiting on media that will never arrive.
 */
export function MediaFrame({
  ready,
  error,
  poster,
  kind = 'image',
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
      ) : kind === 'video' ? (
        <VideoPlaceholder />
      ) : (
        <Skeleton aria-hidden="true" className="absolute inset-0 animate-none rounded-none" />
      )}
    </AspectRatio>
  )
}

/**
 * A low-fidelity player silhouette standing in for a video that has not rendered
 * yet: the same static fill an image placeholder uses, with a subdued play glyph
 * and a bottom progress/control row drawn from the shadcn {@link Skeleton}. It is
 * purely decorative — no shimmer, fade or transition, and no functional or
 * focusable control — and is marked `aria-hidden`, so assistive tech reads the
 * frame's own accessible label rather than a fake player.
 */
function VideoPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-slot="media-frame-placeholder"
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
