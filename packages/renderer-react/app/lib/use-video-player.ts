import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type ReactPlayer from 'react-player'

/** Persistence cadence: a playing video is saved only once it moves this far. */
const PERSIST_INTERVAL_SECONDS = 5

/**
 * How far before the end a restored position is placed when the persisted value
 * is at or beyond the media duration. Seeking to the very end would leave the
 * player stopped on the final frame, so the restore rests just short of it
 * instead (bounded to zero for media shorter than the margin).
 */
const SEEK_END_MARGIN_SECONDS = 1

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
 * ReactPlayer's provider-specific default.
 *
 * Positions are persisted on coarse `onProgress` ticks (at most once every
 * {@link PERSIST_INTERVAL_SECONDS}) and immediately on pause, seek and end, so a
 * provider that emits frequent progress events never triggers a per-frame React
 * update or SCORM commit. A finished video persists a reset to the beginning so
 * replaying it resumes from the start, and teardown flushes the latest known
 * position once. ReactPlayer's own controls are left in place, so no playback
 * chrome is duplicated here.
 */
export function useVideoPlayer(options: VideoPlayerOptions): VideoPlayerBinding {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const ref = useRef<ReactPlayer | null>(null)
  const mountedRef = useRef(true)
  const durationRef = useRef<number | undefined>(undefined)
  const seededRef = useRef(false)
  const restoredRef = useRef(false)
  const playbackRef = useRef(false)
  const endedRef = useRef(false)
  const lastPersistedRef = useRef<number | undefined>(undefined)
  const lastProgressRef = useRef<number | undefined>(undefined)

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
      }
      mountedRef.current = false
    }
  }, [currentSeconds, report])

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
    // The restored position is already persisted, so it seeds the throttle once
    // and a nearby first progress tick is not written straight back.
    if (!seededRef.current) {
      seededRef.current = true
      lastPersistedRef.current = position
    }
    if (position === 0) {
      // Nothing to restore: the media already starts at the beginning.
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
    const target = position < duration ? position : Math.max(0, duration - SEEK_END_MARGIN_SECONDS)
    // `'seconds'` keeps a sub-second target from being read as a fraction, and
    // `keepPlaying: false` guarantees the seek leaves playback paused. ReactPlayer
    // only defaults it to `false` for YouTube; Vimeo and the native file player
    // default to `true`, which would autoplay the restore on those providers.
    const player = ref.current as SeekablePlayer | null
    player?.seekTo(target, 'seconds', false)
    restoredRef.current = true
  }, [])

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
  }, [])

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
      report(seconds, false)
    },
    [report]
  )

  const onPause = useCallback(() => {
    if (endedRef.current) {
      // Some providers emit a pause as they stop at the end; it must not write
      // the finished position over the reset persisted on end.
      return
    }
    const seconds = currentSeconds()
    if (seconds !== undefined) {
      report(seconds, true)
    }
  }, [currentSeconds, report])

  const onSeek = useCallback(
    (seconds: number) => {
      // ReactPlayer v2's YouTube provider never emits `onSeek`, so a seek there
      // is not reported directly; meaningful changes are still captured by the
      // coarse progress callback. A reported seek also means the learner (or the
      // provider) has taken over, so the restore window closes.
      playbackRef.current = true
      report(seconds, true)
    },
    [report]
  )

  const onEnded = useCallback(() => {
    // A finished video resumes from the beginning, so persist the reset rather
    // than the duration the provider is reporting.
    endedRef.current = true
    playbackRef.current = true
    lastProgressRef.current = 0
    report(0, true)
  }, [report])

  return { ref, onReady, onDuration, onPlay, onProgress, onPause, onSeek, onEnded }
}
