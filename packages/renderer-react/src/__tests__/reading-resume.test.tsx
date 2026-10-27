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
const scrollIntoViewCalls: Array<{ element: HTMLElement; options: ScrollIntoViewOptions }> = []

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
let originalScrollIntoView: PropertyDescriptor | undefined
let container: HTMLDivElement
let root: Root
let animationFrameCallbacks: Map<number, FrameRequestCallback>
let nextAnimationFrameId: number

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  virtuosoMock.reset()
  animationFrameCallbacks = new Map()
  nextAnimationFrameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextAnimationFrameId
    animationFrameCallbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrameCallbacks.delete(id)
  })
  anchorTops.clear()
  scrollIntoViewCalls.length = 0
  originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement, options: ScrollIntoViewOptions) {
      scrollIntoViewCalls.push({ element: this, options })
    }
  })
  originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const anchor = this.getAttribute('data-reading-anchor')
    if (anchor !== null) {
      return rect(anchorTops.get(anchor) ?? 0, 40)
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
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
  delete window.scormBridge
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

async function flush(): Promise<void> {
  await flushPromises()
  for (let frame = 0; frame < 10 && animationFrameCallbacks.size > 0; frame += 1) {
    advanceAnimationFrame()
    await flushPromises()
  }
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  })
}

function advanceAnimationFrame(): void {
  const callbacks = [...animationFrameCallbacks.values()]
  animationFrameCallbacks.clear()
  act(() => callbacks.forEach((callback) => callback(0)))
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
  it('waits until Virtuoso finishes deferred initial positioning before restoring the anchor', async () => {
    const anchor = readingAnchorsForPage('page:b.mdx', pageBContent).get('1')?.id
    expect(anchor).toBeDefined()
    anchorTops.set(anchor!, 250)
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: {
          'page:a.mdx': { completed: true },
          'page:b.mdx': { completed: true }
        }
      }),
      saveState
    }
    if (scrollPackage.presentation.type !== 'scroll') {
      throw new Error('Expected a scroll package')
    }
    const delayedPackage: ContentPackage = {
      ...scrollPackage,
      presentation: {
        type: 'scroll',
        pages: [
          ...scrollPackage.presentation.pages,
          {
            type: 'page',
            id: 'page:c.mdx',
            source: 'c.mdx',
            metadata: { title: 'Third' },
            content: [heading('Third page')]
          }
        ]
      }
    }
    const { provider, resolve } = deferredProvider(delayedPackage)
    virtuosoMock.deferInitialPositioning = true
    virtuosoMock.visibleCount = 2

    render(delayedPackage, provider)
    resolve('page:a.mdx')
    resolve('page:b.mdx')
    await flushPromises()

    expect(virtuosoMock.initialPositionApplied).toBe(false)
    expect(scrollIntoViewCalls).toHaveLength(0)
    for (let frame = 0; frame < 4; frame += 1) {
      advanceAnimationFrame()
    }

    // Virtuoso's initial scroll has fired, but restoration still owns the guard:
    // the intermediate scroll must not save over the resume location.
    expect(virtuosoMock.initialPositionApplied).toBe(true)
    expect(scrollIntoViewCalls).toHaveLength(0)
    expect(saveState).not.toHaveBeenCalled()

    advanceAnimationFrame()

    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-anchor')).toBe(anchor)
    expect(scrollIntoViewCalls[0]?.options).toEqual({ behavior: 'instant', block: 'start' })
    expect(saved(saveState).location).toBe(`page:b.mdx#${anchor}`)
  })

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
    expect(scrollIntoViewCalls).toHaveLength(0)

    // A scroll observed while the virtualized target is still loading cannot
    // replace the SCORM resume location.
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(saveState).not.toHaveBeenCalled()

    resolve('page:b.mdx')
    await flush()

    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-anchor')).toBe(anchor)
    expect(scrollIntoViewCalls[0]?.options).toEqual({ behavior: 'instant', block: 'start' })
    expect(saved(saveState).location).toBe(`page:b.mdx#${anchor}`)
  })

  it('falls back to the page beginning when the saved anchor no longer exists', async () => {
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

    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-page')).toBe('page:b.mdx')
    expect(scrollIntoViewCalls[0]?.element.hasAttribute('data-reading-anchor')).toBe(false)
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

  it('falls back to the failed page location and resumes scroll reporting', async () => {
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

    expect(
      container.querySelector('[data-reading-page="page:b.mdx"][data-scroll-error]')
    ).not.toBeNull()
    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-page')).toBe('page:b.mdx')
    expect(scrollIntoViewCalls[0]?.element.hasAttribute('data-reading-anchor')).toBe(false)
    expect(saved(saveState).location).toBe('page:b.mdx')

    act(() => virtuosoMock.scrollToOffset?.(0))
    await flush()
    expect(saved(saveState).location).toBe('page:a.mdx')
    expect(JSON.stringify(saved(saveState))).not.toContain('abc12345')
  })

  it('does not replay the restored anchor after a Path navigation', async () => {
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
    expect(scrollIntoViewCalls).toHaveLength(1)

    const path = container.querySelector<HTMLButtonElement>('[data-path-entry]')
    expect(path).not.toBeNull()
    act(() => path?.click())
    await flush()

    expect(virtuosoMock.scrollToIndexCalls).toContainEqual({
      index: 1,
      align: 'start',
      behavior: 'auto'
    })
    expect(scrollIntoViewCalls).toHaveLength(1)
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
    expect(scrollIntoViewCalls).toHaveLength(0)

    // The suppressed seen report never persisted a location while restoring.
    expect(saveState).not.toHaveBeenCalled()

    resolve('page:b.mdx')
    await flush()
    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-anchor')).toBe(anchor)
    expect(scrollIntoViewCalls[0]?.options).toEqual({ behavior: 'instant', block: 'start' })

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
    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(saved(saveState).location).toBe('page:b.mdx')
  })

  it('keeps a legacy page-only location at the page level', async () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:b.mdx',
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve } = deferredProvider(slidesPackage)

    render(slidesPackage, provider)
    resolve('page:b.mdx')
    await flush()

    expect(scrollIntoViewCalls).toHaveLength(0)
    expect(saved(saveState).location).toBe('page:b.mdx')
  })

  it('restores a deep anchor in long slide content without pixel offsets', async () => {
    const longContent = Array.from({ length: 80 }, (_, index) => heading(`Section ${index + 1}`))
    const longPackage: ContentPackage = {
      ...slidesPackage,
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
            metadata: { title: 'Long slide' },
            content: longContent
          }
        ]
      }
    }
    const anchor = readingAnchorsForPage('page:b.mdx', longContent).get('79')!.id
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: `page:b.mdx#${anchor}`,
        pages: { 'page:a.mdx': { completed: true } }
      }),
      saveState
    }
    const { provider, resolve } = deferredProvider(longPackage)

    render(longPackage, provider)
    resolve('page:b.mdx')
    await flush()

    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0]?.element.getAttribute('data-reading-anchor')).toBe(anchor)
    expect(scrollIntoViewCalls[0]?.options).toEqual({ behavior: 'instant', block: 'start' })
    expect(JSON.stringify(saved(saveState))).not.toMatch(/scrollTop|offset|viewport/i)
  })
})
