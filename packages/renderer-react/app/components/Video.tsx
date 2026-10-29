import { useState } from 'react'
import { useIntl } from 'react-intl'
import ReactPlayer from 'react-player'
import type { Config } from 'react-player'
import type { VideoNode, VideoProvider } from '../types'
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
 * The provider-specific configuration ReactPlayer needs for an embedded video.
 * Provider selection stays canonical in the parsed AST, so this never inspects
 * the source URL. YouTube receives the stable resume position through
 * `playerVars.start`, which lands with the cued video instead of seeking during
 * iframe initialization; Vimeo keeps an accessible iframe title and is restored
 * imperatively by the binding.
 */
function playerConfig(
  provider: VideoProvider,
  label: string,
  startSeconds: number | undefined
): Config {
  switch (provider) {
    case 'vimeo':
      return { vimeo: { title: label } }
    case 'youtube':
      // `start` is intentionally fixed for the component lifetime: ReactPlayer
      // applies it only when it creates or cues the iframe.
      return startSeconds === undefined || startSeconds === 0
        ? {}
        : { youtube: { playerVars: { start: startSeconds } } }
  }
}

/**
 * Renders an embedded video node through ReactPlayer, which owns provider
 * selection (YouTube, Vimeo) and the provider's own controls — so no player
 * chrome is duplicated here. Only resume/persist behaviour is added, through
 * the semantic {@link useVideoPlayer} binding, never by reading the source URL.
 *
 * The provider player is mounted only once its frame approaches the viewport, so
 * a heavy iframe never loads on first paint; until the provider reports a usable
 * media duration the optional authored poster (or a static placeholder) fills
 * the same reserved 16:9 box, so the media never causes a layout shift. A failed
 * provider is replaced by a readable error instead of an iframe stuck on a black
 * frame.
 */
export function Video({ node }: { node: VideoNode }) {
  const intl = useIntl()
  const label = node.title ?? intl.formatMessage({ id: 'video.label' })
  const errorMessage = intl.formatMessage({ id: 'video.error' })
  const pageId = usePageId()
  const state = usePlayerState()
  const actions = usePlayerActions()
  if (!pageId) {
    throw new Error('Video must be rendered within a PageProvider')
  }
  const pageState = state.pages[pageId]
  const player = useVideoPlayer({
    provider: node.provider,
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

  // `onReady` is only the binding's imperative restore probe (Vimeo). For
  // YouTube it fires when the iframe API loads, before the video is cued, so
  // revealing the frame there would expose the provider's black iframe. The
  // first usable duration is the earliest the media is genuinely rendered, so
  // that is what reveals the frame for both providers.
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
        poster={node.poster}
        error={failed ? errorMessage : undefined}
        className={cn('rounded-2xl border not-prose', '[&_iframe]:h-full [&_iframe]:w-full')}
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
            config={playerConfig(node.provider, label, player.initialSeconds)}
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
