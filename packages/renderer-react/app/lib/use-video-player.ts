import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type ReactPlayer from 'react-player'

/** Persistence cadence: a playing video is saved only once it moves this far. */
const PERSIST_INTERVAL_SECONDS = 5

/** The slice of ReactPlayer's progress event this binding consumes. */
export interface VideoProgress {
  playedSeconds: number
}

export interface VideoPlayerOptions {
  /**
   * Restored semantic position in seconds, applied once the player reports
   * ready. Never used to autoplay: a resume leaves the video paused at the saved
   * spot.
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
 * A restored position is applied only once, in `onReady`, and never autoplays.
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
  const restoredRef = useRef(false)
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

  const onReady = useCallback(() => {
    if (restoredRef.current) {
      return
    }
    restoredRef.current = true
    const position = optionsRef.current.position
    if (position === undefined || !Number.isFinite(position) || position < 0) {
      return
    }
    // The restored position is already persisted, so it seeds the throttle and a
    // nearby first progress tick is not written straight back.
    lastPersistedRef.current = position
    if (position > 0) {
      // `'seconds'` is explicit: ReactPlayer treats an untyped amount below one
      // as a fraction, which would mis-seek a restored position such as 0.5s.
      ref.current?.seekTo(position, 'seconds')
    }
  }, [])

  const onPlay = useCallback(() => {
    // Playback resumed, so a previous end no longer suppresses pause/teardown
    // persistence.
    endedRef.current = false
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
      // coarse progress callback.
      report(seconds, true)
    },
    [report]
  )

  const onEnded = useCallback(() => {
    // A finished video resumes from the beginning, so persist the reset rather
    // than the duration the provider is reporting.
    endedRef.current = true
    lastProgressRef.current = 0
    report(0, true)
  }, [report])

  return { ref, onReady, onPlay, onProgress, onPause, onSeek, onEnded }
}
