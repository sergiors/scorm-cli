// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPresentationNodes } from '@scorm-cli/core'
import { PackageView } from '../../app/components/PackageView'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { ContentNode, ContentPackage, PlayerState } from '../../app/types'
import type { ContentProvider } from '../../app/lib/content-loader'
import { readingAnchorsForPage } from '../../app/lib/reading-anchors'
import { virtuosoMock } from './virtuoso-mock'

vi.mock('react-virtuoso', () => import('./virtuoso-mock'))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const anchorTops = new Map<string, number>()
const pageTops = new Map<string, number>()
const animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 0

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 800,
    width: 800,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  virtuosoMock.reset()
  anchorTops.clear()
  pageTops.clear()
  animationFrames.clear()
  nextAnimationFrameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextAnimationFrameId
    animationFrames.set(id, callback)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    animationFrames.delete(id)
  })
  originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const anchor = this.getAttribute('data-reading-anchor')
    if (anchor !== null) {
      return rect(anchorTops.get(anchor) ?? 0, 40)
    }
    const page = this.getAttribute('data-reading-page')
    if (page !== null) {
      return rect(pageTops.get(page) ?? 0, 1000)
    }
    return rect(0, 0)
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  HTMLElement.prototype.getBoundingClientRect = originalRect
  delete window.scormBridge
  vi.restoreAllMocks()
})

function heading(value: string): ContentNode {
  return { type: 'heading', depth: 2, children: [{ type: 'text', value }] }
}

const pageAContent = [heading('First page')]
const pageBContent = [heading('Target page'), heading('Target anchor')]

const scrollPackage: ContentPackage = {
  metadata: { title: 'Scroll resume' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:a.mdx',
        source: 'a.mdx',
        metadata: { title: 'First' },
        content: pageAContent
      },
      {
        type: 'page',
        id: 'page:b.mdx',
        source: 'b.mdx',
        metadata: { title: 'Second' },
        content: pageBContent
      }
    ]
  }
}

const slidesPackage: ContentPackage = {
  metadata: { title: 'Slides resume' },
  presentation: {
    type: 'slides',
    pages: [
      {
        type: 'page',
        id: 'page:a.mdx',
        source: 'a.mdx',
        metadata: { title: 'First' },
        content: pageAContent
      },
      {
        type: 'page',
        id: 'page:b.mdx',
        source: 'b.mdx',
        metadata: { title: 'Second' },
        content: pageBContent
      }
    ]
  }
}

function deferredProvider(contentPackage: ContentPackage) {
  const nodes = getPresentationNodes(contentPackage)
  const pending = new Map<
    string,
    { resolve: (content: ContentNode[]) => void; reject: (error: Error) => void }
  >()
  const provider: ContentProvider = {
    get: () => undefined,
    load(nodeId) {
      return new Promise<ContentNode[]>((resolve, reject) => {
        pending.set(nodeId, { resolve, reject })
      })
    }
  }
  const resolve = (nodeId: string) => {
    const settle = pending.get(nodeId)?.resolve
    pending.delete(nodeId)
    settle?.(nodes.find((node) => node.id === nodeId)?.content ?? [])
  }
  const reject = (nodeId: string) => {
    const settle = pending.get(nodeId)?.reject
    pending.delete(nodeId)
    settle?.(new Error(`Failed to load ${nodeId}`))
  }
  return { provider, resolve, reject }
}

function advanceAnimationFrame(): void {
  const callbacks = Array.from(animationFrames.values())
  animationFrames.clear()
  act(() => callbacks.forEach((callback) => callback(performance.now())))
}

function advanceAnimationFrames(count: number): void {
  for (let frame = 0; frame < count; frame += 1) {
    advanceAnimationFrame()
  }
}

function scheduleAfterAnimationFrames(count: number, callback: () => void): void {
  const advance = (remaining: number) => {
    if (remaining === 0) {
      callback()
    } else {
      window.requestAnimationFrame(() => advance(remaining - 1))
    }
  }
  window.requestAnimationFrame(() => advance(count - 1))
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  })
}

function saved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

function render(contentPackage: ContentPackage, provider: ContentProvider): void {
  act(() =>
    root.render(
      <PlayerI18nProvider lang={contentPackage.metadata.lang}>
        <PackageView contentPackage={contentPackage} contentProvider={provider} />
      </PlayerI18nProvider>
    )
  )
}

describe('Scroll anchor restoration', () => {
  it('waits for the saved virtualized page to load before restoring and saving', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    anchorTops.set(anchor!, 250)
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve } = deferredProvider(scrollPackage)

    render(scrollPackage, provider)

    expect(saveState).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()

    resolve('page:b.mdx')
    await flush()
    advanceAnimationFrames(6)
    await flush()

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 250, behavior: 'auto' })
    expect(saved(saveState).location).toBe(`page:b.mdx#${anchor}`)
  })

  it('falls back to the page beginning when the saved anchor no longer exists', async () => {
    pageTops.set('page:b.mdx', 100)
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:b.mdx#missing1',
        pages: { 'page:a.mdx': { completed: true } }
      })
    }
    const { provider, resolve } = deferredProvider(scrollPackage)

    render(scrollPackage, provider)
    resolve('page:b.mdx')
    await flush()
    advanceAnimationFrames(6)
    await flush()

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'auto' })
  })

  it('moves the reading position to the earlier page on a scroll back after restore', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    anchorTops.set(anchor!, 250)
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve } = deferredProvider(scrollPackage)

    render(scrollPackage, provider)
    resolve('page:b.mdx')
    await flush()
    advanceAnimationFrames(6)
    await flush()

    expect(saved(saveState).location).toBe(`page:b.mdx#${anchor}`)

    // Scrolling back to the earlier accessible page moves the location. The
    // saved anchor is never page b's restored anchor replayed under another
    // page, and the fresh page reports only once its content settled.
    act(() => virtuosoMock.scrollToOffset?.(0))
    await flush()
    resolve('page:a.mdx')
    await flush()

    expect(saved(saveState).location).toBe('page:a.mdx')
    expect(JSON.stringify(saved(saveState))).not.toContain(anchor!)
  })

  it('restores after Virtuoso v4.18.19’s deferred four-frame initial scroll', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    anchorTops.set(anchor!, 250)
    pageTops.set('page:b.mdx', 100)
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      })
    }
    const { provider, resolve } = deferredProvider(scrollPackage)

    render(scrollPackage, provider)
    resolve('page:b.mdx')
    await flush()

    // v4.18.19 queues its non-zero initial index positioning over four
    // animation frames after list measurements. Model that browser ordering
    // explicitly; the anchor restore must run after the queued list scroll.
    scheduleAfterAnimationFrames(4, () => {
      window.scrollTo({ top: 100, behavior: 'auto' })
    })
    advanceAnimationFrames(4)
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 100, behavior: 'auto' })
    advanceAnimationFrame()

    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 250, behavior: 'auto' })
  })

  it('falls back to the failed page location and resumes scroll reporting', async () => {
    pageTops.set('page:b.mdx', 180)
    for (const anchor of readingAnchorsForPage('page:a.mdx', pageAContent).values()) {
      anchorTops.set(anchor.id, 100)
    }
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:b.mdx#abc12345',
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve, reject } = deferredProvider(scrollPackage)
    virtuosoMock.visibleCount = 2

    render(scrollPackage, provider)
    resolve('page:a.mdx')
    reject('page:b.mdx')
    await flush()
    advanceAnimationFrames(6)
    await flush()

    expect(
      container.querySelector('[data-reading-page="page:b.mdx"][data-scroll-error]')
    ).not.toBeNull()
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 180, behavior: 'auto' })
    expect(saveState).not.toHaveBeenCalled()

    act(() => virtuosoMock.scrollToOffset?.(0))
    await flush()
    expect(saved(saveState).location).toBe('page:a.mdx')
    expect(JSON.stringify(saved(saveState))).not.toContain('abc12345')
  })

  it('cancels a queued resume anchor when the learner navigates through a Path', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    if (scrollPackage.presentation.type !== 'scroll') {
      throw new Error('Expected a scroll package')
    }
    const pages = scrollPackage.presentation.pages
    const navigationPackage: ContentPackage = {
      ...scrollPackage,
      presentation: {
        type: 'scroll',
        pages: [
          {
            ...pages[0]!,
            content: [{ type: 'path', pageIds: ['page:b.mdx'] }]
          },
          pages[1]!
        ]
      }
    }
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      })
    }
    const { provider, resolve } = deferredProvider(navigationPackage)
    virtuosoMock.visibleCount = 2

    render(navigationPackage, provider)
    resolve('page:a.mdx')
    resolve('page:b.mdx')
    await flush()

    const path = container.querySelector<HTMLButtonElement>('[data-path-entry]')
    expect(path).not.toBeNull()
    act(() => path?.click())
    advanceAnimationFrames(6)
    await flush()

    expect(virtuosoMock.scrollToIndexCalls).toContainEqual({
      index: 1,
      align: 'start',
      behavior: 'auto'
    })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})

describe('Slides anchor restoration', () => {
  it('restores inside the document after the slide loads, then resets on navigation', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    anchorTops.set(anchor!, 250)
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve } = deferredProvider(slidesPackage)

    render(slidesPackage, provider)
    expect(window.scrollTo).not.toHaveBeenCalled()

    // The suppressed seen report never persisted a location while restoring.
    expect(saveState).not.toHaveBeenCalled()

    resolve('page:b.mdx')
    await flush()
    advanceAnimationFrames(6)
    await flush()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 250, behavior: 'auto' })

    // The restored slide's first semantic save keeps the resolved anchor and
    // nothing else about the viewport.
    expect(saved(saveState).location).toBe(`page:b.mdx#${anchor}`)
    expect(Object.keys(saved(saveState)).sort()).toEqual(['location', 'pages'])

    const previous = container.querySelector<HTMLButtonElement>('[data-slides-previous] button')
    expect(previous).not.toBeNull()
    act(() => previous?.click())

    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })

    resolve('page:a.mdx')
    await flush()
    expect(saved(saveState).location).toBe('page:a.mdx')

    // Returning to the resumed slide later never replays its saved anchor: the
    // restore target is consumed by the deliberate navigation away from it.
    const next = container.querySelector<HTMLButtonElement>('[data-slides-next] button')
    expect(next).not.toBeNull()
    act(() => next?.click())
    await flush()

    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
    expect(saved(saveState).location).toBe('page:b.mdx')
  })
})
