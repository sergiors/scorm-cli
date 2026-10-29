import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type ReactPlayer from 'react-player'
import type { VideoProvider } from '../types'
import { requiredWatchSeconds } from './video-requirements'

/** Persistence cadence: a playing video is saved only once it moves this far. */
const PERSIST_INTERVAL_SECONDS = 5

/**
 * How far before the end a restored position is placed when the persisted value
 * is at or beyond the media duration. Seeking to the very end would leave the
 * player stopped on the final frame, so the restore rests just short of it
 * instead (bounded to zero for media shorter than the margin).
 */
const SEEK_END_MARGIN_SECONDS = 1

/**
 * Tolerance for provider timing variation when comparing a progress reading
 * with the media advance expected from elapsed wall time and playback rate.
 */
const WATCH_CLOCK_TOLERANCE_SECONDS = 1

/** How often accumulated watch time is written while it advances. */
const WATCH_PERSIST_INTERVAL_SECONDS = 1

/** The slice of ReactPlayer's progress event this binding consumes. */
export interface VideoProgress {
  playedSeconds: number
}

/**
 * The imperative slice of ReactPlayer's runtime surface the restore relies on.
 * ReactPlayer v2's public `seekTo` type declares only `(amount, type)`, but the
 * runtime forwards a third `keepPlaying` argument to the provider, whose default
 * is provider-specific: YouTube pauses (`false`), while Vimeo keeps playing
 * (`true`). This structural view adds only the missing parameter, so the restore
 * can demand a paused seek explicitly without widening the whole player to
 * `any`.
 */
interface SeekablePlayer {
  seekTo(amount: number, type: 'seconds' | 'fraction', keepPlaying: boolean): void
}

export interface VideoPlayerOptions {
  /**
   * The embedded provider. It decides how a restored position is applied: Vimeo
   * is seeked imperatively once the media knows its duration, while YouTube is
   * initialized with `playerVars.start` because seeking during its iframe
   * initialization can leave the player stuck on a black frame.
   */
  provider: VideoProvider
  /**
   * Restored semantic position in seconds. For YouTube it seeds the provider's
   * initial `start` parameter; for Vimeo it is applied once — and only once —
   * the provider has reported a usable media duration. Never used to autoplay: a
   * resume leaves the video paused at the saved spot.
   */
  position?: number
  /** Reports a semantic position in seconds for persistence. */
  onPosition?: (seconds: number) => void
  /** The authored minimum accumulated watch time, in seconds. */
  minWatchTime?: number
  /** The authored duration in seconds, used to bound the requirement. */
  duration?: number
  /**
   * The persisted accumulated active watch time in seconds. It is monotonic and
   * only used to restore progress toward the requirement.
   */
  watchSeconds?: number
  /** Reports a changed accumulated watch time in seconds for persistence. */
  onWatchSeconds?: (seconds: number) => void
}

/**
 * The exact subset of ReactPlayer's public surface this renderer binds to. The
 * player instance itself is never stored in React state or persisted; only its
 * imperative {@link VideoPlayerBinding.ref} is held so a restored position can
 * be applied.
 */
export interface VideoPlayerBinding {
  ref: RefObject<ReactPlayer | null>
  /**
   * The stable position a resumed video must start from, derived once for the
   * lifetime of the component. YouTube turns it into `playerVars.start`; Vimeo
   * ignores it and restores imperatively instead. Undefined when there is
   * nothing to resume (no saved position, or the beginning).
   */
  initialSeconds: number | undefined
  onReady: () => void
  /**
   * Reports the media duration and returns whether the reading marked the media
   * as rendered (positive finite duration or a live stream's positive infinity)
   * and so should reveal the frame. The caller uses that instead of the
   * provider's `onReady`, which for YouTube fires before the video is cued. A
   * live stream has no finite seekable duration, so it is a ready signal only —
   * the restored position is never applied for it.
   */
  onDuration: (duration: number) => boolean
  onPlay: () => void
  onProgress: (progress: VideoProgress) => void
  onPause: () => void
  onSeek: (seconds: number) => void
  onBuffer: () => void
  onBufferEnd: () => void
  onEnded: () => void
  /** Tracks the provider's playback rate for discontinuity detection. */
  onPlaybackRateChange: (rate: number) => void
}

/**
 * The position a YouTube player is initialized with, resolved from the
 * persisted session before the player mounts. It is read once, because
 * `playerVars.start` must not change for the lifetime of a mounted player: a
 * changed `start` never re-seeks, it only confuses the next cue. A saved
 * position at or beyond the authored duration rests just before the end, so the
 * iframe can never be cued past the media (the provider's own duration is not
 * known yet; Vimeo keeps its duration-aware imperative clamp at restore time).
 */
function initialResumeSeconds(options: VideoPlayerOptions): number | undefined {
  const position = options.position
  if (position === undefined || !Number.isFinite(position) || position < 0) {
    return undefined
  }
  const duration = options.duration
  if (
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0 &&
    position >= duration
  ) {
    return Math.max(0, duration - SEEK_END_MARGIN_SECONDS)
  }
  return position
}

/**
 * The accumulated watch time a component starts with. Only a video with an
 * authored requirement records watch time, and the value can never exceed that
 * requirement.
 */
function initialWatchSeconds(options: VideoPlayerOptions): number {
  const required = requiredWatchSeconds(options)
  const watchSeconds = options.watchSeconds
  if (
    required === undefined ||
    typeof watchSeconds !== 'number' ||
    !Number.isFinite(watchSeconds) ||
    watchSeconds <= 0
  ) {
    return 0
  }
  return Math.min(watchSeconds, required)
}

/**
 * Binds ReactPlayer's callback/imperative surface to the semantic
 * restore-and-persist behaviour the learner session expects, without holding any
 * React state: playback progress never causes a render.
 *
 * Resume is provider-specific because ReactPlayer's providers initialize very
 * differently:
 *
 * - YouTube is resumed through `playerVars.start`, which ReactPlayer forwards to
 *   the iframe on creation and on every cue. A position captured for the
 *   component lifetime therefore lands with the media itself, without an
 *   imperative seek. Seeking during YouTube's iframe initialization is dropped
 *   or can wedge the player on a black frame, so no imperative restore is issued
 *   for it at all — not on `onReady`, not on `onDuration`.
 * - Vimeo keeps the imperative restore: it is gated on a usable media duration
 *   (never on `onReady`) and applied exactly once to a seekable player. A
 *   persisted position at or beyond the duration rests just before the end so it
 *   can never seek past the media. The restore passes `keepPlaying: false`
 *   explicitly, because Vimeo defaults the seek to keeping playback going. The
 *   restore window closes as soon as playback, a learner seek or the end takes
 *   over, and the video never autoplays.
 *
 * `onDuration` remains the signal that reveals the player frame for both
 * providers, because YouTube's `onReady` fires when the iframe API loads, before
 * the video is cued. A live stream reports a positive infinity, which still
 * marks the media as rendered but leaves no finite position to seek to, so the
 * frame is revealed without a restore.
 *
 * Positions are persisted on coarse `onProgress` ticks (at most once every
 * {@link PERSIST_INTERVAL_SECONDS}) and immediately on pause, seek and end, so a
 * provider that emits frequent progress events never triggers a per-frame React
 * update or SCORM commit. A finished video persists a reset to the beginning so
 * replaying it resumes from the start, and teardown flushes the latest known
 * position once. Provider controls are not rendered by this binding.
 *
 * A video that declares a minimum watch time additionally accumulates actual
 * elapsed watching time, kept separate from the playback position. Time is
 * credited only while playback is active and only by the monotonic interval
 * reported to {@link VideoPlayerBinding.onProgress}; the change in media
 * position is never itself credited. Pausing, buffering, seeking and ending
 * close or re-baseline the active interval, so no gap counts. YouTube never
 * reports seeks, so a progress reading whose media advance disagrees with
 * `elapsed × playbackRate` discards that interval instead of treating the jump
 * as watched time. `onPlaybackRateChange` keeps that expectation accurate: 30
 * seconds at 2× credits 30 seconds, not 60.
 *
 * Seeking is always allowed and is never blocked or reverted. Rewatching a
 * segment accumulates again. The total is monotonic, capped at the authored
 * minimum, and persisted on change (at most once every
 * {@link WATCH_PERSIST_INTERVAL_SECONDS}), on pause and on end, so page
 * completion always reads accumulated watch time rather than a seekable
 * position.
 */
export function useVideoPlayer(options: VideoPlayerOptions): VideoPlayerBinding {
  const optionsRef = useRef(options)
  const watchSecondsRef = useRef(initialWatchSeconds(options))
  useEffect(() => {
    optionsRef.current = options
    // The persisted total is monotonic: a render must never rewind progress the
    // player has already observed and reported.
    const required = requiredWatchSeconds(options)
    const watchSeconds = options.watchSeconds
    if (
      required !== undefined &&
      typeof watchSeconds === 'number' &&
      Number.isFinite(watchSeconds) &&
      watchSeconds > watchSecondsRef.current
    ) {
      watchSecondsRef.current = Math.min(watchSeconds, required)
    }
  })

  const ref = useRef<ReactPlayer | null>(null)
  const mountedRef = useRef(true)
  const durationRef = useRef<number | undefined>(undefined)
  /**
   * The resume position for this mounted player. `useRef` keeps the first
   * render's value, so a later state write can never rewrite the provider's
   * initial start.
   */
  const initialSeconds = useRef(initialResumeSeconds(options)).current
  /**
   * YouTube really starts at {@link initialSeconds}, because it is passed to the
   * iframe at creation. Vimeo starts at the beginning and is imperatively seeked
   * once its duration is known, so it must not seed playback bookkeeping from a
   * position the provider has not reached yet.
   */
  const startsAtInitial = options.provider === 'youtube' && initialSeconds !== undefined
  const seededRef = useRef(startsAtInitial)
  // YouTube is resumed by `playerVars.start`, so it never restores imperatively;
  // Vimeo seeks once its duration is known.
  const restoredRef = useRef(false)
  const playbackRef = useRef(false)
  const endedRef = useRef(false)
  /**
   * Whether playback is known to be paused. It starts `false` because the
   * player never autoplays: progress events are themselves produced by playback,
   * while an explicit pause, buffer or end is what marks the interruption.
   */
  const pausedRef = useRef(false)
  const bufferingRef = useRef(false)
  const lastPersistedRef = useRef<number | undefined>(startsAtInitial ? initialSeconds : undefined)
  const lastProgressRef = useRef<number | undefined>(startsAtInitial ? initialSeconds : undefined)
  const lastWatchPersistedRef = useRef<number | undefined>(undefined)
  /**
   * The current uninterrupted active-playback segment. Wall time is only ever
   * credited within a segment; it starts at the media position playback was last
   * observed at, paired with a monotonic timestamp.
   */
  const watchSegmentRef = useRef<{ mediaSeconds: number; monotonicSeconds: number } | undefined>(
    undefined
  )
  /** The provider's current playback rate, used only to validate continuity. */
  const playbackRateRef = useRef(1)

  // Persists a semantic position, dropping invalid readings and, unless the
  // change is immediate, anything within the cadence window of the last write.
  const report = useCallback((seconds: number, immediate: boolean) => {
    if (!mountedRef.current) {
      return
    }
    const onPosition = optionsRef.current.onPosition
    if (!onPosition || !Number.isFinite(seconds) || seconds < 0) {
      return
    }
    const last = lastPersistedRef.current
    if (!immediate && last !== undefined && Math.abs(seconds - last) < PERSIST_INTERVAL_SECONDS) {
      return
    }
    lastPersistedRef.current = seconds
    onPosition(seconds)
  }, [])

  // Persists accumulated watch time under the same best-effort contract, only
  // for a video that actually has a requirement. The total is monotonic and
  // never exceeds the authored minimum.
  const reportWatch = useCallback((seconds: number, immediate: boolean) => {
    if (!mountedRef.current) {
      return
    }
    const onWatchSeconds = optionsRef.current.onWatchSeconds
    const required = requiredWatchSeconds(optionsRef.current)
    if (!onWatchSeconds || required === undefined) {
      return
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return
    }
    const bounded = Math.min(seconds, required)
    const last = lastWatchPersistedRef.current
    if (last !== undefined && bounded <= last) {
      return
    }
    if (!immediate && last !== undefined && bounded - last < WATCH_PERSIST_INTERVAL_SECONDS) {
      return
    }
    lastWatchPersistedRef.current = bounded
    onWatchSeconds(bounded)
  }, [])

  // Reads the live position for the events ReactPlayer reports without one
  // (pause, end), falling back to the last progress tick when the provider has
  // not exposed a time yet.
  const currentSeconds = useCallback((): number | undefined => {
    const seconds = ref.current?.getCurrentTime()
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return seconds
    }
    return lastProgressRef.current
  }, [])

  const seekTo = useCallback((seconds: number, keepPlaying: boolean) => {
    const player = ref.current as SeekablePlayer | null
    player?.seekTo(seconds, 'seconds', keepPlaying)
  }, [])

  /** Starts a new active-playback interval at a known media position. */
  const rebaselineWatch = useCallback((mediaSeconds: number) => {
    watchSegmentRef.current = { mediaSeconds, monotonicSeconds: performance.now() / 1000 }
  }, [])

  /** Ends the active-playback interval so no later wall time is credited. */
  const stopWatchSegment = useCallback(() => {
    watchSegmentRef.current = undefined
  }, [])

  /**
   * Credits the monotonic time elapsed in the current active-playback segment.
   * The credited amount is always elapsed time, never a media-time delta, so a
   * faster playback rate cannot inflate it. YouTube's seekless progress jumps
   * are detected by comparing the media advance with `elapsed × playbackRate`;
   * a discontinuous interval is discarded whole and the segment re-baselined,
   * never rewound. Seeking is otherwise free.
   */
  const creditWatchInterval = useCallback(
    (position?: number) => {
      const required = requiredWatchSeconds(optionsRef.current)
      if (required === undefined || watchSecondsRef.current >= required) {
        stopWatchSegment()
        return
      }
      const segment = watchSegmentRef.current
      if (segment === undefined) {
        // Playback began before a progress reading established its position;
        // start measuring from this reading rather than from the media origin.
        if (position !== undefined) {
          rebaselineWatch(position)
        }
        return
      }

      const current = position ?? lastProgressRef.current ?? segment.mediaSeconds
      const now = performance.now() / 1000
      const elapsedSeconds = Math.max(0, now - segment.monotonicSeconds)
      const expectedAdvance = elapsedSeconds * playbackRateRef.current
      const mediaAdvance = current - segment.mediaSeconds
      const discontinuous =
        optionsRef.current.provider === 'youtube' &&
        (mediaAdvance < -WATCH_CLOCK_TOLERANCE_SECONDS ||
          mediaAdvance > expectedAdvance + WATCH_CLOCK_TOLERANCE_SECONDS)

      if (!discontinuous) {
        const credited = Math.min(required, watchSecondsRef.current + elapsedSeconds)
        if (credited > watchSecondsRef.current) {
          watchSecondsRef.current = credited
          // Always persist the exact requirement as soon as it is reached. The
          // cap makes subsequent ticks no-ops, so this is a one-time flush.
          reportWatch(credited, credited >= required)
        }
      }

      rebaselineWatch(current)
    },
    [rebaselineWatch, reportWatch, stopWatchSegment]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      // Best-effort teardown flush: leaving mid-playback loses at most the ticks
      // since the last save, and the last progress tick stands in when the
      // ReactPlayer ref is already gone. Skipped once the video has ended, where
      // the reset to the beginning already holds.
      if (!endedRef.current) {
        creditWatchInterval(currentSeconds())
      }
      reportWatch(watchSecondsRef.current, true)
      if (!endedRef.current) {
        const seconds = currentSeconds()
        if (seconds !== undefined) {
          report(seconds, true)
        }
      }
      mountedRef.current = false
    }
  }, [creditWatchInterval, currentSeconds, report, reportWatch])

  // Restores Vimeo's position imperatively, exactly once, and only once a usable
  // duration has been observed. Called from both `onReady` (a probe, which no-ops
  // while the duration is unknown) and `onDuration` (the gate). YouTube never
  // reaches a seek: it is resumed through `playerVars.start` instead.
  const restore = useCallback(() => {
    if (optionsRef.current.provider !== 'vimeo') {
      return
    }
    if (restoredRef.current || playbackRef.current) {
      return
    }
    const resumePosition = initialResumeSeconds(optionsRef.current)
    if (resumePosition === undefined) {
      return
    }
    // The restored position is already persisted, so it seeds the throttle once
    // and a nearby first progress tick is not written straight back.
    if (!seededRef.current) {
      seededRef.current = true
      lastPersistedRef.current = resumePosition
    }
    if (resumePosition === 0) {
      // Nothing to restore: the media already starts at the beginning.
      lastProgressRef.current = 0
      restoredRef.current = true
      return
    }
    const duration = durationRef.current
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
      // Not seekable yet: a seek issued before the provider knows the media
      // duration is dropped, so wait for `onDuration`.
      return
    }
    // A persisted position at or beyond the end would seek onto (or past) the
    // final frame; rest just before the end instead.
    const target =
      resumePosition < duration ? resumePosition : Math.max(0, duration - SEEK_END_MARGIN_SECONDS)
    // `'seconds'` keeps a sub-second target from being read as a fraction, and
    // `keepPlaying: false` guarantees the seek leaves playback paused. Vimeo
    // defaults the seek to keeping playback going, which would autoplay the
    // restore.
    seekTo(target, false)
    lastProgressRef.current = target
    restoredRef.current = true
  }, [seekTo])

  const onReady = useCallback(() => {
    // A ready signal is only a probe: for YouTube it fires when the iframe API
    // loads, before the video is cued and its duration is known, so the restore
    // is deferred to `onDuration`; YouTube has no imperative restore at all. For
    // Vimeo, `'seconds'` is explicit because ReactPlayer treats an untyped amount
    // below one as a fraction, which would mis-seek a restored position such as
    // 0.5s.
    restore()
  }, [restore])

  const onDuration = useCallback(
    (duration: number): boolean => {
      // Reject only unusable readings: zero, negative and NaN. A live stream
      // reports a positive `Infinity`, which ReactPlayer treats as a truthy
      // duration and — since it emits `onDuration` exactly once — must be taken
      // as the media being rendered, or the placeholder would never yield.
      if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
        return false
      }
      // There is no finite seekable duration for a live stream, so it is not
      // recorded: the restore below would be dropped anyway, and the caller only
      // needs the ready signal.
      if (Number.isFinite(duration)) {
        durationRef.current = duration
      }
      restore()
      return true
    },
    [restore]
  )

  const onPlay = useCallback(() => {
    // Playback resumed, so a previous end no longer suppresses pause/teardown
    // persistence, and the restore must not fight the learner.
    endedRef.current = false
    playbackRef.current = true
    pausedRef.current = false
    bufferingRef.current = false
    // The first active interval begins wherever playback actually is. Paused or
    // buffered gaps before this point were ended with their interval and never
    // count.
    const seconds = currentSeconds()
    rebaselineWatch(seconds ?? lastProgressRef.current ?? 0)
  }, [currentSeconds, rebaselineWatch])

  const onProgress = useCallback(
    (progress: VideoProgress) => {
      if (endedRef.current) {
        // A trailing tick at the end (some providers poll past the last frame)
        // must not overwrite the reset; playback resumes only once `onPlay`
        // clears the guard.
        return
      }
      const seconds = progress?.playedSeconds
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return
      }
      lastProgressRef.current = seconds
      if (pausedRef.current || bufferingRef.current) {
        // An interruption never credits watch time, but the position itself is
        // still worth persisting for a later resume.
        report(seconds, false)
        return
      }
      creditWatchInterval(seconds)
      report(seconds, false)
    },
    [creditWatchInterval, report]
  )

  const onPause = useCallback(() => {
    if (endedRef.current) {
      // Some providers emit a pause as they stop at the end; it must not write
      // the finished position over the reset persisted on end.
      pausedRef.current = true
      stopWatchSegment()
      return
    }
    // The short tail since the last tick is still active playback; consume it
    // before marking the interruption so a pause never loses watch time.
    if (!bufferingRef.current) {
      creditWatchInterval(currentSeconds())
    }
    pausedRef.current = true
    stopWatchSegment()
    reportWatch(watchSecondsRef.current, true)
    const seconds = currentSeconds()
    if (seconds !== undefined) {
      report(seconds, true)
    }
  }, [creditWatchInterval, currentSeconds, report, reportWatch, stopWatchSegment])

  const onSeek = useCallback(
    (seconds: number) => {
      // ReactPlayer v2's YouTube provider never emits `onSeek`, so a seek there
      // is not reported directly; a seek is always free, and a reported one
      // simply closes the current interval and starts a new baseline at the
      // chosen position. Playback is never blocked or reverted.
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return
      }
      playbackRef.current = true
      // ReactPlayer v2 reports Vimeo seeks after `seeked`, so elapsed time since
      // the last progress sample may include seeking or buffering. Discard that
      // unsampled tail rather than treating it as active watching.
      stopWatchSegment()
      lastProgressRef.current = seconds
      if (pausedRef.current || bufferingRef.current || endedRef.current) {
        // A paused or buffered seek must not start an interval; playback will
        // establish the next one.
        stopWatchSegment()
      } else {
        rebaselineWatch(seconds)
      }
      report(seconds, true)
    },
    [rebaselineWatch, report, stopWatchSegment]
  )

  const onBuffer = useCallback(() => {
    if (bufferingRef.current) {
      return
    }
    // Consume the continuous tail before buffering takes over; no time while
    // buffering itself is credited.
    if (!pausedRef.current && !endedRef.current) {
      creditWatchInterval(currentSeconds())
    }
    bufferingRef.current = true
    stopWatchSegment()
  }, [creditWatchInterval, currentSeconds, stopWatchSegment])

  const onBufferEnd = useCallback(() => {
    bufferingRef.current = false
    if (!pausedRef.current && !endedRef.current) {
      // Buffering ended at wherever the provider resumed; the gap does not
      // count, so the next interval starts from that real position.
      const seconds = currentSeconds()
      rebaselineWatch(seconds ?? lastProgressRef.current ?? 0)
    } else {
      stopWatchSegment()
    }
  }, [currentSeconds, rebaselineWatch, stopWatchSegment])

  const onPlaybackRateChange = useCallback(
    (rate: number) => {
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        return
      }
      const active =
        playbackRef.current && !pausedRef.current && !bufferingRef.current && !endedRef.current
      // Close the interval under the old rate before adopting the new one, so a
      // mid-interval rate change can neither inflate nor invalidate it.
      const seconds = currentSeconds()
      if (active) {
        creditWatchInterval(seconds)
      }
      playbackRateRef.current = rate
      if (active) {
        rebaselineWatch(seconds ?? lastProgressRef.current ?? 0)
      }
    },
    [creditWatchInterval, currentSeconds, rebaselineWatch]
  )

  const onEnded = useCallback(() => {
    // Credit the final active tail before the end closes playback.
    creditWatchInterval(currentSeconds())
    endedRef.current = true
    pausedRef.current = true
    bufferingRef.current = false
    playbackRef.current = true
    stopWatchSegment()
    lastProgressRef.current = 0

    reportWatch(watchSecondsRef.current, true)
    // A finished video resumes from the beginning, so persist the reset rather
    // than the duration the provider is reporting.
    report(0, true)
  }, [creditWatchInterval, currentSeconds, report, reportWatch, stopWatchSegment])

  return {
    ref,
    initialSeconds,
    onReady,
    onDuration,
    onPlay,
    onProgress,
    onPause,
    onSeek,
    onBuffer,
    onBufferEnd,
    onEnded,
    onPlaybackRateChange
  }
}
