// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Video } from '../../app/components/Video'
import { SlidesPresentation } from '../../app/components/SlidesPresentation'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { getPackageProgress } from '../../app/lib/content-helpers'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
import { inlineContentProvider, questionnaireNode } from './fixtures'
import type {
  ContentNode,
  ContentPackage,
  PlayerState,
  VideoNode,
  VideoProvider
} from '../../app/types'
import { reactPlayerMock as players, type RecordedPlayer } from './react-player-mock'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const VIDEO_ID = 'video:lesson.mdx:1:1'

const vimeoNode: VideoNode = {
  type: 'video',
  id: VIDEO_ID,
  provider: 'vimeo',
  src: 'https://vimeo.com/42',
  title: 'Lesson video'
}

const VIDEO_PAGE_ID = 'page:video-test.mdx'

function videoPackageFor(node: VideoNode): ContentPackage {
  return videoPackageOf([node])
}

function videoPackageOf(nodes: VideoNode[]): ContentPackage {
  return {
    metadata: { title: 'Video test' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: VIDEO_PAGE_ID,
          source: 'video-test.mdx',
          metadata: { title: 'Video test' },
          content: nodes
        }
      ]
    }
  }
}

function VideoContext({ node }: { node: VideoNode }) {
  return (
    <PlayerProvider contentPackage={videoPackageFor(node)}>
      <PageProvider pageId={VIDEO_PAGE_ID}>
        <Video node={node} />
      </PageProvider>
    </PlayerProvider>
  )
}

/** A canonical source per provider; ReactPlayer never sees a sniffed host. */
const providerSources: Record<VideoProvider, string> = {
  youtube: 'https://youtu.be/abc123',
  vimeo: 'https://vimeo.com/42'
}

let container: HTMLDivElement
let root: Root
let session: PlayerSession | undefined

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  players.reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  session = undefined
  delete window.scormBridge
  vi.restoreAllMocks()
})

/** Renders a `Video` and returns the props handed to ReactPlayer. */
async function mountVideo(
  node: VideoNode,
  position: number | undefined,
  onPosition: (seconds: number) => void,
  watchSeconds?: number,
  onWatchSeconds?: (seconds: number) => void
): Promise<RecordedPlayer> {
  const pageId = VIDEO_PAGE_ID
  const contentPackage = videoPackageFor(node)
  let lastPosition = position
  let lastWatch = watchSeconds
  window.scormBridge = {
    restoreState: (): PlayerState => ({
      pages:
        position === undefined && watchSeconds === undefined
          ? {}
          : {
              [pageId]: {
                ...(position === undefined ? {} : { videos: { [node.id]: position } }),
                ...(watchSeconds === undefined
                  ? {}
                  : { videoWatchSeconds: { [node.id]: watchSeconds } })
              }
            }
    }),
    saveState: (state) => {
      const nextPosition = state.pages[pageId]?.videos?.[node.id]
      if (nextPosition !== undefined && nextPosition !== lastPosition) {
        lastPosition = nextPosition
        onPosition(nextPosition)
      }
      const nextWatch = state.pages[pageId]?.videoWatchSeconds?.[node.id]
      if (nextWatch !== undefined && nextWatch !== lastWatch) {
        lastWatch = nextWatch
        onWatchSeconds?.(nextWatch)
      }
    }
  }
  await act(async () => {
    root.render(
      <PlayerI18nProvider>
        <PlayerProvider contentPackage={contentPackage}>
          <PageProvider pageId={pageId}>
            <Video node={node} />
          </PageProvider>
        </PlayerProvider>
      </PlayerI18nProvider>
    )
  })
  return players.latest()
}

function savedPositions(onPosition: { mock: { calls: unknown[][] } }): number[] {
  return onPosition.mock.calls.map((call) => call[0] as number)
}

function savedWatchSeconds(onWatchSeconds: { mock: { calls: unknown[][] } }): number[] {
  return onWatchSeconds.mock.calls.map((call) => call[0] as number)
}

let watchClock = 0

function startWatching(...records: RecordedPlayer[]): void {
  watchClock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => watchClock)
  for (const record of records) {
    act(() => record.onPlay?.())
  }
}

function progressAfter(record: RecordedPlayer, seconds: number, elapsed = seconds): void {
  watchClock += elapsed * 1000
  act(() => record.onProgress?.({ playedSeconds: seconds }))
}

/**
 * Shadows the jsdom visibility state, notifies the binding's listener, and
 * leaves the shadow configurable so tests clean it up at the end of a suite.
 */
function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true
  })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
}

function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

function SessionHarness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

function renderSession(contentPackage: ContentPackage): void {
  act(() => root.render(<SessionHarness contentPackage={contentPackage} />))
}

describe('Video provider inputs', () => {
  it.each<VideoProvider>(['youtube', 'vimeo'])(
    'feeds the canonical source and controls to ReactPlayer for %s',
    async (provider) => {
      const record = await mountVideo(
        { ...vimeoNode, provider, src: providerSources[provider] },
        undefined,
        () => {}
      )

      expect(record.url).toBe(providerSources[provider])
      expect(record.controls).toBe(true)
      expect(record.progressInterval).toBe(1000)
      // Never autoplay: a resume leaves playback paused.
      expect(record.playing).toBeFalsy()
    }
  )

  it('seeds the YouTube player with the saved position through playerVars.start', async () => {
    const record = await mountVideo(
      { ...vimeoNode, provider: 'youtube', src: providerSources.youtube },
      12.3,
      () => {}
    )

    expect(record.config?.youtube?.playerVars?.start).toBe(12.3)
  })

  it('omits the YouTube start parameter when there is nothing to resume', async () => {
    const record = await mountVideo(
      { ...vimeoNode, provider: 'youtube', src: providerSources.youtube },
      0,
      () => {}
    )

    expect(record.config?.youtube).toBeUndefined()
  })

  it('clamps the YouTube start before the authored end', async () => {
    const record = await mountVideo(
      {
        ...vimeoNode,
        provider: 'youtube',
        src: providerSources.youtube,
        duration: 200
      },
      300,
      () => {}
    )

    // The provider duration is unknown before mount, but the authored duration
    // bounds the initial cue so a stale position cannot start past the end.
    expect(record.config?.youtube?.playerVars?.start).toBe(199)
  })

  it('titles the Vimeo iframe from the authored title', async () => {
    const record = await mountVideo(
      { ...vimeoNode, provider: 'vimeo', src: providerSources.vimeo },
      undefined,
      () => {}
    )

    expect(record.config?.vimeo?.title).toBe('Lesson video')
  })

  it.each<VideoProvider>(['youtube', 'vimeo'])(
    'reserves the same stable 16:9 placeholder frame for %s until it is ready',
    (provider) => {
      const html = renderToStaticMarkup(
        <PlayerI18nProvider>
          <VideoContext node={{ ...vimeoNode, provider, src: providerSources[provider] }} />
        </PlayerI18nProvider>
      )

      // The frame reserves the media geometry before the provider player mounts,
      // so the placeholder occupies exactly the box the media will. The frame
      // element itself is the ratio box: an authored `--ratio` CSS variable
      // consumed by the CSS `aspect-ratio` utility.
      expect(html).toContain('data-slot="media-frame"')
      expect(html).toMatch(/--ratio:1\.7777777777777777/)
      expect(html).toContain('aspect-(--ratio)')
      expect(html).not.toContain('padding-bottom')
      expect(html).toContain('data-slot="skeleton"')
      expect(html).toContain('animate-none')
      expect(html).toContain('aria-label="Lesson video"')
      expect(html).toContain(`data-url="${providerSources[provider]}"`)
    }
  )

  it('reveals the player frame on the first usable duration, not on ready', async () => {
    const record = await mountVideo(vimeoNode, undefined, () => {})

    // Mounted but not yet playing media: the static placeholder fills the frame.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    // `ready` is only the binding's restore probe, so the frame stays reserved.
    await act(async () => {
      record.onReady?.()
    })
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    // The first usable duration is the earliest the media is genuinely rendered.
    await act(async () => {
      record.onDuration?.(120)
    })
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it('shows the authored poster until the player is ready, then removes it', async () => {
    const record = await mountVideo({ ...vimeoNode, poster: './poster.png' }, undefined, () => {})

    const poster = container.querySelector('[data-slot="media-frame-poster"]')
    expect(poster?.getAttribute('src')).toBe('./poster.png')
    expect(poster?.getAttribute('alt')).toBe('')

    await act(async () => {
      record.onDuration?.(120)
    })

    expect(container.querySelector('[data-slot="media-frame-poster"]')).toBeNull()
  })

  it('shows a decorative player silhouette until the media is ready, then yields it', async () => {
    const record = await mountVideo(vimeoNode, undefined, () => {})

    const placeholder = container.querySelector('[data-slot="media-frame-placeholder"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder?.getAttribute('data-kind')).toBe('video')
    // Decorative only: hidden from assistive tech and carrying no focusable or
    // interactive control of its own.
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true')
    expect(placeholder?.querySelector('button')).toBeNull()
    expect(placeholder?.querySelector('[role="button"]')).toBeNull()
    expect(placeholder?.querySelector('[tabindex]')).toBeNull()
    // A player silhouette: exactly one static skeleton fills the frame, with a
    // single play glyph centered over it — no bottom progress/control row.
    expect(placeholder?.querySelectorAll('[data-slot="skeleton"]').length).toBe(1)
    expect(placeholder?.querySelector('svg')).not.toBeNull()
    expect(placeholder?.querySelector('.items-center.justify-center')).not.toBeNull()
    // Static: nothing in the silhouette carries the skeleton's default pulse.
    expect(placeholder?.querySelector('.animate-pulse')).toBeNull()
    expect(placeholder?.querySelector('.animate-none')).not.toBeNull()

    // Once the media genuinely renders, the silhouette yields with the frame.
    await act(async () => {
      record.onDuration?.(120)
    })
    expect(container.querySelector('[data-slot="media-frame-placeholder"]')).toBeNull()
  })
})

describe('Video page ownership', () => {
  it('refuses to render without a page owner', () => {
    // An ownerless video has no page to scope its persisted position to, so
    // the context-aware Video demands PageProvider ownership instead of
    // silently rendering without save or restore.
    expect(() =>
      renderToStaticMarkup(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={videoPackageFor(vimeoNode)}>
            <Video node={vimeoNode} />
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    ).toThrow('Video must be rendered within a PageProvider')
  })
})

describe('Video resume and persistence', () => {
  it('waits for a usable duration before seeking to the restored position and never autoplays', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 12.3, onPosition)

    // Not ready yet: no seek, no autoplay, nothing persisted.
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(onPosition).not.toHaveBeenCalled()

    // Ready alone is only a probe — without a duration the player is not
    // seekable, so nothing is issued.
    await act(async () => {
      record.onReady?.()
    })
    expect(players.seekTo).not.toHaveBeenCalled()

    // The duration report is the gate, and the seek lands exactly once.
    await act(async () => {
      record.onDuration?.(120)
    })

    // The seek is typed so ReactPlayer never treats a sub-second value as a
    // fraction, and carries `keepPlaying: false` so the restore pauses across
    // every provider rather than relying on the provider-specific default.
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(12.3, 'seconds', false)
    expect(record.playing).toBeFalsy()
    // The restored position is already persisted, so ready writes nothing back.
    expect(onPosition).not.toHaveBeenCalled()
  })

  it('does not seek when there is no restored position', async () => {
    const record = await mountVideo(vimeoNode, 0, () => {})
    await act(async () => {
      record.onReady?.()
    })
    await act(async () => {
      record.onDuration?.(120)
    })
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('throttles progress to five seconds and persists promptly on pause and seek', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    act(() => record.onProgress?.({ playedSeconds: 3 }))
    act(() => record.onProgress?.({ playedSeconds: 6 }))
    act(() => record.onProgress?.({ playedSeconds: 7 }))
    expect(savedPositions(onPosition)).toEqual([6])

    players.getCurrentTime.mockReturnValue(20.27)
    act(() => record.onPause?.())
    act(() => record.onSeek?.(30))
    expect(savedPositions(onPosition)).toEqual([6, 20.3, 30])
  })

  it('falls back to the last progress tick when the provider exposes no live time', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    act(() => record.onProgress?.({ playedSeconds: 2 }))
    expect(onPosition).not.toHaveBeenCalled()

    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onPause?.())
    expect(savedPositions(onPosition)).toEqual([2])
  })

  it('resets a finished video to the beginning and ignores the trailing pause', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    act(() => record.onProgress?.({ playedSeconds: 60 }))
    players.getCurrentTime.mockReturnValue(60)
    act(() => record.onEnded?.())
    // Persist the reset, not the duration, so a replay starts at the beginning.
    expect(savedPositions(onPosition)).toEqual([60, 0])

    // Some providers emit a trailing tick and a pause as they stop at the end;
    // neither may restore the finished position over the reset.
    act(() => record.onProgress?.({ playedSeconds: 60 }))
    act(() => record.onPause?.())
    expect(savedPositions(onPosition)).toEqual([60, 0])
  })

  it('persists a replay position once play clears the ended guard', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    players.getCurrentTime.mockReturnValue(60)
    act(() => record.onProgress?.({ playedSeconds: 60 }))
    act(() => record.onEnded?.())
    act(() => record.onPlay?.())

    players.getCurrentTime.mockReturnValue(3)
    act(() => record.onPause?.())
    expect(savedPositions(onPosition)).toEqual([60, 0, 3])
  })

  it('flushes the latest progress tick once on teardown', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    act(() => record.onProgress?.({ playedSeconds: 6 }))
    act(() => record.onProgress?.({ playedSeconds: 8 }))
    expect(savedPositions(onPosition)).toEqual([6])

    // The ReactPlayer ref is gone by teardown, so the last progress tick is the
    // fallback the single flush persists.
    act(() => root.unmount())
    expect(savedPositions(onPosition)).toEqual([6, 8])
  })

  it('does not flush the finished duration after an end reset', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, 0, onPosition)
    await act(async () => {
      record.onReady?.()
    })

    players.getCurrentTime.mockReturnValue(120)
    act(() => record.onProgress?.({ playedSeconds: 120 }))
    act(() => record.onEnded?.())
    act(() => root.unmount())
    expect(savedPositions(onPosition)).toEqual([120, 0])
  })

  it('ignores a late provider event after unmount', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(vimeoNode, undefined, onPosition)

    act(() => root.unmount())
    act(() => {
      record.onProgress?.({ playedSeconds: 10 })
      record.onPause?.()
    })

    expect(onPosition).not.toHaveBeenCalled()
  })

  it('threads the restored position into nested quote content only', async () => {
    const quote: ContentNode = { type: 'quote', children: [vimeoNode] }
    const questionnaire: ContentNode = {
      type: 'questionnaire',
      id: 'questionnaire:lesson.mdx:1:1',
      contributesToScore: false,
      revealCorrectAnswers: true,
      maxAttempts: 1,
      shuffleOptions: false,
      questions: [
        {
          type: 'question',
          id: 'question:lesson.mdx:1:1',
          questionType: 'single-choice',
          prompt: 'A video prompt',
          options: [
            {
              value: 'a',
              correct: true,
              content: 'A'
            }
          ]
        }
      ]
    }
    const pageId = 'page:lesson.mdx'
    const nodes = [quote, questionnaire]
    const contentPackage: ContentPackage = {
      metadata: { title: 'Video content' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: pageId,
            source: 'lesson.mdx',
            metadata: { title: 'Lesson' },
            content: nodes
          }
        ]
      }
    }
    window.scormBridge = {
      restoreState: () => ({ pages: { [pageId]: { videos: { [VIDEO_ID]: 9.5 } } } })
    }

    await act(async () => {
      root.render(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={contentPackage}>
            <PageProvider pageId={pageId}>
              <ContentRenderer nodes={nodes} />
            </PageProvider>
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    })

    const records = players.records
    expect(records).toHaveLength(1)
    for (const record of records) {
      await act(async () => {
        record.onReady?.()
      })
      await act(async () => {
        record.onDuration?.(100)
      })
    }

    expect(players.seekTo).toHaveBeenCalledTimes(records.length)
    for (const call of players.seekTo.mock.calls) {
      expect(call).toEqual([9.5, 'seconds', false])
    }
  })
})

describe('Video watch requirements', () => {
  const requiredNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 60 }

  it('persists accumulated watch seconds while active playback advances', async () => {
    const onPosition = vi.fn()
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    progressAfter(record, 5.8, 1.8)

    // Every continuous tick extends the accumulated total and persists it; the
    // playback position persists on its own coarse cadence for a later resume.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 5.8])
    expect(savedPositions(onPosition)).toEqual([2])
  })

  it('credits only elapsed wall time, even when media advance stays within tolerance', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(
      { ...requiredNode, provider: 'youtube', src: providerSources.youtube },
      undefined,
      vi.fn(),
      undefined,
      onWatchSeconds
    )
    startWatching(record)

    // Media jumped 1.8s in one wall second, then 0.7s in a quarter second, then
    // 0.3s backward in three quarters of a second: only elapsed wall time is
    // ever credited, never the media-time delta.
    progressAfter(record, 2)
    progressAfter(record, 3.8, 1)
    progressAfter(record, 4.5, 0.25)
    progressAfter(record, 4.2, 0.75)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 3, 4])
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it.each<VideoProvider>(['vimeo', 'youtube'])(
    'credits %s watch time only by elapsed wall time, never at zero elapsed',
    async (provider) => {
      const onWatchSeconds = vi.fn()
      const record = await mountVideo(
        { ...requiredNode, provider, src: providerSources[provider] },
        undefined,
        vi.fn(),
        undefined,
        onWatchSeconds
      )
      startWatching(record)

      progressAfter(record, 2)
      // Each repeated jump is small enough to pass the discontinuity tolerance,
      // yet no elapsed time accrues, so the total must not grow.
      progressAfter(record, 2.9, 0)
      progressAfter(record, 3.9, 0)
      progressAfter(record, 2.9, 0)
      progressAfter(record, 3.9, 0)
      progressAfter(record, 2.9, 0)
      progressAfter(record, 3.9, 0)

      expect(savedWatchSeconds(onWatchSeconds)).toEqual([2])
      // A jump is never corrected away: seeking is free on every provider.
      expect(players.seekTo).not.toHaveBeenCalled()
    }
  )

  it('discards a YouTube seekless progress jump without crediting or reverting playback', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(
      { ...requiredNode, provider: 'youtube', src: providerSources.youtube },
      undefined,
      onPosition,
      undefined,
      onWatchSeconds
    )
    startWatching(record)

    progressAfter(record, 3)
    progressAfter(record, 40, 1)

    // YouTube never emits `onSeek`, so only the progress discontinuity itself
    // can spot the jump: the interval is discarded whole and the segment is
    // re-baselined at the jumped position, without any corrective seek.
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3])
    expect(savedPositions(onPosition)).toEqual([3, 40])

    // Playback continues measuring from the real position afterwards.
    progressAfter(record, 42, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3, 5])
    expect(savedPositions(onPosition)).toEqual([3, 40])
  })

  it('discards a backward YouTube progress jump and never rewinds playback', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(
      { ...requiredNode, provider: 'youtube', src: providerSources.youtube },
      undefined,
      onPosition,
      undefined,
      onWatchSeconds
    )
    startWatching(record)

    progressAfter(record, 3)
    progressAfter(record, 40, 1)
    progressAfter(record, 2, 1)

    // The backward jump lands wherever the provider actually is; the interval
    // is discarded and the player is left exactly where it sought.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3])
    expect(savedPositions(onPosition)).toEqual([3, 40, 2])

    progressAfter(record, 4, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3, 5])
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('allows a reported seek and records only the continuous tail before it', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 3)
    act(() => record.onSeek?.(50))

    // Vimeo reports seeks directly. The seek is never blocked or corrected,
    // and it closes the active interval: nothing beyond the watched tail is
    // credited for landing on new media.
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3])
    expect(savedPositions(onPosition)).toEqual([3, 50])

    // A backward seek is equally free.
    act(() => record.onSeek?.(1))
    expect(savedPositions(onPosition)).toEqual([3, 50, 1])

    progressAfter(record, 2, 1)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3, 4])
  })

  it('discards the unsampled watch tail at a reported seek and resumes from its target', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 3)
    // Vimeo reports `onSeek` after the seek has completed; the elapsed wall
    // time since this sample may include the seek or buffering operation.
    watchClock += 2000
    act(() => record.onSeek?.(50))

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3])
    expect(savedPositions(onPosition)).toEqual([3, 50])
    expect(players.seekTo).not.toHaveBeenCalled()

    // The seek remains unrestricted, and active playback from its target starts
    // a fresh interval that accumulates normally.
    progressAfter(record, 52, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3, 5])
    expect(savedPositions(onPosition)).toEqual([3, 50])
  })

  it('accumulates again when a watched segment is replayed', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    act(() => record.onSeek?.(1))
    progressAfter(record, 2, 1)
    act(() => record.onSeek?.(1))
    progressAfter(record, 2, 1)

    // Rewatching the same segment adds to the total each time.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 5, 6])
  })

  it('does not credit time across a pause and resumes where playback actually is', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2)
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onPause?.())

    // Paused wall time is never credited: the total stays at what was watched.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2])

    progressAfter(record, 30)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2])

    // Resuming neither seeks nor rewinds the player; accumulation restarts
    // from wherever playback actually is.
    players.getCurrentTime.mockReturnValue(40)
    act(() => record.onPlay?.())
    expect(players.seekTo).not.toHaveBeenCalled()

    progressAfter(record, 42, 2)
    progressAfter(record, 45, 3)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 7])
    expect(savedPositions(onPosition)).toEqual([2, 30, 42])
  })

  it('does not credit time while buffering and resumes accumulating from the real position', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onBuffer?.())

    progressAfter(record, 9)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4])

    // Buffering ended wherever the provider resumed; the gap does not count
    // and the player is never pulled back.
    players.getCurrentTime.mockReturnValue(12)
    act(() => record.onBufferEnd?.())
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedPositions(onPosition)).toEqual([2, 9])

    progressAfter(record, 14, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 6])
    expect(savedPositions(onPosition)).toEqual([2, 9, 14])
  })

  it('resumes an unfinished required video at its saved playback position', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, 60, onPosition, 10, vi.fn())

    await act(async () => {
      record.onReady?.()
    })
    await act(async () => {
      record.onDuration?.(200)
    })

    // The saved position is restored wholesale: watch progress no longer
    // bounds where a resume may start, and the restore never autoplays.
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(60, 'seconds', false)
    expect(record.playing).toBeFalsy()
    expect(onPosition).not.toHaveBeenCalled()
  })

  it('continues accumulating from restored watch seconds after playback begins', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, 60, vi.fn(), 10, onWatchSeconds)

    await act(async () => {
      record.onDuration?.(200)
    })
    startWatching(record)
    progressAfter(record, 62, 2)

    // The persisted 10 seconds were restored, and two more active seconds
    // accrue from there.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([12])
  })

  it('restores accumulated watch seconds into a component without a resume position', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), 10, onWatchSeconds)

    // Restoring alone never reports anything; totals only move through play.
    expect(onWatchSeconds).not.toHaveBeenCalled()

    startWatching(record)
    progressAfter(record, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([12])
  })

  it('resumes a required video at its saved position once the requirement is met', async () => {
    const record = await mountVideo(requiredNode, 100, vi.fn(), 60, vi.fn())

    await act(async () => {
      record.onDuration?.(200)
    })
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(100, 'seconds', false)
  })

  it('seeds YouTube with the saved playback position regardless of watch progress', async () => {
    const record = await mountVideo(
      { ...requiredNode, provider: 'youtube', src: providerSources.youtube },
      60,
      vi.fn(),
      10,
      vi.fn()
    )

    // The saved position seeds the iframe directly; watch progress no longer
    // clamps it, and no imperative seek is ever involved.
    expect(record.config?.youtube?.playerVars?.start).toBe(60)

    await act(async () => {
      record.onDuration?.(200)
    })
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('credits 30 wall seconds at 2x playback as 30 seconds of watch time', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    act(() => record.onPlaybackRateChange?.(2))
    progressAfter(record, 60, 30)

    // The credited amount is elapsed wall time at the active rate, never the
    // media-time delta: 30 real seconds at 2x do not become a full minute.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([30])
  })

  it('closes the active interval under the old rate when the rate changes mid-playback', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 10, 10)
    act(() => record.onPlaybackRateChange?.(2))
    progressAfter(record, 34, 3)

    // The elapsed 3 seconds are credited once under the new rate; the 24
    // seconds of media the faster playback covered add nothing extra.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([10, 13])
  })

  it('credits elapsed watch time independently of system clock changes', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)
    let systemClock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => systemClock)

    // A wall-clock jump cannot satisfy the 60-second requirement; only the
    // monotonic test clock advanced by progressAfter contributes watch time.
    systemClock += 120_000
    progressAfter(record, 2, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2])

    systemClock -= 240_000
    progressAfter(record, 4, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4])
  })

  it('caps accumulated watch seconds at the authored minimum and keeps seeking free', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const eagerNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 6 }
    const record = await mountVideo(eagerNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    for (const tick of [2, 4, 6]) {
      progressAfter(record, tick, 2)
    }
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 6])

    // Playback past the requirement neither grows nor re-reports the total.
    progressAfter(record, 8, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 6])

    // Seeking remains free at every stage of the requirement.
    act(() => record.onSeek?.(100))
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedPositions(onPosition)).toEqual([2, 8, 100])

    progressAfter(record, 110, 1)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 6])
    expect(savedPositions(onPosition)).toEqual([2, 8, 100, 110])
  })

  it('does not credit a seek to the end followed by the end event', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 3)
    act(() => record.onSeek?.(50))
    act(() => record.onEnded?.())

    // Landing on the end through a seek adds nothing: only the watched 3
    // seconds count, so the requirement is not met by the seek alone.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([3])
  })

  it('never credits the requirement through the end event alone', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    // The learner watched every available second, but the accumulated total
    // only ever equals real watch time: the end event adds nothing beyond it.
    progressAfter(record, 45, 45)
    act(() => record.onEnded?.())

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([45])
    expect(savedPositions(onPosition)).toEqual([45, 0])
  })

  it('credits the tail since the last tick when playback reaches the end', async () => {
    const onWatchSeconds = vi.fn()
    const tailNode: VideoNode = { ...vimeoNode, duration: 50, minWatchTime: 42 }
    const record = await mountVideo(tailNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 38, 38)
    // Four wall seconds pass before the provider reports the end; that active
    // tail still belongs to the last interval and completes the requirement.
    watchClock += 4000
    act(() => record.onEnded?.())

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([38, 42])
  })

  it('flushes the accumulated watch tail once on teardown', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4])

    // Time accrues after the last progress tick; leaving mid-playback flushes
    // that tail exactly once so at most one tick of watch time is lost.
    watchClock += 1500
    act(() => root.unmount())
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 5.5])
  })

  it('never records watch time for a video without a requirement', async () => {
    const onPosition = vi.fn()
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(vimeoNode, undefined, onPosition, undefined, onWatchSeconds)

    progressAfter(record, 2)
    progressAfter(record, 40)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([])
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedPositions(onPosition)).toEqual([2, 40])
  })

  it('flushes a subsecond final increment and completes the indicator during playback', async () => {
    const eagerNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 6 }
    const onWatchSeconds = vi.fn()
    await mountVideo(eagerNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(players.latest())
    const requirement = () => container.querySelector('[data-video-requirement]')

    expect(requirement()?.getAttribute('data-complete')).toBe('false')
    expect(requirement()?.textContent).toContain('Required viewing 0:00 / 0:06')

    progressAfter(players.latest(), 2)
    expect(requirement()?.textContent).toContain('Required viewing 0:02 / 0:06')

    progressAfter(players.latest(), 4, 2)
    expect(requirement()?.textContent).toContain('Required viewing 0:04 / 0:06')

    progressAfter(players.latest(), 5.1, 1.1)
    expect(requirement()?.getAttribute('data-complete')).toBe('false')
    expect(requirement()?.textContent).toContain('Required viewing 0:05 / 0:06')

    // The final half-second crosses the cap by less than the one-second save
    // cadence. It must be persisted now, while playback remains active.
    progressAfter(players.latest(), 6, 0.9)
    expect(requirement()?.getAttribute('data-complete')).toBe('true')
    expect(requirement()?.textContent).toContain('Required viewing complete')
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 5.1, 6])

    // Continued playback at the cap neither stalls completion nor creates
    // repeated writes.
    progressAfter(players.latest(), 8, 2)
    expect(requirement()?.getAttribute('data-complete')).toBe('true')
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 5.1, 6])
  })

  it('saves and restores required YouTube watch progress through the player session', async () => {
    const youtubeNode: VideoNode = {
      ...vimeoNode,
      provider: 'youtube',
      src: providerSources.youtube,
      duration: 120,
      minWatchTime: 6
    }
    const contentPackage = videoPackageFor(youtubeNode)
    let savedState: PlayerState = { pages: {} }
    const saveState = vi.fn((state: PlayerState) => {
      savedState = state
    })
    window.scormBridge = {
      restoreState: () => savedState,
      saveState
    }

    const renderVideo = async (): Promise<RecordedPlayer> => {
      await act(async () => {
        root.render(
          <PlayerI18nProvider>
            <PlayerProvider contentPackage={contentPackage}>
              <PageProvider pageId={VIDEO_PAGE_ID}>
                <Video node={youtubeNode} />
              </PageProvider>
            </PlayerProvider>
          </PlayerI18nProvider>
        )
      })
      return players.latest()
    }

    const record = await renderVideo()
    const requirement = () => container.querySelector('[data-video-requirement]')
    expect(requirement()?.textContent).toContain('Required viewing 0:00 / 0:06')

    startWatching(record)
    progressAfter(record, 2, 2)
    expect(requirement()?.textContent).toContain('Required viewing 0:02 / 0:06')

    progressAfter(record, 4, 2)
    expect(requirement()?.textContent).toContain('Required viewing 0:04 / 0:06')

    // YouTube does not report `onSeek`: a seek appears as a progress jump. It is
    // left at the learner's target without crediting the jump, then playback
    // continues and the next real interval advances the requirement.
    progressAfter(record, 40, 1)
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(requirement()?.textContent).toContain('Required viewing 0:04 / 0:06')
    expect(savedState.pages[VIDEO_PAGE_ID]?.videos).toEqual({ [youtubeNode.id]: 40 })
    expect(savedState.pages[VIDEO_PAGE_ID]?.videoWatchSeconds).toEqual({ [youtubeNode.id]: 4 })

    progressAfter(record, 41, 1)
    expect(requirement()?.textContent).toContain('Required viewing 0:05 / 0:06')
    expect(savedState.pages[VIDEO_PAGE_ID]?.videoWatchSeconds).toEqual({ [youtubeNode.id]: 5 })
    expect(players.seekTo).not.toHaveBeenCalled()

    // Unmount flushes the latest playback position. A fresh session restores
    // YouTube's `start` from t while the requirement label is independently
    // derived from the accumulated w value.
    act(() => root.unmount())
    root = createRoot(container)
    const resumed = await renderVideo()

    expect(resumed.config?.youtube?.playerVars?.start).toBe(41)
    expect(requirement()?.textContent).toContain('Required viewing 0:05 / 0:06')
    expect(resumed.playing).toBeFalsy()
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('renders no requirement indicator for a video without a minimum', async () => {
    await mountVideo(vimeoNode, undefined, vi.fn(), undefined, vi.fn())
    expect(container.querySelector('[data-video-requirement]')).toBeNull()
  })

  it('accumulates independent watch seconds for every required video', async () => {
    const first: VideoNode = {
      ...vimeoNode,
      id: 'video:first.mdx:1:1',
      src: './first.mp4',
      duration: 120,
      minWatchTime: 6
    }
    const second: VideoNode = {
      ...requiredNode,
      id: 'video:second.mdx:1:1',
      provider: 'youtube',
      src: providerSources.youtube
    }
    const watchedByVideo = new Map<string, number>()
    const nodesById = new Map([first, second].map((node) => [node.id, node]))
    window.scormBridge = {
      restoreState: (): PlayerState => ({ pages: {} }),
      saveState: (state) => {
        for (const [videoId, watched] of Object.entries(
          state.pages[VIDEO_PAGE_ID]?.videoWatchSeconds ?? {}
        )) {
          if (nodesById.has(videoId) && typeof watched === 'number') {
            watchedByVideo.set(videoId, watched)
          }
        }
      }
    }
    await act(async () => {
      root.render(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={videoPackageOf([first, second])}>
            <PageProvider pageId={VIDEO_PAGE_ID}>
              <Video node={first} />
              <Video node={second} />
            </PageProvider>
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    })
    const [firstPlayer, secondPlayer] = players.records
    startWatching(firstPlayer, secondPlayer)

    // The wall clock is shared, so each video's ticks are sequenced to keep
    // every player's elapsed interval readable.
    progressAfter(secondPlayer, 3, 3)
    // The second video's seekless YouTube jump is discarded whole, without
    // touching the first video's accumulated total or either player.
    progressAfter(secondPlayer, 40, 1)
    progressAfter(firstPlayer, 2, 2)
    expect(players.seekTo).not.toHaveBeenCalled()

    expect(watchedByVideo.get(first.id)).toBe(6)
    expect(watchedByVideo.get(second.id)).toBe(3)
  })
})

describe('Video watch accrual guards', () => {
  const requiredNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 60 }

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState
  })

  it.each<VideoProvider>(['vimeo', 'youtube'])(
    'does not accrue required viewing from progress polls before playback starts for %s',
    async (provider) => {
      const onWatchSeconds = vi.fn()
      watchClock = 0
      vi.spyOn(performance, 'now').mockImplementation(() => watchClock)
      const record = await mountVideo(
        { ...requiredNode, provider, src: providerSources[provider] },
        undefined,
        vi.fn(),
        undefined,
        onWatchSeconds
      )
      const requirement = () => container.querySelector('[data-video-requirement]')

      // Providers keep polling progress while a player is merely loading, and
      // none of that load time is watching: the requirement stays untouched
      // until the learner actually plays.
      progressAfter(record, 30, 30)
      progressAfter(record, 45, 15)

      expect(savedWatchSeconds(onWatchSeconds)).toEqual([])
      expect(requirement()?.getAttribute('data-complete')).toBe('false')
      expect(requirement()?.textContent).toContain('Required viewing 0:00 / 1:00')
    }
  )

  it('does not accrue required viewing from polls at a paused restored Vimeo seek', async () => {
    const onPosition = vi.fn()
    const onWatchSeconds = vi.fn()
    watchClock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => watchClock)
    const record = await mountVideo(requiredNode, 60, onPosition, undefined, onWatchSeconds)

    await act(async () => {
      record.onReady?.()
    })
    await act(async () => {
      record.onDuration?.(200)
    })
    // The restore seeks imperatively and leaves the player paused.
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(60, 'seconds', false)

    // Provider polls beside and beyond the restored position are inert for the
    // requirement while the player stays paused.
    progressAfter(record, 60, 2)
    progressAfter(record, 66, 6)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([])
    expect(container.querySelector('[data-video-requirement]')?.textContent).toContain(
      'Required viewing 0:00 / 1:00'
    )
    // The resumed position itself still persists on its normal cadence.
    expect(savedPositions(onPosition)).toEqual([66])
  })

  it('credits a small media lag but discards a progress gap whose media barely advanced', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 2, 2)
    // Provider progress caching can trail the wall clock; a short interval
    // still counts as watching.
    progressAfter(record, 2.6, 2)
    // A long wall gap whose media barely moved is a stalled or suspended
    // provider, not watching: the whole interval is discarded, never credited.
    progressAfter(record, 3, 30)
    // Once intervals are real again, accumulation resumes from the media's
    // actual position.
    progressAfter(record, 5, 2)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2, 4, 6])
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('ignores wall time while the document is hidden and resumes accumulation on return', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 4, 4)
    // Hiding the page credits the visible tail and closes the interval.
    setDocumentHidden(true)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4])

    // A suspended page stops callbacks while wall time keeps moving; a stray
    // poll that reaches the hook through the hidden interval counts nothing.
    watchClock += 30_000
    progressAfter(record, 4.1, 1)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4])

    // Returning to a visible page re-baselines at the media's real position.
    setDocumentHidden(false)
    progressAfter(record, 6.1, 2)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4, 6])
  })

  it('does not accrue while mounted with the document already hidden until it becomes visible', async () => {
    const onWatchSeconds = vi.fn()
    setDocumentHidden(true)
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 10, 10)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([])

    setDocumentHidden(false)
    progressAfter(record, 12, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([2])
  })
})

describe('Unverified watch tails stay bounded', () => {
  const requiredNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 60 }
  const tailNode: VideoNode = { ...vimeoNode, duration: 50, minWatchTime: 42 }

  it('credits a pause tail at the unverified bound but discards a longer one', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 4, 4)
    // Five wall seconds without a fresh progress reading is still active
    // playback, so the pause tail credits it.
    watchClock += 5000
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onPause?.())
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4, 9])

    act(() => record.onPlay?.())
    progressAfter(record, 6, 2)
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4, 9, 11])

    // A longer unverified tail is a delayed callback, not uninterrupted
    // playback, so it cannot inflate the total.
    watchClock += 5500
    act(() => record.onPause?.())
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4, 9, 11])
  })

  it('does not credit a long end tail without a fresh progress reading', async () => {
    const onWatchSeconds = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(tailNode, undefined, onPosition, undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 38, 38)
    watchClock += 10000
    act(() => record.onEnded?.())

    // The end tail is bounded: a long one neither completes the requirement by
    // itself nor disturbs the finished reset.
    expect(savedWatchSeconds(onWatchSeconds)).toEqual([38])
    expect(savedPositions(onPosition)).toEqual([38, 0])
  })

  it('does not credit a long buffered tail without a fresh progress reading', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 4, 4)
    watchClock += 9000
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onBuffer?.())

    // Buffering resumed at its own real position and accumulation continues
    // from there, never from the wall gap.
    players.getCurrentTime.mockReturnValue(4)
    act(() => record.onBufferEnd?.())
    progressAfter(record, 6, 2)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4, 6])
  })

  it('does not credit a long rate-change tail without a fresh progress reading', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 10, 10)
    watchClock += 8000
    act(() => record.onPlaybackRateChange?.(2))
    progressAfter(record, 14, 2)

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([10, 12])
  })

  it('does not flush a long watch tail on teardown', async () => {
    const onWatchSeconds = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatchSeconds)
    startWatching(record)

    progressAfter(record, 4, 4)
    watchClock += 9000
    act(() => root.unmount())

    expect(savedWatchSeconds(onWatchSeconds)).toEqual([4])
  })
})

describe('Video provider ready timing', () => {
  const youtubeNode: VideoNode = {
    ...vimeoNode,
    provider: 'youtube',
    src: providerSources.youtube
  }

  /**
   * Reports ready the way a provider does. Native and Vimeo report once; YouTube
   * reports twice, first when the iframe API is ready (before the video is cued
   * and its duration is known) and again once the video is cued.
   */
  async function reportReady(record: RecordedPlayer, times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        record.onReady?.()
      })
    }
  }

  /** Reports the media duration, the signal a seek can actually land after. */
  async function reportDuration(record: RecordedPlayer, duration: number): Promise<void> {
    await act(async () => {
      record.onDuration?.(duration)
    })
  }

  it('does not seek on an early YouTube ready before the duration exists', async () => {
    const record = await mountVideo(youtubeNode, 12.3, () => {})

    // The first ready is the iframe API, before the video is cued, so
    // `getDuration` is still 0/undefined and a seek would be dropped (or wedge
    // the player on a black frame); the second ready is the cued state change.
    await reportReady(record, 2)
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(record.playing).toBeFalsy()
  })

  it('keeps the placeholder over YouTube’s early ready until the duration arrives', async () => {
    const record = await mountVideo(youtubeNode, undefined, () => {})

    // YouTube fires `onReady` when the iframe API loads, before the video is
    // cued; revealing the frame there would expose the provider's black iframe.
    await reportReady(record, 2)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    // The duration only arrives once the video is cued, which is when the media
    // is genuinely rendered and the placeholder may yield.
    await reportDuration(record, 213)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it('never seeks for YouTube, carrying the resume position in playerVars.start instead', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(youtubeNode, 12.3, onPosition)

    // The position is forwarded to the provider up front, so no imperative seek
    // is ever issued — the black-frame path is avoided entirely.
    expect(record.config?.youtube?.playerVars?.start).toBe(12.3)

    await reportReady(record, 2)
    await reportDuration(record, 213)
    expect(players.seekTo).not.toHaveBeenCalled()
    // Still never autoplays, and the resumed position was already persisted.
    expect(record.playing).toBeFalsy()
    expect(onPosition).not.toHaveBeenCalled()

    // A stray repeat of either signal must not re-apply anything.
    await reportDuration(record, 213)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('keeps the YouTube start stable when later progress updates the saved position', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(youtubeNode, 12.3, onPosition)

    startWatching(record)
    progressAfter(record, 20, 8)

    // Playback persisted a new position, so the component re-rendered with it;
    // the provider's initial start must remain the value it mounted with.
    expect(onPosition).toHaveBeenCalled()
    expect(players.latest().config?.youtube?.playerVars?.start).toBe(12.3)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('ignores a zero, negative or NaN duration without seeking', async () => {
    const record = await mountVideo(youtubeNode, 12.3, () => {})
    await reportReady(record)

    await reportDuration(record, 0)
    await reportDuration(record, -5)
    await reportDuration(record, Number.NaN)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    // A usable duration reveals the frame but still never seeks for YouTube.
    await reportDuration(record, 90)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('reveals a live stream with an infinite duration without seeking', async () => {
    const record = await mountVideo(vimeoNode, 12.3, () => {})

    // A live stream reports a positive `Infinity`. ReactPlayer treats any truthy
    // duration as ready and emits `onDuration` only once, so the reading must
    // reveal the frame rather than leaving the placeholder up forever — but it
    // offers no finite seekable duration, so no restore is attempted.
    await reportDuration(record, Number.POSITIVE_INFINITY)

    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('clamps a restored Vimeo position at or beyond the duration to just before the end', async () => {
    const record = await mountVideo(vimeoNode, 300, () => {})
    await reportDuration(record, 200)

    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(199, 'seconds', false)
  })

  it('rests a Vimeo position past the end of very short media at the start', async () => {
    const record = await mountVideo(vimeoNode, 5, () => {})
    await reportDuration(record, 0.5)

    expect(players.seekTo).toHaveBeenCalledWith(0, 'seconds', false)
  })

  it('closes the Vimeo restore window once playback takes over', async () => {
    const record = await mountVideo(vimeoNode, 12.3, () => {})
    await reportDuration(record, 200)
    expect(players.seekTo).toHaveBeenCalledTimes(1)

    act(() => record.onPlay?.())
    players.seekTo.mockClear()
    await reportReady(record)
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('closes the Vimeo restore window when the learner seeks before the duration arrives', async () => {
    const record = await mountVideo(vimeoNode, 12.3, () => {})
    await reportReady(record)

    act(() => record.onSeek?.(3))
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('restores the Vimeo position once the provider reports its duration', async () => {
    const record = await mountVideo(vimeoNode, 30, () => {})

    await reportReady(record)
    expect(players.seekTo).not.toHaveBeenCalled()

    await reportDuration(record, 120)
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(30, 'seconds', false)
  })

  it('does not seek without a restored position, even once the duration arrives', async () => {
    const record = await mountVideo(vimeoNode, 0, () => {})
    await reportReady(record, 2)
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })
})

describe('Media failure fallbacks', () => {
  it('replaces the video placeholder with a static error state when the player errors', async () => {
    const record = await mountVideo({ ...vimeoNode, poster: './poster.png' }, 12.3, () => {})
    expect(container.querySelector('[data-slot="media-frame-poster"]')).not.toBeNull()

    await act(async () => {
      record.onError?.()
    })

    // The poster stops and the provider player is gone, so the frame shows a
    // small readable error rather than a player stuck on a black frame.
    expect(container.querySelector('[data-slot="media-frame-poster"]')).toBeNull()
    expect(container.querySelector('[data-testid="react-player"]')).toBeNull()
    const error = container.querySelector('[data-slot="media-frame-error"]')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(error?.textContent).toBe('This video could not be played.')
  })

  it('reveals the broken image and its alt when the source fails to load', async () => {
    await act(async () => {
      root.render(
        <PlayerI18nProvider>
          <ContentRenderer nodes={[{ type: 'image', src: './missing.png', alt: 'A picture' }]} />
        </PlayerI18nProvider>
      )
    })
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    const image = container.querySelector('img')
    await act(async () => {
      image?.dispatchEvent(new Event('error'))
    })

    // The placeholder yields so the browser's own broken-image indicator and the
    // authored alt text are visible, instead of a placeholder that never resolves.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('A picture')
  })
})

describe('usePlayerSession video positions', () => {
  const PAGE_ID = 'page:lesson.mdx'
  const videoPackage: ContentPackage = {
    metadata: { title: 'Video package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: PAGE_ID,
          source: 'lesson.mdx',
          metadata: { title: 'Lesson' },
          content: [vimeoNode]
        }
      ]
    }
  }

  const secondVideoNode: VideoNode = {
    ...vimeoNode,
    id: 'video:second.mdx:1:1',
    src: './second.mp4'
  }
  /** Two pages, each owning a distinct video, to prove positions stay scoped. */
  const twoPageVideoPackage: ContentPackage = {
    metadata: { title: 'Two-page video package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:first.mdx',
          source: 'first.mdx',
          metadata: { title: 'First' },
          content: [vimeoNode]
        },
        {
          type: 'page',
          id: 'page:second.mdx',
          source: 'second.mdx',
          metadata: { title: 'Second' },
          content: [secondVideoNode]
        }
      ]
    }
  }

  it('persists a finite position normalized to tenths with unchanged package progress', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(videoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 12.34))
    const saved = lastSaved(saveState)
    expect(saved.pages[PAGE_ID]?.videos).toEqual({ [VIDEO_ID]: 12.3 })
    // Video playback never contributes to progress, so the accompanying write
    // carries the same integer the package would report without it.
    expect(saveState.mock.calls.at(-1)?.[1]).toBe(getPackageProgress(videoPackage, saved))

    const progress = saveState.mock.calls.at(-1)?.[1]
    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 40.06))
    expect(lastSaved(saveState).pages[PAGE_ID]?.videos).toEqual({ [VIDEO_ID]: 40.1 })
    expect(saveState.mock.calls.at(-1)?.[1]).toBe(progress)
    // Only the owning page gains state; there is no top-level videos map.
    expect(lastSaved(saveState).pages['page:other.mdx']).toBeUndefined()
    expect(lastSaved(saveState)).not.toHaveProperty('videos')
  })

  it('skips an update that normalizes to the stored position', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(videoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 20.3))
    const calls = saveState.mock.calls.length
    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 20.34))
    expect(saveState.mock.calls.length).toBe(calls)
    expect(lastSaved(saveState).pages[PAGE_ID]?.videos).toEqual({ [VIDEO_ID]: 20.3 })
  })

  it('ignores negative and non-finite positions', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(videoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, -1))
    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, Number.NaN))
    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, Number.POSITIVE_INFINITY))
    expect(saveState).not.toHaveBeenCalled()
    expect(session?.state.pages[PAGE_ID]).toBeUndefined()
  })

  it('keeps positions scoped to the page that owns each video', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(twoPageVideoPackage)

    act(() => session?.setVideoPosition('page:first.mdx', VIDEO_ID, 5))
    act(() => session?.setVideoPosition('page:second.mdx', secondVideoNode.id, 9.5))

    const saved = lastSaved(saveState)
    expect(saved.pages['page:first.mdx']?.videos).toEqual({ [VIDEO_ID]: 5 })
    expect(saved.pages['page:second.mdx']?.videos).toEqual({ [secondVideoNode.id]: 9.5 })
  })

  it('restores only the positions each page still owns', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          'page:first.mdx': {
            videos: {
              [VIDEO_ID]: 34.26,
              'video:gone.mdx:1:1': 10,
              stale: Number.NaN
            }
          },
          // VIDEO_ID belongs to page:first, not page:second, so it is dropped.
          'page:second.mdx': { videos: { [VIDEO_ID]: 99 } }
        }
      }),
      saveState
    }
    renderSession(twoPageVideoPackage)

    expect(session?.state.pages['page:first.mdx']?.videos).toEqual({ [VIDEO_ID]: 34.3 })
    expect(session?.state.pages['page:second.mdx']).toBeUndefined()
  })

  it('persists plain numbers, never provider objects', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(videoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 5))
    const saved = lastSaved(saveState)
    const videos = saved.pages[PAGE_ID]?.videos ?? {}
    expect(Object.values(videos).every((value) => typeof value === 'number')).toBe(true)
    expect(JSON.stringify(saved)).not.toMatch(/player|iframe|YT\.|youtube|vimeo/i)
  })
})

describe('usePlayerSession video watch requirements', () => {
  const PAGE_ID = 'page:lesson.mdx'
  const requiredNode: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 6 }
  const requiredVideoPackage: ContentPackage = {
    metadata: { title: 'Required video package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: PAGE_ID,
          source: 'lesson.mdx',
          metadata: { title: 'Lesson' },
          content: [requiredNode]
        }
      ]
    }
  }

  it('persists accumulated watch seconds separately from the playback position', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 30.5))
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 5.34))

    const saved = lastSaved(saveState)
    expect(saved.pages[PAGE_ID]?.videos).toEqual({ [VIDEO_ID]: 30.5 })
    expect(saved.pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 5.3 })
    // Video progress never contributes to package progress.
    expect(saveState.mock.calls.at(-1)?.[1]).toBe(getPackageProgress(requiredVideoPackage, saved))
  })

  it('never rewinds a monotonic total, caps it at the requirement, and skips no-op writes', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 5.5))
    const calls = saveState.mock.calls.length

    // A smaller reading never replaces a recorded total, and a value that
    // normalizes to the stored one is a no-op.
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 2))
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 5.54))
    expect(saveState.mock.calls.length).toBe(calls)
    expect(lastSaved(saveState).pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 5.5 })

    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 6))
    expect(lastSaved(saveState).pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 6 })

    // A reading beyond the six-second requirement persists capped, changing
    // nothing and never inflating completion.
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 20))
    expect(saveState.mock.calls.length).toBe(calls + 1)
    expect(lastSaved(saveState).pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 6 })
  })

  it('ignores invalid watch readings, including zero', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, Number.NaN))
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, -1))
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 0))
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, Number.POSITIVE_INFINITY))
    expect(saveState).not.toHaveBeenCalled()
    expect(session?.state.pages[PAGE_ID]).toBeUndefined()
  })

  it('ignores watch seconds for a video without a requirement', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(videoPackageFor(vimeoNode))

    act(() => session?.setVideoWatchSeconds(VIDEO_PAGE_ID, VIDEO_ID, 5))
    expect(saveState).not.toHaveBeenCalled()
    expect(session?.state.pages[VIDEO_PAGE_ID]).toBeUndefined()
  })

  it('keeps the page pending until the questionnaire and the required video are satisfied', () => {
    const quizPackage: ContentPackage = {
      metadata: { title: 'Quiz and video package' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: PAGE_ID,
            source: 'lesson.mdx',
            metadata: { title: 'Lesson' },
            content: [requiredNode, questionnaireNode]
          }
        ]
      }
    }
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(quizPackage)

    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, questionnaireNode.id))
    // The single-attempt default completes the submitted result automatically.
    expect(session?.state.pages[PAGE_ID]?.completedQuestionnaires).toEqual([questionnaireNode.id])

    // The unwatched required video keeps the page pending.
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()

    // Meeting the accumulated minimum unlocks completion.
    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 6))
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
  })

  it('keeps the page pending until every required video meets its own minimum', () => {
    const first: VideoNode = { ...requiredNode, id: 'video:first.mdx:1:1', minWatchTime: 6 }
    const second: VideoNode = { ...requiredNode, id: 'video:second.mdx:1:1', minWatchTime: 10 }
    const multiPackage: ContentPackage = {
      metadata: { title: 'Multiple required videos' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: PAGE_ID,
            source: 'lesson.mdx',
            metadata: { title: 'Lesson' },
            content: [first, second, questionnaireNode]
          }
        ]
      }
    }
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(multiPackage)

    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, questionnaireNode.id))

    act(() => session?.setVideoWatchSeconds(PAGE_ID, first.id, 6))
    act(() => session?.markCompleted(PAGE_ID))
    // One satisfied video is not enough while the other is still short.
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()

    act(() => session?.setVideoWatchSeconds(PAGE_ID, second.id, 3))
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()

    act(() => session?.setVideoWatchSeconds(PAGE_ID, second.id, 10))
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)

    const saved = lastSaved(saveState)
    expect(saved.pages[PAGE_ID]?.videoWatchSeconds).toEqual({
      [first.id]: 6,
      [second.id]: 10
    })
  })

  it('never gates a tiles item completion on a video requirement', () => {
    const tilesId = 'item:video.mdx'
    const tilesPackage: ContentPackage = {
      metadata: { title: 'Tiles video package' },
      presentation: {
        type: 'tiles',
        items: [
          {
            type: 'item',
            id: tilesId,
            source: 'video.mdx',
            metadata: { title: 'Video item' },
            content: [requiredNode]
          }
        ]
      }
    }
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(tilesPackage)

    act(() => session?.markSeen(tilesId))
    act(() => session?.markCompleted(tilesId))
    expect(session?.state.pages[tilesId]?.completed).toBe(true)
  })

  it('restores only the watch seconds each page owns, keeping met completion', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            visited: true,
            completed: true,
            videoWatchSeconds: { [VIDEO_ID]: 6, 'video:gone.mdx:1:1': 4 }
          }
        }
      }),
      saveState
    }
    renderSession(requiredVideoPackage)

    expect(session?.state.pages[PAGE_ID]).toEqual({
      visited: true,
      completed: true,
      videoWatchSeconds: { [VIDEO_ID]: 6 }
    })
  })

  it('drops completion carried by legacy state saved under the old watchedVideos field', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            visited: true,
            completed: true,
            // `watchedVideos` predates the accumulated model and is no longer
            // a declared page field, so the stale completion behind it drops.
            watchedVideos: { [VIDEO_ID]: 6 }
          }
          // Legacy page fields survive typechecking only as untyped state.
        } as unknown as PlayerState['pages']
      }),
      saveState
    }
    renderSession(requiredVideoPackage)

    // The old frontier field is unread, so the progress behind the stale
    // completion flag no longer exists and completion cannot be restored.
    expect(session?.state.pages[PAGE_ID]).toEqual({ visited: true })
  })

  it('drops completion that predates the requirement but keeps accumulated watch time', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            completed: true,
            videos: { [VIDEO_ID]: 20 },
            videoWatchSeconds: { [VIDEO_ID]: 3 }
          }
        }
      }),
      saveState
    }
    renderSession(requiredVideoPackage)

    expect(session?.state.pages[PAGE_ID]).toEqual({
      videos: { [VIDEO_ID]: 20 },
      videoWatchSeconds: { [VIDEO_ID]: 3 }
    })
  })
})

describe('Video watch requirement unlocks a slides page', () => {
  const slideVideo: VideoNode = { ...vimeoNode, duration: 120, minWatchTime: 6 }

  beforeEach(() => {
    // Slides presentations scroll onto the displayed slide; jsdom cannot.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  function slidesVideoPackage(): ContentPackage {
    return {
      metadata: { title: 'Slides video' },
      presentation: {
        type: 'slides',
        pages: [
          {
            type: 'page',
            id: 'page:first.mdx',
            source: 'first.mdx',
            metadata: { title: 'First' },
            content: [slideVideo]
          },
          {
            type: 'page',
            id: 'page:second.mdx',
            source: 'second.mdx',
            metadata: { title: 'Second' },
            content: [
              { type: 'paragraph', children: [{ type: 'text', value: 'After the video.' }] }
            ]
          }
        ]
      }
    }
  }

  it('shows the next control only once the required video is watched', async () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    const contentPackage = slidesVideoPackage()
    const provider = inlineContentProvider(contentPackage)
    const pages =
      contentPackage.presentation.type === 'slides' ? contentPackage.presentation.pages : []
    await act(async () => {
      root.render(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={contentPackage}>
            <SlidesPresentation pages={[...pages]} contentProvider={provider} />
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    })

    // The unwatched video keeps the slide gated: no next control.
    expect(container.querySelector('[data-slides-next]')).toBeNull()

    const record = players.latest()
    startWatching(record)
    progressAfter(record, 2, 2)
    progressAfter(record, 4, 2)
    progressAfter(record, 5.1, 1.1)
    expect(container.querySelector('[data-slides-next]')).toBeNull()

    // The final 0.9 seconds crosses the remaining requirement without a pause
    // or end event; the session update unlocks the next slide immediately.
    progressAfter(record, 6, 0.9)
    expect(container.querySelector('[data-slides-next] button')).not.toBeNull()

    act(() => container.querySelector<HTMLButtonElement>('[data-slides-next] button')?.click())
    expect(lastSaved(saveState).location).toBe('page:second.mdx')
  })
})
