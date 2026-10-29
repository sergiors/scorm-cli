import { useState } from 'react'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import { AspectRatio } from '../ui/aspect-ratio'
import { Skeleton } from '../ui/skeleton'
import type { ContentNodeViewProps } from './types'

/**
 * A block image in a reserved 16:9 frame: the AST carries no intrinsic
 * dimensions, so the frame keeps a stable box and `object-contain` keeps
 * arbitrary or portrait images uncropped (letterboxed) inside it. The image
 * itself keeps native `loading="lazy"` for deferral, and a static placeholder
 * fills the frame until `onLoad` fires.
 *
 * A failed source settles the frame too: the placeholder yields so the browser's
 * own broken-image indicator and the authored `alt` text are visible, rather than
 * a placeholder that waits on an image that will never arrive.
 *
 * The frame is wrapped in a `figure` and marked `not-prose` for the same reason
 * the video frame is: `prose` gives a `figure` its block spacing while resetting
 * the margins of its direct children, so the framed image sits in the flow
 * without the prose image margins leaking into the reserved box.
 */
export function ImageView({ node, anchor }: ContentNodeViewProps<'image'>) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <figure {...readingAnchorAttributes(anchor)} className="not-prose space-y-2.5">
      <AspectRatio
        ratio={16 / 9}
        data-slot="media-frame"
        className="relative w-full overflow-hidden"
      >
        <img
          src={node.src}
          alt={node.alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
        {loaded || failed ? null : (
          <Skeleton aria-hidden="true" className="absolute inset-0 animate-none rounded-none" />
        )}
      </AspectRatio>
      {node.caption ? (
        <figcaption className="text-sm text-muted-foreground">{node.caption}</figcaption>
      ) : null}
    </figure>
  )
}
