import { useIntl } from 'react-intl'
import ReactPlayer from 'react-player'
import type { Config } from 'react-player'
import type { VideoNode } from '../types'
import { cn } from '../lib/utils'
import { useVideoPlayer } from '../lib/use-video-player'

export interface VideoProps {
  node: VideoNode
  /** Restored semantic position in seconds, applied once the player is ready. */
  position?: number
  /** Reports a semantic position in seconds for persistence. */
  onPosition?: (seconds: number) => void
}

/**
 * How often ReactPlayer reports a progress tick while playing. Coarse on
 * purpose: the binding still throttles persistence, so this only bounds how
 * promptly a pause reads a recent position.
 */
const PROGRESS_INTERVAL_MS = 1000

/**
 * BCP 47 tag for an undetermined language: the AST only carries a caption track
 * path, so we must not invent a specific locale.
 */
const CAPTIONS_LANGUAGE = 'und'

/**
 * The provider-specific configuration ReactPlayer needs to preserve the
 * authored title/poster/captions. Provider selection stays canonical in the
 * parsed AST, so this never inspects the source URL. Native playback is the only
 * provider that renders poster and caption tracks; Vimeo exposes an iframe
 * title; YouTube is served by ReactPlayer's own defaults.
 */
function playerConfig(node: VideoNode, label: string, captionsLabel: string): Config {
  switch (node.provider) {
    case 'native':
      return {
        file: {
          attributes: {
            // ReactPlayer eagerly preloads by default; the authored player only
            // fetched metadata, so keep that and avoid downloading every video.
            preload: 'metadata',
            ...(node.poster ? { poster: node.poster } : {})
          },
          tracks: node.captions
            ? [
                {
                  kind: 'captions',
                  src: node.captions,
                  srcLang: CAPTIONS_LANGUAGE,
                  label: captionsLabel,
                  default: true
                }
              ]
            : []
        }
      }
    case 'vimeo':
      return { vimeo: { title: label } }
    case 'youtube':
      return {}
  }
}

/**
 * Renders a video node through ReactPlayer, which owns provider selection
 * (native file, YouTube, Vimeo) and the provider's own controls — so no player
 * chrome is duplicated here. Only restore/persist behaviour is added, through
 * the semantic {@link useVideoPlayer} binding, never by reading the source URL.
 *
 * The container reserves a stable 16:9 box for embedded providers so their
 * iframe never causes a layout shift; native playback keeps its intrinsic
 * aspect ratio.
 */
export function Video({ node, position, onPosition }: VideoProps) {
  const intl = useIntl()
  const label = node.title ?? intl.formatMessage({ id: 'video.label' })
  const captionsLabel = intl.formatMessage({ id: 'video.captions' })
  const player = useVideoPlayer({ position, onPosition })
  const isEmbedded = node.provider !== 'native'

  return (
    <figure>
      <div
        role="group"
        aria-label={label}
        className={cn(
          'w-full overflow-hidden rounded-2xl border not-prose',
          isEmbedded && 'aspect-video [&_iframe]:h-full [&_iframe]:w-full'
        )}
      >
        <ReactPlayer
          ref={player.ref}
          url={node.src}
          controls
          playsinline
          width="100%"
          height={isEmbedded ? '100%' : 'auto'}
          progressInterval={PROGRESS_INTERVAL_MS}
          config={playerConfig(node, label, captionsLabel)}
          onReady={player.onReady}
          onDuration={player.onDuration}
          onPlay={player.onPlay}
          onProgress={player.onProgress}
          onPause={player.onPause}
          onSeek={player.onSeek}
          onEnded={player.onEnded}
        />
      </div>
      {node.title ? <figcaption>{node.title}</figcaption> : null}
    </figure>
  )
}
