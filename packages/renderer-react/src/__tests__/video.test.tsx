// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Video } from '../../app/components/Video'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { getPackageProgress } from '../../app/lib/content-helpers'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
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
          content: [node]
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
  onPosition: (seconds: number) => void
): Promise<RecordedPlayer> {
  const pageId = VIDEO_PAGE_ID
  const contentPackage = videoPackageFor(node)
  let lastPosition = position
  window.scormBridge = {
    restoreState: (): PlayerState => ({
      pages: position === undefined ? {} : { [pageId]: { videos: { [node.id]: position } } }
    }),
    saveState: (state) => {
      const nextPosition = state.pages[pageId]?.videos?.[node.id]
      if (nextPosition !== undefined && nextPosition !== lastPosition) {
        lastPosition = nextPosition
        onPosition(nextPosition)
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

      // The frame reserves the media geometry through the AspectRatio primitive
      // before the provider player mounts, so the placeholder occupies exactly
      // the box the media will.
      expect(html).toContain('data-slot="media-frame"')
      expect(html).toContain('data-radix-aspect-ratio-wrapper')
      expect(html).toContain('padding-bottom:56.25%')
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
