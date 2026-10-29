import { useState } from 'react'
import { useIntl } from 'react-intl'
import ReactPlayer from 'react-player'
import type { Config } from 'react-player'
import type { VideoNode } from '../types'
import { cn } from '../lib/utils'
import { useMediaInView } from '../lib/use-media-in-view'
import { useVideoPlayer } from '../lib/use-video-player'
import { usePageId, usePlayerActions, usePlayerState } from '../lib/player-context'
import { videoRequirementProgress, watchedVideoSeconds } from '../lib/video-requirements'
import { MediaFrame } from './MediaFrame'
import { Progress } from './ui/progress'

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
 * The provider player is mounted only once its frame approaches the viewport, so
 * a heavy iframe/player never loads on first paint; until the provider reports a
 * usable media duration a static placeholder fills the same reserved 16:9 box, so
 * the media never causes a layout shift. Native playback letterboxes inside that
 * box (`object-contain`) rather than being stretched, and embedded providers fill
 * it as before.
 */
export function Video({ node }: { node: VideoNode }) {
  const intl = useIntl()
  const label = node.title ?? intl.formatMessage({ id: 'video.label' })
  const captionsLabel = intl.formatMessage({ id: 'video.captions' })
  const errorMessage = intl.formatMessage({ id: 'video.error' })
  const pageId = usePageId()
  const state = usePlayerState()
  const actions = usePlayerActions()
  if (!pageId) {
    throw new Error('Video must be rendered within a PageProvider')
  }
  const pageState = state.pages[pageId]
  const player = useVideoPlayer({
    position: pageState?.videos?.[node.id],
    minWatchTime: node.minWatchTime,
    duration: node.duration,
    watchedUntil: watchedVideoSeconds(pageState, node.id),
    onPosition: (seconds) => actions.setVideoPosition(pageId, node.id, seconds),
    onWatched: (seconds) => actions.setVideoWatchedUntil(pageId, node.id, seconds)
  })
  const requirement = videoRequirementProgress(node, pageState)
  const requirementLabel = requirement
    ? requirement.complete
      ? intl.formatMessage({ id: 'video.requiredComplete' })
      : intl.formatMessage({ id: 'video.requiredProgress' }, { percent: requirement.percent })
    : undefined
  const { ref, inView } = useMediaInView<HTMLDivElement>()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const isEmbedded = node.provider !== 'native'

  // `onReady` is only the binding's restore probe: for YouTube it fires when the
  // iframe API loads, before the video is cued, so revealing the frame there
  // would expose the provider's black iframe. The first usable duration is the
  // earliest the media is genuinely rendered, so that is what reveals the frame.
  const onDuration = (duration: number) => {
    if (player.onDuration(duration)) {
      setReady(true)
    }
  }

  return (
    <figure>
      <MediaFrame
        ref={ref}
        role="group"
        aria-label={label}
        ready={ready}
        kind="video"
        error={failed ? errorMessage : undefined}
        className={cn(
          'rounded-2xl border not-prose',
          isEmbedded && '[&_iframe]:h-full [&_iframe]:w-full',
          !isEmbedded && '[&_video]:object-contain'
        )}
      >
        {inView && !failed ? (
          <ReactPlayer
            ref={player.ref}
            url={node.src}
            controls
            playsinline
            width="100%"
            height="100%"
            progressInterval={PROGRESS_INTERVAL_MS}
            config={playerConfig(node, label, captionsLabel)}
            onReady={player.onReady}
            onDuration={onDuration}
            onError={() => setFailed(true)}
            onPlay={player.onPlay}
            onProgress={player.onProgress}
            onPause={player.onPause}
            onSeek={player.onSeek}
            onBuffer={player.onBuffer}
            onBufferEnd={player.onBufferEnd}
            onEnded={player.onEnded}
          />
        ) : null}
      </MediaFrame>
      {requirement ? (
        <div
          data-video-requirement
          data-complete={requirement.complete ? 'true' : 'false'}
          className="not-prose mt-3 space-y-2"
        >
          <p className="text-sm text-muted-foreground">{requirementLabel}</p>
          <Progress value={requirement.percent} aria-label={requirementLabel} className="h-1.5" />
        </div>
      ) : null}
      {node.title ? <figcaption>{node.title}</figcaption> : null}
    </figure>
  )
}
