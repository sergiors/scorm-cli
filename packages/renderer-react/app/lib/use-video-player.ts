import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type ReactPlayer from 'react-player'
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

/** Small tolerance for distinguishing provider timing variation from discontinuities. */
const WATCH_CLOCK_TOLERANCE_SECONDS = 1

/** Position tolerance when deciding whether a resumed provider position is stale. */
const WATCH_RESUME_POSITION_TOLERANCE_SECONDS = 3.5

/** Position tolerance for provider duration/end readings. */
const WATCH_END_POSITION_TOLERANCE_SECONDS = 3.5

/** How often the verified frontier is written while it advances. */
const WATCH_PERSIST_INTERVAL_SECONDS = 1

/**
 * Tolerance when comparing a frontier with the authored requirement. Persisted
 * progress is normalized to tenths, so a reading just below a whole-second
 * requirement must still count as met.
 */
const WATCH_COMPLETION_EPSILON_SECONDS = 0.05

/** The slice of ReactPlayer's progress event this binding consumes. */
export interface VideoProgress {
  playedSeconds: number
}

/**
 * The imperative slice of ReactPlayer's runtime surface the restore relies on.
 * ReactPlayer v2's public `seekTo` type declares only `(amount, type)`, but the
 * runtime forwards a third `keepPlaying` argument to the provider, whose default
 * is provider-specific: YouTube pauses (`false`), while Vimeo and the native file
 * player keep playing (`true`). This structural view adds only the missing
 * parameter, so the restore can demand a paused seek explicitly without widening
 * the whole player to `any`.
 */
interface SeekablePlayer {
  seekTo(amount: number, type: 'seconds' | 'fraction', keepPlaying: boolean): void
}

export interface VideoPlayerOptions {
  /**
   * Restored semantic position in seconds, applied once — and only once — the
   * provider has reported a usable media duration. Never used to autoplay: a
   * resume leaves the video paused at the saved spot.
   */
  position?: number
  /** Reports a semantic position in seconds for persistence. */
  onPosition?: (seconds: number) => void
  /** The authored minimum continuous watch time, in seconds. */
  minWatchTime?: number
  /** The authored duration in seconds, used to bound the requirement. */
  duration?: number
  /**
   * The persisted verified frontier in seconds. Playback may not advance beyond
   * it until it is reached through continuous playback.
   */
  watchedUntil?: number
  /** Reports a changed verified frontier in seconds for persistence. */
  onWatched?: (seconds: number) => void
}

/**
 * The exact subset of ReactPlayer's public surface this renderer binds to. The
 * player instance itself is never stored in React state or persisted; only its
 * imperative {@link VideoPlayerBinding.ref} is held so a restored position can
 * be applied.
 */
export interface VideoPlayerBinding {
  ref: RefObject<ReactPlayer | null>
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
}

/**
 * Binds ReactPlayer's callback/imperative surface to the semantic
 * restore-and-persist behaviour the learner session expects, without holding any
 * React state: playback progress never causes a render.
 *
 * The restore is gated on a usable media duration rather than on `onReady`.
 * ReactPlayer's YouTube provider reports ready twice — first when the iframe API
 * is ready, before the video is cued and its duration is known, and again once
 * the video is cued — and a seek issued before the duration exists is dropped by
 * YouTube (and can leave the player wedged on a black frame). ReactPlayer emits
 * `onDuration` exactly once, after `onReady`, as soon as `getDuration()` returns
 * a non-zero value (it polls every 100ms until then), which is the first moment a
 * seek can reliably land. A live stream is the exception: it reports a positive
 * infinity, which still marks the media as rendered but leaves no finite position
 * to seek to, so the frame is revealed without a restore. The position is
 * therefore applied a single time on the first valid duration, and a persisted
 * position at or beyond the duration is
 * clamped to just before the end so it can never seek past the media. The restore
 * window closes as soon as playback, a learner seek or the end takes over, and
 * the video never autoplays: the restoring seek passes `keepPlaying: false`
 * explicitly, so the pause holds across providers rather than depending on
 * ReactPlayer's provider-specific default. A required video that has not yet met
 * its minimum can resume no further than its verified frontier, so a legacy or
 * inconsistent playback position can never bypass the requirement.
 *
 * Positions are persisted on coarse `onProgress` ticks (at most once every
 * {@link PERSIST_INTERVAL_SECONDS}) and immediately on pause, seek and end, so a
 * provider that emits frequent progress events never triggers a per-frame React
 * update or SCORM commit. A finished video persists a reset to the beginning so
 * replaying it resumes from the start, and teardown flushes the latest known
 * position once. ReactPlayer's own controls are left in place, so no playback
 * chrome is duplicated here.
 *
 * A video that declares a minimum watch time additionally owns a verified
 * frontier, kept separate from the playback position. The frontier only grows
 * through playback that advances no faster than elapsed wall time. A small
 * tolerance distinguishes provider timing variation from a discontinuity, but
 * never adds watch credit: paused ticks, buffering and seeks never advance the
 * frontier, a backward seek is always allowed, and a forward jump past the
 * frontier — a reported seek or a YouTube progress discontinuity — is pulled
 * back. Once the authored minimum is met, seeking is no longer constrained.
 * The frontier is persisted on change (at most once every
 * {@link WATCH_PERSIST_INTERVAL_SECONDS}), on pause and on end, so page
 * completion always reads verified time rather than a seekable position.
 */
export function useVideoPlayer(options: VideoPlayerOptions): VideoPlayerBinding {
  const optionsRef = useRef(options)
  const watchedUntilRef = useRef(options.watchedUntil ?? 0)
  useEffect(() => {
    optionsRef.current = options
    // The persisted frontier is monotonic: a render must never rewind verified
    // progress that the player has already observed and reported.
    const watched = options.watchedUntil
    if (
      typeof watched === 'number' &&
      Number.isFinite(watched) &&
      watched > watchedUntilRef.current
    ) {
      watchedUntilRef.current = watched
    }
  })

  const ref = useRef<ReactPlayer | null>(null)
  const mountedRef = useRef(true)
  const durationRef = useRef<number | undefined>(undefined)
  const seededRef = useRef(false)
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
  const lastPersistedRef = useRef<number | undefined>(undefined)
  const lastProgressRef = useRef<number | undefined>(undefined)
  /** The previous playback reading, used only to judge continuity. */
  const lastTickRef = useRef(0)
  /** Beginning of the current uninterrupted playback segment, in media/wall time. */
  const continuityStartRef = useRef<{ mediaSeconds: number; wallSeconds: number } | undefined>(
    undefined
  )
  const lastWatchedPersistedRef = useRef<number | undefined>(undefined)

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

  // Persists a verified frontier under the same best-effort contract, but only
  // for a video that actually has a requirement. Zero needs no record.
  const reportWatched = useCallback((seconds: number, immediate: boolean) => {
    if (!mountedRef.current) {
      return
    }
    const onWatched = optionsRef.current.onWatched
    if (!onWatched || requiredWatchSeconds(optionsRef.current) === undefined) {
      return
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return
    }
    const last = lastWatchedPersistedRef.current
    if (!immediate && last !== undefined && seconds - last < WATCH_PERSIST_INTERVAL_SECONDS) {
      return
    }
    lastWatchedPersistedRef.current = seconds
    onWatched(seconds)
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

  const resetContinuity = useCallback((mediaSeconds: number) => {
    continuityStartRef.current = { mediaSeconds, wallSeconds: Date.now() / 1000 }
  }, [])

  /**
   * Consumes a playback reading and returns the position the player should
   * actually be at. Continuous time beyond the frontier advances it; a jump past
   * it is discontinuous, so the reading is rejected and (when requested) the
   * provider is pulled back once. A backward reading is always allowed.
   */
  const observePlayback = useCallback(
    (seconds: number, correctForwardJump: boolean): number => {
      const required = requiredWatchSeconds(optionsRef.current)
      if (
        required === undefined ||
        watchedUntilRef.current >= required - WATCH_COMPLETION_EPSILON_SECONDS
      ) {
        lastTickRef.current = seconds
        return seconds
      }

      const frontier = watchedUntilRef.current
      const now = Date.now() / 1000
      if (seconds <= frontier) {
        if (seconds < lastTickRef.current) {
          // A backward provider reading starts a new playback segment. Time
          // spent replaying already-verified media can then lead naturally back
          // to the frontier without changing the verified amount.
          resetContinuity(seconds)
        }
        lastTickRef.current = seconds
        return seconds
      }

      const last = lastTickRef.current
      if (continuityStartRef.current === undefined) {
        // Normally `onPlay` establishes this baseline. If a provider emits a
        // progress tick first, start conservatively from the last known media
        // position rather than treating the whole position as watched.
        continuityStartRef.current = { mediaSeconds: last, wallSeconds: now }
      }
      const continuityStart = continuityStartRef.current
      const elapsedWallSeconds = Math.max(0, now - continuityStart.wallSeconds)
      const continuous =
        last <= frontier + WATCH_CLOCK_TOLERANCE_SECONDS + WATCH_COMPLETION_EPSILON_SECONDS &&
        seconds - continuityStart.mediaSeconds <=
          elapsedWallSeconds + WATCH_CLOCK_TOLERANCE_SECONDS

      if (continuous) {
        lastTickRef.current = seconds
        // Provider timing tolerance may keep a small media-time lead from being
        // classified as a seek, but only elapsed wall time can be credited.
        const creditedSeconds = Math.max(
          frontier,
          Math.min(seconds, continuityStart.mediaSeconds + elapsedWallSeconds)
        )
        if (creditedSeconds > frontier) {
          watchedUntilRef.current = creditedSeconds
          reportWatched(creditedSeconds, false)
        }
        return seconds
      }

      // A jump beyond the frontier is not watched time. Keep the frontier where
      // it was and pull the provider back. Repeating the correction is safe: the
      // corrective seek itself lands inside the verified region, so it can never
      // count as a new jump.
      lastTickRef.current = frontier
      resetContinuity(frontier)
      if (correctForwardJump) {
        seekTo(frontier, !pausedRef.current)
      }
      return frontier
    },
    [reportWatched, resetContinuity, seekTo]
  )

  /**
   * Re-baselines continuity after a pause or buffer ends. A position beyond the
   * frontier after such an interruption is an unverified jump, so it is pulled
   * back instead of becoming the next tick's starting point.
   */
  const resumeFromInterruption = useCallback(() => {
    const required = requiredWatchSeconds(optionsRef.current)
    if (
      required === undefined ||
      watchedUntilRef.current >= required - WATCH_COMPLETION_EPSILON_SECONDS
    ) {
      return
    }
    const frontier = watchedUntilRef.current
    const current = currentSeconds()
    if (current !== undefined && current > frontier + WATCH_RESUME_POSITION_TOLERANCE_SECONDS) {
      lastTickRef.current = frontier
      resetContinuity(frontier)
      seekTo(frontier, !pausedRef.current)
      report(frontier, true)
      return
    }
    // Resume exactly where playback actually is when that position is already
    // verified, so a later jump is still measured from the real position. A
    // small unverified tail is folded into the next tick instead.
    lastTickRef.current = current !== undefined && current <= frontier ? current : frontier
    resetContinuity(lastTickRef.current)
  }, [currentSeconds, report, resetContinuity, seekTo])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      // Best-effort teardown flush: leaving mid-playback loses at most the ticks
      // since the last save, and the last progress tick stands in when the
      // ReactPlayer ref is already gone. Skipped once the video has ended, where
      // the reset to the beginning already holds, and bounded to this one save.
      if (!endedRef.current) {
        const seconds = currentSeconds()
        if (seconds !== undefined) {
          report(seconds, true)
        }
        reportWatched(watchedUntilRef.current, true)
      }
      mountedRef.current = false
    }
  }, [currentSeconds, report, reportWatched])

  // Applies the restored position exactly once, and only once a usable duration
  // has been observed. Called from both `onReady` (a probe, which no-ops while
  // the duration is unknown) and `onDuration` (the gate), so whichever provider
  // timing occurs, the seek lands after the media is seekable.
  const restore = useCallback(() => {
    if (restoredRef.current || playbackRef.current) {
      return
    }
    const position = optionsRef.current.position
    if (position === undefined || !Number.isFinite(position) || position < 0) {
      return
    }
    const required = requiredWatchSeconds(optionsRef.current)
    const incomplete =
      required !== undefined &&
      watchedUntilRef.current < required - WATCH_COMPLETION_EPSILON_SECONDS
    // An unfinished required video can only resume within its verified frontier;
    // resuming beyond it would expose unwatched time before playback starts.
    const resumePosition = incomplete ? Math.min(position, watchedUntilRef.current) : position
    // The restored position is already persisted, so it seeds the throttle once
    // and a nearby first progress tick is not written straight back.
    if (!seededRef.current) {
      seededRef.current = true
      lastPersistedRef.current = resumePosition
    }
    if (resumePosition === 0) {
      // Nothing to restore: the media already starts at the beginning.
      lastTickRef.current = 0
      restoredRef.current = true
      return
    }
    const duration = durationRef.current
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
      // Not seekable yet: a seek issued before the provider knows the media
      // duration is dropped (YouTube) or wedges the player, so wait for
      // `onDuration`.
      return
    }
    // A persisted position at or beyond the end would seek onto (or past) the
    // final frame; rest just before the end instead.
    const target =
      resumePosition < duration ? resumePosition : Math.max(0, duration - SEEK_END_MARGIN_SECONDS)
    // `'seconds'` keeps a sub-second target from being read as a fraction, and
    // `keepPlaying: false` guarantees the seek leaves playback paused. ReactPlayer
    // only defaults it to `false` for YouTube; Vimeo and the native file player
    // default to `true`, which would autoplay the restore on those providers.
    seekTo(target, false)
    lastTickRef.current = target
    restoredRef.current = true
  }, [seekTo])

  const onReady = useCallback(() => {
    // A ready signal is only a probe: for YouTube it fires when the iframe API
    // loads, before the video is cued and its duration is known, so the restore
    // is deferred to `onDuration`. `'seconds'` is explicit because ReactPlayer
    // treats an untyped amount below one as a fraction, which would mis-seek a
    // restored position such as 0.5s.
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
    resumeFromInterruption()
    resetContinuity(lastTickRef.current)
  }, [resetContinuity, resumeFromInterruption])

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
        // An interruption never verifies time, but the position itself is still
        // worth persisting for a later resume.
        report(seconds, false)
        return
      }
      const effective = observePlayback(seconds, true)
      if (effective !== seconds) {
        // The provider is being pulled back, so the last known live position is
        // the corrected one rather than the rejected jump.
        lastProgressRef.current = effective
      }
      report(effective, effective !== seconds)
    },
    [observePlayback, report]
  )

  const onPause = useCallback(() => {
    if (endedRef.current) {
      // Some providers emit a pause as they stop at the end; it must not write
      // the finished position over the reset persisted on end.
      pausedRef.current = true
      return
    }
    // The short tail since the last tick is still continuous playback; consume
    // it before marking the interruption so a pause never leaves verified time
    // behind. A discontinuous live position is rejected without a seek.
    if (!bufferingRef.current) {
      const seconds = currentSeconds()
      if (seconds !== undefined) {
        observePlayback(seconds, false)
      }
    }
    pausedRef.current = true
    reportWatched(watchedUntilRef.current, true)
    const seconds = currentSeconds()
    if (seconds !== undefined) {
      report(seconds, true)
    }
  }, [currentSeconds, observePlayback, report, reportWatched])

  const onSeek = useCallback(
    (seconds: number) => {
      // ReactPlayer v2's YouTube provider never emits `onSeek`, so a seek there
      // is not reported directly; meaningful changes are still captured by the
      // coarse progress callback. A reported seek also means the learner (or the
      // provider) has taken over, so the restore window closes.
      playbackRef.current = true
      const required = requiredWatchSeconds(optionsRef.current)
      const frontier = watchedUntilRef.current
      const blocked =
        required !== undefined &&
        frontier < required - WATCH_COMPLETION_EPSILON_SECONDS &&
        seconds > frontier
      const effective = blocked ? frontier : seconds
      lastTickRef.current = effective
      lastProgressRef.current = effective
      resetContinuity(effective)
      if (blocked) {
        seekTo(frontier, !pausedRef.current)
      }
      report(effective, true)
    },
    [report, resetContinuity, seekTo]
  )

  const onBuffer = useCallback(() => {
    if (bufferingRef.current) {
      return
    }
    // Consume the continuous tail before buffering takes over; no time while
    // buffering itself is verified.
    if (!pausedRef.current && !endedRef.current) {
      const seconds = currentSeconds()
      if (seconds !== undefined) {
        observePlayback(seconds, false)
      }
    }
    bufferingRef.current = true
  }, [currentSeconds, observePlayback])

  const onBufferEnd = useCallback(() => {
    bufferingRef.current = false
    if (!pausedRef.current && !endedRef.current) {
      resumeFromInterruption()
      resetContinuity(lastTickRef.current)
    }
  }, [resetContinuity, resumeFromInterruption])

  const onEnded = useCallback(() => {
    // A finished video resumes from the beginning, so persist the reset rather
    // than the duration the provider is reporting.
    endedRef.current = true
    pausedRef.current = true
    bufferingRef.current = false
    playbackRef.current = true
    lastProgressRef.current = 0

    const required = requiredWatchSeconds(optionsRef.current)
    const duration = durationRef.current
    if (
      required !== undefined &&
      watchedUntilRef.current < required - WATCH_COMPLETION_EPSILON_SECONDS
    ) {
      // Reaching the end through continuous playback satisfies the requirement
      // even when the provider reports a slightly shorter media than the
      // authored duration: the learner watched everything available.
      // Only the last accepted playback reading may establish that playback
      // reached the media end; a rejected seek-to-end must not complete the
      // requirement through the provider's trailing `onEnded` callback.
      const last = lastTickRef.current
      if (
        duration !== undefined &&
        Number.isFinite(duration) &&
        duration > 0 &&
        last >= duration - WATCH_END_POSITION_TOLERANCE_SECONDS
      ) {
        watchedUntilRef.current = Math.max(watchedUntilRef.current, required)
      }
    }
    reportWatched(watchedUntilRef.current, true)
    lastTickRef.current = 0
    report(0, true)
  }, [report, reportWatched])

  return {
    ref,
    onReady,
    onDuration,
    onPlay,
    onProgress,
    onPause,
    onSeek,
    onBuffer,
    onBufferEnd,
    onEnded
  }
}
