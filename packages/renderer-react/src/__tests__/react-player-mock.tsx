import { createElement, forwardRef, useImperativeHandle, useRef } from 'react'
import type { Config } from 'react-player'
import { vi } from 'vitest'

/** The exact props ReactPlayer's public surface exposes to this renderer. */
export interface RecordedPlayer {
  url?: string
  controls?: boolean
  playing?: boolean
  width?: string | number
  height?: string | number
  progressInterval?: number
  config?: Config
  onReady?: () => void
  onDuration?: (duration: number) => void
  onError?: (error?: unknown) => void
  onPlay?: () => void
  onProgress?: (progress: { playedSeconds: number }) => void
  onPause?: () => void
  onSeek?: (seconds: number) => void
  onBuffer?: () => void
  onBufferEnd?: () => void
  onEnded?: () => void
  onPlaybackRateChange?: (rate: number) => void
}

const records: RecordedPlayer[] = []
/**
 * Mirrors ReactPlayer v2's runtime `seekTo`, which forwards a third
 * `keepPlaying` argument to the provider even though the public type omits it.
 * Recording it here lets tests assert the restore demands a paused seek rather
 * than inheriting the provider's default.
 */
const seekTo =
  vi.fn<(amount: number, type?: 'seconds' | 'fraction', keepPlaying?: boolean) => void>()
const getCurrentTime = vi.fn<() => number | null>(() => null)

/**
 * Shared registry behind the ReactPlayer test double. Tests read the props each
 * player was given and drive the callbacks ReactPlayer would invoke, so the
 * renderer's binding is exercised without loading ReactPlayer's CommonJS bundle
 * (whose extensionless lazy imports Vitest cannot resolve — the production Vite
 * build handles them, and the real dependency is validated there).
 */
export const reactPlayerMock = {
  records,
  seekTo,
  getCurrentTime,
  reset() {
    records.length = 0
    seekTo.mockReset()
    getCurrentTime.mockReset()
    getCurrentTime.mockReturnValue(null)
  },
  /** The most recently rendered player, for a single-player test. */
  latest(): RecordedPlayer {
    const record = records[records.length - 1]
    if (!record) {
      throw new Error('ReactPlayer was not rendered')
    }
    return record
  }
}

/**
 * Test double for ReactPlayer: records the props it receives and forwards the
 * imperative methods (`seekTo`, `getCurrentTime`) the binding calls. It is wired
 * in through `vi.mock` in the Vitest setup file, so app code keeps importing
 * `react-player` unchanged.
 */
export const MockReactPlayer = forwardRef<unknown, RecordedPlayer>(
  function MockReactPlayer(props, ref) {
    const recordIndex = useRef<number | null>(null)
    if (recordIndex.current === null) {
      recordIndex.current = records.length
      records.push(props)
    } else {
      // Keep the registry current so a re-render's props (notably the stable
      // provider config) can be asserted without adding another player entry.
      records[recordIndex.current] = props
    }
    useImperativeHandle(ref, () => ({
      seekTo,
      getCurrentTime,
      getDuration: () => 0
    }))
    return createElement('div', { 'data-testid': 'react-player', 'data-url': props.url })
  }
)
