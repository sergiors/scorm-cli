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

const nativeNode: VideoNode = {
  type: 'video',
  id: VIDEO_ID,
  provider: 'native',
  src: './lesson.mp4',
  title: 'Lesson video',
  poster: './poster.png',
  captions: './lesson.vtt'
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
  native: './lesson.mp4',
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
  watchedUntil?: number,
  onWatched?: (seconds: number) => void
): Promise<RecordedPlayer> {
  const pageId = VIDEO_PAGE_ID
  const contentPackage = videoPackageFor(node)
  let lastPosition = position
  let lastWatched = watchedUntil
  window.scormBridge = {
    restoreState: (): PlayerState => ({
      pages:
        position === undefined && watchedUntil === undefined
          ? {}
          : {
              [pageId]: {
                ...(position === undefined ? {} : { videos: { [node.id]: position } }),
                ...(watchedUntil === undefined
                  ? {}
                  : { watchedVideos: { [node.id]: watchedUntil } })
              }
            }
    }),
    saveState: (state) => {
      const nextPosition = state.pages[pageId]?.videos?.[node.id]
      if (nextPosition !== undefined && nextPosition !== lastPosition) {
        lastPosition = nextPosition
        onPosition(nextPosition)
      }
      const nextWatched = state.pages[pageId]?.watchedVideos?.[node.id]
      if (nextWatched !== undefined && nextWatched !== lastWatched) {
        lastWatched = nextWatched
        onWatched?.(nextWatched)
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

function savedWatched(onWatched: { mock: { calls: unknown[][] } }): number[] {
  return onWatched.mock.calls.map((call) => call[0] as number)
}

let watchClock = 0

function startWatching(...records: RecordedPlayer[]): void {
  watchClock = 0
  vi.spyOn(Date, 'now').mockImplementation(() => watchClock)
  for (const record of records) {
    act(() => record.onPlay?.())
  }
}

function progressAfter(record: RecordedPlayer, seconds: number, elapsed = seconds): void {
  watchClock += elapsed * 1000
  act(() => record.onProgress?.({ playedSeconds: seconds }))
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
  it.each<VideoProvider>(['native', 'youtube', 'vimeo'])(
    'feeds the canonical source and controls to ReactPlayer for %s',
    async (provider) => {
      const record = await mountVideo(
        { ...nativeNode, provider, src: providerSources[provider] },
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

  it('preserves poster and caption tracks for native playback', async () => {
    const record = await mountVideo(nativeNode, undefined, () => {})

    expect(record.config?.file?.attributes).toEqual({
      preload: 'metadata',
      poster: './poster.png'
    })
    expect(record.config?.file?.tracks).toEqual([
      {
        kind: 'captions',
        src: './lesson.vtt',
        srcLang: 'und',
        label: 'Captions',
        default: true
      }
    ])
  })

  it('titles the Vimeo iframe from the authored title', async () => {
    const record = await mountVideo(
      { ...nativeNode, provider: 'vimeo', src: providerSources.vimeo },
      undefined,
      () => {}
    )

    expect(record.config?.vimeo?.title).toBe('Lesson video')
  })

  it('localizes the caption track label for the authored language', async () => {
    await act(async () => {
      root.render(
        <PlayerI18nProvider lang="pt-BR">
          <VideoContext node={nativeNode} />
        </PlayerI18nProvider>
      )
    })
    const record = players.latest()
    expect(record.config?.file?.tracks?.[0]?.label).toBe('Legendas')
  })

  it.each<VideoProvider>(['native', 'youtube', 'vimeo'])(
    'reserves the same stable 16:9 placeholder frame for %s until it is ready',
    (provider) => {
      const html = renderToStaticMarkup(
        <PlayerI18nProvider>
          <VideoContext node={{ ...nativeNode, provider, src: providerSources[provider] }} />
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
    const record = await mountVideo(nativeNode, undefined, () => {})

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

  it('shows a decorative player silhouette until the media is ready, then yields it', async () => {
    const record = await mountVideo(nativeNode, undefined, () => {})

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
          <PlayerProvider contentPackage={videoPackageFor(nativeNode)}>
            <Video node={nativeNode} />
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    ).toThrow('Video must be rendered within a PageProvider')
  })
})

describe('Video resume and persistence', () => {
  it('waits for a usable duration before seeking to the restored position and never autoplays', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(nativeNode, 12.3, onPosition)

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
    const record = await mountVideo(nativeNode, 0, () => {})
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, 0, onPosition)
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
    const record = await mountVideo(nativeNode, undefined, onPosition)

    act(() => root.unmount())
    act(() => {
      record.onProgress?.({ playedSeconds: 10 })
      record.onPause?.()
    })

    expect(onPosition).not.toHaveBeenCalled()
  })

  it('threads the restored position into nested quote content only', async () => {
    const quote: ContentNode = { type: 'quote', children: [nativeNode] }
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
  const requiredNode: VideoNode = { ...nativeNode, duration: 120, minWatchTime: 60 }

  it('persists the verified frontier only while playback advances continuously', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    progressAfter(record, 5.8, 1.8)

    // Every continuous tick extends the frontier and persists it; the position
    // is persisted on its own coarse cadence for a later resume.
    expect(savedWatched(onWatched)).toEqual([2, 4, 5.8])
    expect(savedPositions(onPosition)).toEqual([2])
  })

  it('rejects a YouTube seekless progress jump beyond the frontier and pulls playback back', async () => {
    const onWatched = vi.fn()
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    progressAfter(record, 3)
    progressAfter(record, 40, 1)

    // YouTube never emits `onSeek`, so only the progress discontinuity itself
    // can reject the jump and pull the provider back to the frontier.
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(3, 'seconds', true)

    // The frontier did not move, and playback measures from it again.
    progressAfter(record, 4, 1)
    expect(savedWatched(onWatched)).toEqual([3, 4])
    expect(savedPositions(onPosition)).toEqual([3])
  })

  it('does not credit repeated immediate jumps within the discontinuity tolerance', async () => {
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatched)
    startWatching(record)

    progressAfter(record, 2)
    // Each 0.9s jump is small enough to pass the provider discontinuity check,
    // but repeated jumps without elapsed time must not move the watch frontier.
    progressAfter(record, 2.9, 0)
    progressAfter(record, 3.9, 0)
    progressAfter(record, 2.9, 0)
    progressAfter(record, 3.9, 0)
    progressAfter(record, 2.9, 0)
    progressAfter(record, 3.9, 0)

    expect(savedWatched(onWatched)).toEqual([2])
    expect(players.seekTo.mock.calls).toEqual([
      [2, 'seconds', true],
      [2, 'seconds', true],
      [2, 'seconds', true]
    ])
  })

  it('limits cumulative progress by elapsed time, including while the tab is hidden', async () => {
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatched)
    startWatching(record)
    progressAfter(record, 2)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    progressAfter(record, 3.8, 1)
    progressAfter(record, 4.5, 0.25)

    // The first reading is within the one-second discontinuity tolerance, but
    // only one second of elapsed wall time is credited. The cumulative media
    // advance then exceeds elapsed playback plus that tolerance, so the last is corrected.
    expect(savedWatched(onWatched)).toEqual([2, 3])
    expect(players.seekTo).toHaveBeenCalledWith(3, 'seconds', true)
  })

  it.each<VideoProvider>(['native', 'vimeo'])(
    'blocks a reported %s seek beyond the frontier and always allows backward seeking',
    async (provider) => {
      const onWatched = vi.fn()
      const onPosition = vi.fn()
      const record = await mountVideo(
        { ...requiredNode, provider, src: providerSources[provider] },
        undefined,
        onPosition,
        undefined,
        onWatched
      )
      startWatching(record)

      progressAfter(record, 3)
      act(() => record.onSeek?.(50))

      // Native and Vimeo report seeks directly, so the blocked seek returns
      // the player to the frontier immediately.
      expect(players.seekTo).toHaveBeenCalledTimes(1)
      expect(players.seekTo).toHaveBeenCalledWith(3, 'seconds', true)
      expect(savedWatched(onWatched)).toEqual([3])

      act(() => record.onSeek?.(1))
      expect(players.seekTo).toHaveBeenCalledTimes(1)
      expect(savedPositions(onPosition)).toEqual([3, 1])
    }
  )

  it('never verifies watched time across a pause and resumes through the frontier', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    progressAfter(record, 2)
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onPause?.())

    // The paused tail is the verified frontier itself: nothing new was watched.
    expect(savedWatched(onWatched)).toEqual([2])

    progressAfter(record, 30)
    expect(savedWatched(onWatched)).toEqual([2])

    // Resuming with a stale live position returns the player to the frontier,
    // and playback verifies again from that restored point.
    players.getCurrentTime.mockReturnValue(40)
    act(() => record.onPlay?.())
    expect(players.seekTo).toHaveBeenCalledWith(2, 'seconds', true)

    progressAfter(record, 3.5, 1.5)
    expect(savedWatched(onWatched)).toEqual([2, 3.5])
    expect(savedPositions(onPosition)).toEqual([2, 30, 2])
  })

  it('never verifies watched time while buffering and resumes from the real position', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    progressAfter(record, 2)
    progressAfter(record, 4, 2)
    players.getCurrentTime.mockReturnValue(null)
    act(() => record.onBuffer?.())

    progressAfter(record, 9)
    expect(savedWatched(onWatched)).toEqual([2, 4])

    // Buffering ended with the live position far past the frontier, so the
    // provider is pulled back once instead of crediting the gap.
    act(() => record.onBufferEnd?.())
    expect(players.seekTo).toHaveBeenCalledWith(4, 'seconds', true)
    expect(savedPositions(onPosition)).toEqual([2, 9, 4])

    progressAfter(record, 6, 2)
    expect(savedWatched(onWatched)).toEqual([2, 4, 6])
    expect(savedPositions(onPosition)).toEqual([2, 9, 4])
  })

  it('resumes an unfinished required video within its verified frontier', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(requiredNode, 60, onPosition, 10, vi.fn())

    await act(async () => {
      record.onReady?.()
    })
    await act(async () => {
      record.onDuration?.(200)
    })

    // The persisted position was saved before the requirement existed, so the
    // resume rests at the verified frontier and never autoplays.
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(10, 'seconds', false)
    expect(record.playing).toBeFalsy()
  })

  it('resumes a required video at its full position once the requirement is met', async () => {
    const record = await mountVideo(requiredNode, 60, vi.fn(), 60, vi.fn())

    await act(async () => {
      record.onDuration?.(200)
    })
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(60, 'seconds', false)
  })

  it('relaxes seeking once the authored minimum has been watched', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const eagerNode: VideoNode = { ...nativeNode, duration: 120, minWatchTime: 6 }
    const record = await mountVideo(eagerNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    for (const tick of [2, 4, 6]) {
      progressAfter(record, tick, 2)
    }
    expect(savedWatched(onWatched)).toEqual([2, 4, 6])

    // The requirement is met: a forward seek is no longer blocked or corrected.
    act(() => record.onSeek?.(100))
    expect(players.seekTo).not.toHaveBeenCalled()

    act(() => record.onProgress?.({ playedSeconds: 110 }))
    expect(savedPositions(onPosition)).toEqual([2, 100, 110])
    expect(savedWatched(onWatched)).toEqual([2, 4, 6])
  })

  it('completes the requirement at the natural end of shorter media', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, onPosition, undefined, onWatched)
    startWatching(record)

    // The provider media is shorter than the authored duration describes.
    await act(async () => {
      record.onDuration?.(50)
    })
    for (let tick = 3; tick <= 48; tick += 3) {
      progressAfter(record, tick, 3)
    }
    expect(savedWatched(onWatched)).toHaveLength(16)
    expect(savedWatched(onWatched).at(-1)).toBe(48)

    // Watching everything available satisfies the authored requirement even
    // though the provider reported less time than the authored duration.
    act(() => record.onEnded?.())
    expect(savedWatched(onWatched)).toHaveLength(17)
    expect(savedWatched(onWatched).at(-1)).toBe(60)
    expect(savedPositions(onPosition).at(-1)).toBe(0)
  })

  it('does not complete at the end after rejecting a seek to the end', async () => {
    const onWatched = vi.fn()
    const record = await mountVideo(requiredNode, undefined, vi.fn(), undefined, onWatched)
    startWatching(record)
    await act(async () => {
      record.onDuration?.(50)
    })

    progressAfter(record, 3)
    progressAfter(record, 50, 1)
    act(() => record.onEnded?.())

    expect(savedWatched(onWatched)).toEqual([3])
  })

  it('never verifies or gates playback for a video without a requirement', async () => {
    const onPosition = vi.fn()
    const onWatched = vi.fn()
    const record = await mountVideo(nativeNode, undefined, onPosition, undefined, onWatched)

    act(() => record.onProgress?.({ playedSeconds: 2 }))
    act(() => record.onProgress?.({ playedSeconds: 40 }))

    expect(savedWatched(onWatched)).toEqual([])
    expect(players.seekTo).not.toHaveBeenCalled()
    expect(savedPositions(onPosition)).toEqual([2, 40])
  })

  it('shows verified progress and completes the indicator at the authored minimum', async () => {
    const eagerNode: VideoNode = { ...nativeNode, duration: 120, minWatchTime: 6 }
    await mountVideo(eagerNode, undefined, vi.fn(), undefined, vi.fn())
    startWatching(players.latest())
    const requirement = () => container.querySelector('[data-video-requirement]')

    expect(requirement()?.getAttribute('data-complete')).toBe('false')
    expect(requirement()?.textContent).toContain('0% watched')

    progressAfter(players.latest(), 2)
    expect(requirement()?.textContent).toContain('33% watched')

    progressAfter(players.latest(), 4, 2)
    expect(requirement()?.textContent).toContain('66% watched')

    progressAfter(players.latest(), 6, 2)
    expect(requirement()?.getAttribute('data-complete')).toBe('true')
    expect(requirement()?.textContent).toContain('Required viewing complete')
  })

  it('renders no requirement indicator for a video without a minimum', async () => {
    await mountVideo(nativeNode, undefined, vi.fn(), undefined, vi.fn())
    expect(container.querySelector('[data-video-requirement]')).toBeNull()
  })

  it('verifies and persists independent frontiers for every required video', async () => {
    const first: VideoNode = {
      ...nativeNode,
      id: 'video:first.mdx:1:1',
      src: './first.mp4',
      duration: 120,
      minWatchTime: 6
    }
    const second: VideoNode = {
      ...nativeNode,
      id: 'video:second.mdx:1:1',
      src: './second.mp4',
      duration: 120,
      minWatchTime: 60
    }
    const watchedByVideo = new Map<string, number>()
    const nodesById = new Map([first, second].map((node) => [node.id, node]))
    window.scormBridge = {
      restoreState: (): PlayerState => ({ pages: {} }),
      saveState: (state) => {
        for (const [videoId, watched] of Object.entries(
          state.pages[VIDEO_PAGE_ID]?.watchedVideos ?? {}
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

    // The first video advances through continuous playback.
    for (const tick of [2, 4, 6]) {
      progressAfter(firstPlayer, tick, 2)
    }
    // The second video's own frontier is independent: its forward jump is
    // rejected and pulled back while the first keeps its verified progress.
    progressAfter(secondPlayer, 3, 3)
    progressAfter(secondPlayer, 40, 1)
    expect(players.seekTo).toHaveBeenCalledWith(3, 'seconds', true)

    expect(watchedByVideo.get(first.id)).toBe(6)
    expect(watchedByVideo.get(second.id)).toBe(3)
  })
})

describe('Video provider ready timing', () => {
  const youtubeNode: VideoNode = {
    ...nativeNode,
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

  it('seeks exactly once when the duration arrives after the early ready', async () => {
    const onPosition = vi.fn()
    const record = await mountVideo(youtubeNode, 12.3, onPosition)

    await reportReady(record, 2)
    expect(players.seekTo).not.toHaveBeenCalled()

    await reportDuration(record, 213)
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(12.3, 'seconds', false)
    // Still never autoplays, and the restored position was already persisted.
    expect(record.playing).toBeFalsy()
    expect(onPosition).not.toHaveBeenCalled()

    // A stray repeat of the duration signal must not re-apply the seek.
    await reportDuration(record, 213)
    expect(players.seekTo).toHaveBeenCalledTimes(1)
  })

  it('ignores a zero, negative or NaN duration', async () => {
    const record = await mountVideo(youtubeNode, 12.3, () => {})
    await reportReady(record)

    await reportDuration(record, 0)
    await reportDuration(record, -5)
    await reportDuration(record, Number.NaN)
    expect(players.seekTo).not.toHaveBeenCalled()

    await reportDuration(record, 90)
    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(12.3, 'seconds', false)
  })

  it('reveals a live stream with an infinite duration without seeking', async () => {
    const record = await mountVideo(nativeNode, 12.3, () => {})

    // A live stream reports a positive `Infinity`. ReactPlayer treats any truthy
    // duration as ready and emits `onDuration` only once, so the reading must
    // reveal the frame rather than leaving the placeholder up forever — but it
    // offers no finite seekable duration, so no restore is attempted.
    await reportDuration(record, Number.POSITIVE_INFINITY)

    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('clamps a restored position at or beyond the duration to just before the end', async () => {
    const record = await mountVideo(youtubeNode, 300, () => {})
    await reportDuration(record, 200)

    expect(players.seekTo).toHaveBeenCalledTimes(1)
    expect(players.seekTo).toHaveBeenCalledWith(199, 'seconds', false)
  })

  it('rests a position past the end of very short media at the start', async () => {
    const record = await mountVideo(youtubeNode, 5, () => {})
    await reportDuration(record, 0.5)

    expect(players.seekTo).toHaveBeenCalledWith(0, 'seconds', false)
  })

  it('closes the restore window once playback takes over', async () => {
    const record = await mountVideo(youtubeNode, 12.3, () => {})
    await reportDuration(record, 200)
    expect(players.seekTo).toHaveBeenCalledTimes(1)

    act(() => record.onPlay?.())
    players.seekTo.mockClear()
    await reportReady(record)
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it('closes the restore window when the learner seeks before the duration arrives', async () => {
    const record = await mountVideo(youtubeNode, 12.3, () => {})
    await reportReady(record)

    act(() => record.onSeek?.(3))
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })

  it.each<VideoProvider>(['native', 'vimeo'])(
    'restores the position once a %s provider reports its duration',
    async (provider) => {
      const record = await mountVideo(
        { ...nativeNode, provider, src: providerSources[provider] },
        30,
        () => {}
      )

      await reportReady(record)
      expect(players.seekTo).not.toHaveBeenCalled()

      await reportDuration(record, 120)
      expect(players.seekTo).toHaveBeenCalledTimes(1)
      expect(players.seekTo).toHaveBeenCalledWith(30, 'seconds', false)
    }
  )

  it('does not seek without a restored position, even once the duration arrives', async () => {
    const record = await mountVideo(nativeNode, 0, () => {})
    await reportReady(record, 2)
    await reportDuration(record, 200)
    expect(players.seekTo).not.toHaveBeenCalled()
  })
})

describe('Media failure fallbacks', () => {
  it('replaces the video placeholder with a static error state when the player errors', async () => {
    const record = await mountVideo(nativeNode, 12.3, () => {})
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      record.onError?.()
    })

    // The placeholder stops and the provider player is gone, so the frame shows
    // a small readable error rather than a player stuck on a black frame.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
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
          content: [nativeNode]
        }
      ]
    }
  }

  const secondVideoNode: VideoNode = {
    ...nativeNode,
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
          content: [nativeNode]
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
  const requiredNode: VideoNode = { ...nativeNode, duration: 120, minWatchTime: 6 }
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

  it('persists a verified frontier separately from the playback position', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoPosition(PAGE_ID, VIDEO_ID, 30.5))
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 12.34))

    const saved = lastSaved(saveState)
    expect(saved.pages[PAGE_ID]?.videos).toEqual({ [VIDEO_ID]: 30.5 })
    expect(saved.pages[PAGE_ID]?.watchedVideos).toEqual({ [VIDEO_ID]: 12.3 })
    // Video progress never contributes to package progress.
    expect(saveState.mock.calls.at(-1)?.[1]).toBe(getPackageProgress(requiredVideoPackage, saved))
  })

  it('never rewinds a monotonic frontier and skips writes that change nothing', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 20.3))
    const calls = saveState.mock.calls.length

    // A smaller reading never replaces a recorded frontier, and a value that
    // normalizes to the stored one is a no-op.
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 5))
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 20.34))
    expect(saveState.mock.calls.length).toBe(calls)
    expect(lastSaved(saveState).pages[PAGE_ID]?.watchedVideos).toEqual({ [VIDEO_ID]: 20.3 })

    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 21))
    expect(lastSaved(saveState).pages[PAGE_ID]?.watchedVideos).toEqual({ [VIDEO_ID]: 21 })
  })

  it('ignores invalid frontier readings', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    renderSession(requiredVideoPackage)

    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, Number.NaN))
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, -1))
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, Number.POSITIVE_INFINITY))
    expect(saveState).not.toHaveBeenCalled()
    expect(session?.state.pages[PAGE_ID]).toBeUndefined()
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

    // Meeting the verified frontier unlocks completion.
    act(() => session?.setVideoWatchedUntil(PAGE_ID, VIDEO_ID, 6))
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
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

  it('restores only the frontier each page owns, with a met requirement keeping completion', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            visited: true,
            completed: true,
            watchedVideos: { [VIDEO_ID]: 6, 'video:gone.mdx:1:1': 4 }
          }
        }
      }),
      saveState
    }
    renderSession(requiredVideoPackage)

    expect(session?.state.pages[PAGE_ID]).toEqual({
      visited: true,
      completed: true,
      watchedVideos: { [VIDEO_ID]: 6 }
    })
  })

  it('drops completion that predates the requirement but keeps verified progress', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            completed: true,
            videos: { [VIDEO_ID]: 20 },
            watchedVideos: { [VIDEO_ID]: 3 }
          }
        }
      }),
      saveState
    }
    renderSession(requiredVideoPackage)

    expect(session?.state.pages[PAGE_ID]).toEqual({
      videos: { [VIDEO_ID]: 20 },
      watchedVideos: { [VIDEO_ID]: 3 }
    })
  })
})

describe('Video watch requirement unlocks a slides page', () => {
  const slideVideo: VideoNode = { ...nativeNode, duration: 120, minWatchTime: 6 }

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
    for (const tick of [2, 4, 6]) {
      progressAfter(record, tick, 2)
    }
    expect(container.querySelector('[data-slides-next] button')).not.toBeNull()

    act(() => container.querySelector<HTMLButtonElement>('[data-slides-next] button')?.click())
    expect(lastSaved(saveState).location).toBe('page:second.mdx')
  })
})
