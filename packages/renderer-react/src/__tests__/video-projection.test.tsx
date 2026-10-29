// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentPackage, PlayerState, VideoNode } from '../../app/types'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
import { createPackageDataPlugin, RESOLVED_PACKAGE_DATA_ID } from '../vite-app'

const PAGE_ID = 'page:video-projection.mdx'
const VIDEO_ID = 'video:video-projection.mdx:1:1'

/**
 * A required video with presentation-only fields beside the semantic watch
 * fields. The generated package summary must keep the fields the session layer
 * needs to recognise, gate and restore the requirement.
 */
const requiredVideo: VideoNode = {
  type: 'video',
  id: VIDEO_ID,
  provider: 'vimeo',
  src: 'https://vimeo.com/42',
  title: 'Lesson video',
  poster: './poster.png',
  duration: 120,
  minWatchTime: 5
}

function videoPackage(): ContentPackage {
  return {
    metadata: { title: 'Video projection' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: PAGE_ID,
          source: 'video-projection.mdx',
          metadata: { title: 'Video projection' },
          content: [requiredVideo]
        }
      ]
    }
  }
}

/** Calls the plugin's load hook without needing a full Vite plugin context. */
function loadPackageDataModule(plugin: ReturnType<typeof createPackageDataPlugin>): unknown {
  const load = plugin.load
  if (typeof load === 'function') {
    return Reflect.apply(load, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
  }
  if (load !== undefined) {
    return Reflect.apply(load.handler, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
  }
  throw new Error('Package data plugin has no load hook')
}

/** The semantic package object the generated virtual module actually exposes. */
function semanticPackage(contentPackage: ContentPackage): ContentPackage {
  const plugin = createPackageDataPlugin({ current: contentPackage })
  const code = loadPackageDataModule(plugin)
  if (typeof code !== 'string') {
    throw new Error('Package data module was not generated')
  }
  const marker = 'const contentPackage = '
  const start = code.indexOf(marker)
  const end = code.indexOf(';\nexport default contentPackage', start)
  if (start < 0 || end < 0) {
    throw new Error('Package data module has an unexpected shape')
  }
  return JSON.parse(code.slice(start + marker.length, end)) as ContentPackage
}

function projectedVideo(contentPackage: ContentPackage): VideoNode {
  if (contentPackage.presentation.type === 'tiles') {
    throw new Error('Expected a page presentation')
  }
  const node = contentPackage.presentation.pages[0]?.content[0]
  if (node?.type !== 'video') {
    throw new Error('Expected a video node')
  }
  return node
}

let container: HTMLDivElement
let root: Root
let session: PlayerSession | undefined

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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

function SessionHarness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

function renderSession(contentPackage: ContentPackage): void {
  act(() => root.render(<SessionHarness contentPackage={contentPackage} />))
}

function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

describe('generated package video projection', () => {
  it('keeps the authored duration and minimum watch time the session must enforce', () => {
    const video = projectedVideo(semanticPackage(videoPackage()))

    // The session layer only receives this summary, so the watch fields have to
    // survive the projection; otherwise requirement recognition, persistence,
    // restore and completion gating all silently lose the gate.
    expect(video).toEqual({
      type: 'video',
      id: VIDEO_ID,
      provider: 'vimeo',
      src: 'https://vimeo.com/42',
      duration: 120,
      minWatchTime: 5
    })

    // Presentation-only fields still travel with the lazily loaded page module.
    expect(video).not.toHaveProperty('title')
    expect(video).not.toHaveProperty('poster')
  })

  it('persists accumulated watch time and gates completion from the projected summary', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({ pages: {} }),
      saveState
    }
    renderSession(semanticPackage(videoPackage()))

    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 2.26))
    expect(lastSaved(saveState).pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 2.3 })

    // The unmet requirement keeps the page pending even after its own rule is
    // done; reaching the accumulated minimum unlocks it.
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()

    act(() => session?.setVideoWatchSeconds(PAGE_ID, VIDEO_ID, 5))
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
    expect(lastSaved(saveState).pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 5 })
  })

  it('restores accumulated watch time sanitized against the projected summary', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: (): PlayerState => ({
        pages: {
          [PAGE_ID]: {
            videoWatchSeconds: { [VIDEO_ID]: 4.24, 'video:gone.mdx:1:1': 3 }
          }
        }
      }),
      saveState
    }
    renderSession(semanticPackage(videoPackage()))

    // The owned total is normalized to tenths and capped by the requirement;
    // an id the projected page no longer owns is dropped.
    expect(session?.state.pages[PAGE_ID]?.videoWatchSeconds).toEqual({ [VIDEO_ID]: 4.2 })
  })
})
