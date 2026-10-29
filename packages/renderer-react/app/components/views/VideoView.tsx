import { useState, type ComponentProps, type ReactNode } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import ReactPlayer from 'react-player'
import type { Config } from 'react-player'
import { Play } from 'lucide-react'
import type { VideoProvider } from '../../types'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import { cn } from '../../lib/utils'
import { useMediaInView } from '../../lib/use-media-in-view'
import { useVideoPlayer } from '../../lib/use-video-player'
import { usePageId, usePlayerActions, usePlayerState } from '../../lib/player-context'
import { videoRequirementProgress, watchedVideoSeconds } from '../../lib/video-requirements'
import { AspectRatio } from '../ui/aspect-ratio'
import { Progress } from '../ui/progress'
import { Skeleton } from '../ui/skeleton'
import type { ContentNodeViewProps } from './types'

/**
 * How often ReactPlayer reports a progress tick while playing. Coarse on
 * purpose: the binding still throttles persistence, so this only bounds how
 * promptly a pause reads a recent position.
 */
const PROGRESS_INTERVAL_MS = 1000

/** Formats an author-facing watch duration as localized minutes and seconds. */
function formatWatchTime(intl: IntlShape, seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(wholeSeconds / 60)
  const remainder = wholeSeconds % 60
  const paddedRemainder = intl.formatNumber(remainder, {
    minimumIntegerDigits: 2,
    useGrouping: false
  })
  return `${intl.formatNumber(minutes)}:${paddedRemainder}`
}

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
export function VideoView({ node, anchor }: ContentNodeViewProps<'video'>) {
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
    watchSeconds: watchedVideoSeconds(pageState, node.id),
    onPosition: (seconds) => actions.setVideoPosition(pageId, node.id, seconds),
    onWatchSeconds: (seconds) => actions.setVideoWatchSeconds(pageId, node.id, seconds)
  })
  const requirement = videoRequirementProgress(node, pageState)
  const requirementLabel = requirement
    ? requirement.complete
      ? intl.formatMessage({ id: 'video.requiredComplete' })
      : intl.formatMessage(
          { id: 'video.requiredProgress' },
          {
            watched: formatWatchTime(intl, requirement.watched),
            required: formatWatchTime(intl, requirement.required)
          }
        )
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
    <div {...readingAnchorAttributes(anchor)}>
      <figure>
        <VideoFrame
          ref={ref}
          role="group"
          aria-label={label}
          ready={ready}
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
              onPlaybackRateChange={player.onPlaybackRateChange}
              onEnded={player.onEnded}
            />
          ) : null}
        </VideoFrame>
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
    </div>
  )
}

interface VideoFrameProps extends ComponentProps<'div'> {
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
function VideoFrame({ ready, error, poster, className, children, ...props }: VideoFrameProps) {
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
