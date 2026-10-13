// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackageView } from '../../app/components/PackageView'
import type {
  ContentPackage,
  PageNode,
  PlayerState,
  QuestionnaireNode,
  ItemNode
} from '../../app/types'
import { headingDepths, introPage, setupPage, tilesPackage } from './fixtures'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'

/**
 * Renders a package under the player's i18n provider, mirroring `PackageApp`.
 * The provider normally lives at the app boundary; these tests render
 * `PackageView` directly, so they supply it here.
 */
function Player({ contentPackage }: { contentPackage: ContentPackage }) {
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} />
    </PlayerI18nProvider>
  )
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

interface FakeObserverState {
  callback: IntersectionObserverCallback
  elements: Set<Element>
  options?: IntersectionObserverInit
}

const observers: FakeObserverState[] = []

class FakeIntersectionObserver {
  private readonly state: FakeObserverState

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.state = { callback, elements: new Set<Element>(), options }
    observers.push(this.state)
  }

  observe(element: Element): void {
    this.state.elements.add(element)
    // Real IntersectionObserver always delivers an initial observation for a
    // newly observed target. Model it as not-yet-intersecting — the common case
    // for a region mounted below the viewport — so `observeVisibility` starts
    // from a real observation and a test still drives the actual crossing.
    this.state.callback(
      [
        {
          target: element,
          isIntersecting: false,
          intersectionRatio: 0
        } as unknown as IntersectionObserverEntry
      ],
      this as unknown as IntersectionObserver
    )
  }

  unobserve(element: Element): void {
    this.state.elements.delete(element)
  }

  disconnect(): void {
    this.state.elements.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

interface FakeResizeObserverState {
  callback: ResizeObserverCallback
  elements: Set<Element>
}

const resizeObservers: FakeResizeObserverState[] = []

class FakeResizeObserver {
  private readonly state: FakeResizeObserverState

  constructor(callback: ResizeObserverCallback) {
    this.state = { callback, elements: new Set<Element>() }
    resizeObservers.push(this.state)
  }

  observe(element: Element): void {
    this.state.elements.add(element)
  }

  unobserve(element: Element): void {
    this.state.elements.delete(element)
  }

  disconnect(): void {
    this.state.elements.clear()
  }
}

let originalIntersectionObserver: typeof IntersectionObserver | undefined
let originalResizeObserver: typeof ResizeObserver | undefined
let container: HTMLDivElement
let root: Root

/**
 * A cancellable animation-frame queue, so the restore's rendering-cycle boundary
 * is deterministic rather than tied to the host clock. jsdom's own
 * `requestAnimationFrame` fires on a timer the synchronous tests never reach;
 * the presentation's frames are queued here instead and drained explicitly by
 * {@link flushFrames}.
 */
let frameCallbacks: Map<number, FrameRequestCallback>
let nextFrameId: number

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  observers.length = 0
  resizeObservers.length = 0
  originalIntersectionObserver = globalThis.IntersectionObserver
  originalResizeObserver = globalThis.ResizeObserver
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  frameCallbacks = new Map()
  nextFrameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId + 1
    nextFrameId = id
    frameCallbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id)
  })
  // jsdom does not implement scrolling; stub both entry points so the player's
  // resume/navigation calls stay side-effect free and observable.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormBridge
  if (originalIntersectionObserver) {
    globalThis.IntersectionObserver = originalIntersectionObserver
  }
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function text(): string {
  return container.textContent ?? ''
}

function documentText(): string {
  return document.body.textContent ?? ''
}

function findButton(prefix: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((node) =>
    node.textContent?.trim().startsWith(prefix)
  )
  if (!button) {
    throw new Error(`Button not found: ${prefix}`)
  }
  return button
}

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) {
    throw new Error(`Input not found for value: ${value}`)
  }
  return element
}

/** Finds an input inside a specific mounted scene, for multi-page assertions. */
function inputInScene(index: number, value: string): HTMLInputElement {
  const scene = container.querySelector(`[data-scene-index="${index}"]`)
  const element = scene?.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) {
    throw new Error(`Input not found for value: ${value} in scene ${index}`)
  }
  return element
}

function submittedControl(value: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(
    `[data-slot="questionnaire-choice-input"][value="${value}"]`
  )
  if (!element) {
    throw new Error(`Submitted control not found for value: ${value}`)
  }
  return element
}

/** Answers the standard intro questionnaire (single- then multiple-choice). */
function answerQuestionnaire(): void {
  act(() => input('first').click())
  act(() => findButton('Next question').click())
  act(() => input('alpha').click())
  act(() => findButton('Submit questionnaire').click())
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

function lastProgress(saveState: { mock: { calls: unknown[][] } }): number {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[1] as number
}

function observerFor(element: Element): FakeObserverState {
  const state = observers.find((candidate) => candidate.elements.has(element))
  if (!state) {
    throw new Error('No IntersectionObserver is watching the element')
  }
  return state
}

function driveObserver(element: Element, isIntersecting: boolean): void {
  const state = observerFor(element)
  act(() => {
    state.callback(
      [
        {
          target: element,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0
        } as unknown as IntersectionObserverEntry
      ],
      {} as IntersectionObserver
    )
  })
}

/** The reading anchor the presentation compares page regions against. */
const ANCHOR = 0.35

/**
 * The viewport height the scroll geometry tests resolve the anchor against.
 * jsdom defaults `innerHeight` to 768, but the anchor tests hand-tune their
 * scroll offsets around `innerHeight * ANCHOR`; pinning it explicitly keeps the
 * geometry deterministic instead of silently tracking jsdom's default.
 */
const VIEWPORT_HEIGHT = 768

/**
 * Pins `window.innerHeight` to a fixed value and returns a restore for the
 * original. jsdom reports `innerHeight` as a plain own property, so replacing it
 * and putting the descriptor back is enough to leave every other test untouched.
 */
function pinViewportHeight(height: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    enumerable: true,
    value: height
  })
  return () => {
    if (original) {
      Object.defineProperty(window, 'innerHeight', original)
    } else {
      Reflect.deleteProperty(window, 'innerHeight')
    }
  }
}

/**
 * Scopes a fixed viewport height to the surrounding suite, pinning
 * `window.innerHeight` before each test and restoring it afterwards. Call it at
 * the top of a `describe` whose assertions depend on the anchor's pixel geometry.
 */
function useViewportHeight(height: number): void {
  let restore: (() => void) | undefined
  beforeEach(() => {
    restore = pinViewportHeight(height)
  })
  afterEach(() => {
    restore?.()
    restore = undefined
  })
}

function makeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    width: 0,
    left: 0,
    right: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

/**
 * Lays the rendered scroll regions out as the natural-height stack a browser
 * would produce — each page starting where the previous ended, shifted by the
 * scroll offset — and reports those rects. jsdom performs no layout, so the
 * geometry is supplied explicitly, keyed by page index.
 */
function layoutRegions(heights: number[], scrollTop: number): void {
  for (const region of container.querySelectorAll<HTMLElement>('[data-scroll-page]')) {
    const index = Number(region.getAttribute('data-scroll-page'))
    const height = heights[index] ?? 0
    const start = heights.slice(0, index).reduce((sum, value) => sum + value, 0) - scrollTop
    region.getBoundingClientRect = () => makeRect(start, start + height)
  }
}

/**
 * Drains every animation frame currently queued — including frames scheduled
 * from within a drained callback, since the restore boundary is a nested frame —
 * so a restoration settles in one deterministic step. The restore's frames end
 * the initial phase and attach ordinary scroll detection; a scroll reported
 * afterwards is a genuine one.
 */
function flushFrames(): void {
  let guard = 0
  while (frameCallbacks.size > 0 && guard < 50) {
    const callbacks = Array.from(frameCallbacks.values())
    frameCallbacks.clear()
    act(() => {
      for (const callback of callbacks) {
        callback(0)
      }
    })
    guard += 1
  }
}

/** Reports an arbitrary scroll offset with the given page heights. */
function scrollToOffset(scrollTop: number, heights: number[]): void {
  // A real scroll only reaches the presentation once the resume has settled, so
  // the restore phase — which suppresses detection — is finished first.
  flushFrames()
  layoutRegions(heights, scrollTop)
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
}

/**
 * Reports a scroll position that leaves the reading anchor inside the given
 * page, modelling the learner scrolling until that page owns the anchor.
 */
function scrollToPage(index: number, heights: number[]): void {
  const anchor = window.innerHeight * ANCHOR
  const start = heights.slice(0, index).reduce((sum, value) => sum + value, 0)
  scrollToOffset(start + heights[index]! / 2 - anchor, heights)
}

function setEndIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-end="${index}"]`)
  if (!sentinel) {
    throw new Error(`No end sentinel for page ${index}`)
  }
  driveObserver(sentinel, isIntersecting)
}

/**
 * Settles a smooth Path jump the way a browser does when its animated scroll
 * completes. The component listens for `scrollend` on both the window and the
 * document, so dispatching it on either releases the suppression
 * deterministically; tests use the document, where a document scroll's
 * `scrollend` is reported.
 */
function settleScrollJump(): void {
  act(() => {
    document.dispatchEvent(new Event('scrollend'))
  })
}

/**
 * Reports `prefers-reduced-motion: reduce` to `matchMedia`, so the presentation
 * is pushed the way a learner with the preference set would push it. Every other
 * query reports no match, so the stub is a faithful replacement for jsdom's own
 * always-false `matchMedia`.
 */
function preferReducedMotion(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }) as unknown as MediaQueryList
  )
}

/**
 * Drives the ResizeObserver watching a mounted scene, reporting `height` as its
 * rendered outer height — jsdom does no layout, so the measurement is supplied
 * explicitly, exactly as the observer would read it in a browser.
 */
function measureScene(element: Element, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      height,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect
  const state = resizeObservers.find((candidate) => candidate.elements.has(element))
  if (!state) {
    throw new Error('No ResizeObserver is watching the scene')
  }
  act(() => {
    state.callback(
      [{ target: element, contentRect: { height } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver
    )
  })
}

function scrollWrappers(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.overflow-y-auto'))
}

/** Indices of the mounted scenes, in document order. */
function sceneIndices(): number[] {
  return Array.from(container.querySelectorAll('[data-scene-index]'), (node) =>
    Number(node.getAttribute('data-scene-index'))
  )
}

function plainPage(index: number): PageNode {
  return {
    type: 'page',
    id: `page:plain-${index}.mdx`,
    source: `plain-${index}.mdx`,
    metadata: { title: `Plain ${index}` },
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: `Body ${index}.` }]
      }
    ]
  }
}

/** A questionnaire whose single question id is shared across pages. */
function sharedQuestionnaire(source: string): QuestionnaireNode {
  return {
    type: 'questionnaire',
    id: `questionnaire:${source}`,
    contributesToScore: true,
    questions: [
      {
        type: 'question',
        id: 'question:shared',
        questionType: 'single-choice',
        prompt: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Shared prompt' }]
          }
        ],
        options: [
          {
            value: 'yes',
            correct: true,
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Yes' }]
              }
            ]
          },
          {
            value: 'no',
            correct: false,
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'No' }]
              }
            ]
          }
        ]
      }
    ]
  }
}

function sharedPage(pageId: string, source: string, title: string): PageNode {
  return {
    type: 'page',
    id: pageId,
    source,
    metadata: { title },
    content: [sharedQuestionnaire(source)]
  }
}

const gatedPackage: ContentPackage = {
  metadata: { title: 'Gated package' },
  presentation: { type: 'scroll', pages: [introPage, setupPage] }
}

const plainTwoPagePackage: ContentPackage = {
  metadata: { title: 'Plain two pages' },
  presentation: { type: 'scroll', pages: [plainPage(1), plainPage(2)] }
}

const plainOnePagePackage: ContentPackage = {
  metadata: { title: 'Plain one page' },
  presentation: { type: 'scroll', pages: [plainPage(1)] }
}

const progressPackage: ContentPackage = {
  metadata: { title: 'Progress' },
  presentation: {
    type: 'scroll',
    pages: [plainPage(1), plainPage(2), plainPage(3), plainPage(4)]
  }
}

/** Page heights used by the anchor-detection tests: taller than the viewport. */
const FOUR_PAGE_HEIGHTS = [1500, 1500, 1500, 1500]

/** Restores the progress package with every page already reachable. */
function restoreAllFourPages(): {
  location: string
  pages: Record<string, { completed: boolean }>
} {
  return {
    location: 'page:plain-1.mdx',
    pages: {
      'page:plain-1.mdx': { completed: true },
      'page:plain-2.mdx': { completed: true },
      'page:plain-3.mdx': { completed: true },
      'page:plain-4.mdx': { completed: true }
    }
  }
}

const sharedQuestionPackage: ContentPackage = {
  metadata: { title: 'Shared question' },
  presentation: {
    type: 'scroll',
    pages: [
      sharedPage('page:a.mdx', 'a.mdx', 'Page A'),
      sharedPage('page:b.mdx', 'b.mdx', 'Page B')
    ]
  }
}

/** A page whose only content is a Path pointing back to itself. */
const selfPathPage: PageNode = {
  type: 'page',
  id: 'page:self.mdx',
  source: 'self.mdx',
  metadata: { title: 'Self' },
  content: [{ type: 'path', pageIds: ['page:self.mdx'] }]
}

const selfPathPackage: ContentPackage = {
  metadata: { title: 'Self path' },
  presentation: { type: 'scroll', pages: [selfPathPage, plainPage(2)] }
}

/** A page whose only content is a Path pointing to the package's last page. */
const farPathPage: PageNode = {
  type: 'page',
  id: 'page:path.mdx',
  source: 'path.mdx',
  metadata: { title: 'Path' },
  content: [{ type: 'path', pageIds: ['page:plain-4.mdx'] }]
}

const nonAdjacentPathPackage: ContentPackage = {
  metadata: { title: 'Non-adjacent path' },
  presentation: {
    type: 'scroll',
    pages: [farPathPage, plainPage(2), plainPage(3), plainPage(4)]
  }
}

/** A page whose only content is a Path to the third page. */
const shortTargetPathPage: PageNode = {
  type: 'page',
  id: 'page:short-path.mdx',
  source: 'short-path.mdx',
  metadata: { title: 'Short path' },
  content: [{ type: 'path', pageIds: ['page:plain-3.mdx'] }]
}

/** Five pages short enough that several share the viewport at once. */
const shortPagesPackage: ContentPackage = {
  metadata: { title: 'Short pages' },
  presentation: {
    type: 'scroll',
    pages: [shortTargetPathPage, plainPage(2), plainPage(3), plainPage(4), plainPage(5)]
  }
}

/** Each short page's height, a small fraction of the viewport. */
const SHORT_PAGE_HEIGHTS = [300, 300, 300, 300, 300]

/** Restores the short-pages package with every page reachable from page one. */
function restoreShortPages(): {
  location: string
  pages: Record<string, { completed: boolean }>
} {
  return {
    location: 'page:short-path.mdx',
    pages: {
      'page:short-path.mdx': { completed: true },
      'page:plain-2.mdx': { completed: true },
      'page:plain-3.mdx': { completed: true },
      'page:plain-4.mdx': { completed: true }
    }
  }
}

const slidesPackage: ContentPackage = {
  metadata: { title: 'Slides package' },
  presentation: { type: 'slides', pages: [plainPage(1), plainPage(2)] }
}

const gatedSlidesPackage: ContentPackage = {
  metadata: { title: 'Gated slides' },
  presentation: { type: 'slides', pages: [introPage, setupPage] }
}

const quizItem: ItemNode = {
  type: 'item',
  id: 'item:quiz.mdx',
  source: 'quiz.mdx',
  metadata: { title: 'Quiz' },
  content: [sharedQuestionnaire('quiz.mdx')]
}

const quizTilesPackage: ContentPackage = {
  metadata: { title: 'Tiles quiz' },
  presentation: { type: 'tiles', items: [quizItem] }
}

const headingItem: ItemNode = {
  type: 'item',
  id: 'item:headings.mdx',
  source: 'headings.mdx',
  metadata: { title: 'Headings' },
  content: headingDepths
}

const headingTilesPackage: ContentPackage = {
  metadata: { title: 'Tiles headings' },
  presentation: { type: 'tiles', items: [headingItem] }
}

function tileButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-tile] button'))
}

describe('PackageView scroll interactions', () => {
  it('renders only the accessible page and leaves locked pages unmounted', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    expect(sceneIndices()).toEqual([0])
    expect(text()).toContain('Welcome')
    expect(text()).not.toContain('Setup instructions.')
    // The remaining pages are locked and never mounted, and the boundary notice
    // stays out of the way until the current page's end is actually reached.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()
  })

  it('renders no package chrome, paging controls or progress UI', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    expect(text()).not.toContain('Rendering Fundamentals')
    expect(text()).not.toContain('Package complete')
    expect(
      container.querySelector('[role="progressbar"]:not([data-slot="questionnaire-progress"])')
    ).toBeNull()
    expect(scrollWrappers()).toHaveLength(0)
  })

  it('marks the first page visited and stores it as the location on mount', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))

    expect(saveState).toHaveBeenCalledTimes(1)
    expect(lastSaved(saveState)).toEqual({
      location: 'page:plain-1.mdx',
      pages: { 'page:plain-1.mdx': { visited: true } }
    })
    expect(lastProgress(saveState)).toBe(0)
  })

  it('works without any SCORM bridge', () => {
    expect(window.scormBridge).toBeUndefined()
    act(() => root.render(<Player contentPackage={gatedPackage} />))
    expect(text()).toContain('Welcome')
  })

  it('inverts the page content prose colors in dark mode', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    const scene = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    const prose = scene?.querySelector<HTMLElement>('.prose')
    expect(prose).not.toBeNull()
    expect(prose?.classList.contains('prose-stone')).toBe(true)
    expect(prose?.classList.contains('dark:prose-invert')).toBe(true)
  })

  it('observes page boundaries against the viewport with a non-negative end margin', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))

    const sentinel = container.querySelector('[data-scroll-end="0"]')
    expect(sentinel).not.toBeNull()
    const options = observerFor(sentinel as Element).options
    expect(options?.root).toBeNull()
    const [, , bottom = ''] = (options?.rootMargin ?? '').split(' ')
    const bottomMargin = Number.parseFloat(bottom)
    expect(Number.isNaN(bottomMargin)).toBe(false)
    expect(bottomMargin).toBeGreaterThanOrEqual(0)
  })
})

describe('PackageView scroll natural layout', () => {
  it('keeps the page scene at a min-viewport natural height with no centering', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    const scene = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    expect(scene).not.toBeNull()
    // A minimum of one small viewport, never a fixed or dynamic one.
    expect(scene?.classList.contains('min-h-svh')).toBe(true)
    expect(scene?.classList.contains('min-h-dvh')).toBe(false)
    expect(scene?.classList.contains('h-svh')).toBe(false)
    expect(scene?.classList.contains('max-h-svh')).toBe(false)
    expect(scene?.classList.contains('justify-center')).toBe(false)
    expect(scene?.className).toContain('max-w-3xl')
    // The measured region itself never carries the emphasis transform, so its
    // geometry stays exactly what anchor detection reads.
    expect(scene?.classList.contains('transition')).toBe(false)
    expect(scene?.classList.contains('translate-y-1')).toBe(false)
    // Natural block padding keeps the flow readable without filling the viewport.
    expect(scene?.className).toContain('px-4')
    expect(scene?.className).toContain('py-12')
  })

  it('lets a page longer than the viewport grow without clipping or centering', () => {
    // jsdom performs no layout, so the guarantee is asserted at the style level:
    // the wrapper sets only a *minimum* viewport height and clips nothing, so
    // content taller than the viewport simply extends the page and stays
    // top-aligned rather than being scaled, capped or centered.
    act(() => root.render(<Player contentPackage={plainOnePagePackage} />))

    const scene = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    expect(scene).not.toBeNull()
    const sceneClasses = (scene?.className ?? '').split(/\s+/)
    expect(sceneClasses).toContain('min-h-svh')
    for (const constraint of [
      'h-svh',
      'h-dvh',
      'min-h-dvh',
      'max-h-svh',
      'overflow-hidden',
      'items-center',
      'justify-center'
    ]) {
      expect(sceneClasses).not.toContain(constraint)
    }
  })

  it('does not give a virtualized placeholder a viewport-tall height', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-4.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { completed: true }
        }
      })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    const placeholder = container.querySelector<HTMLElement>(
      '[data-scroll-virtualized="page:plain-1.mdx"]'
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder?.classList.contains('min-h-svh')).toBe(false)
    expect(placeholder?.classList.contains('min-h-dvh')).toBe(false)
    // Never mounted, so it keeps a bounded, non-viewport box that is still a real
    // region to scroll back to, rather than collapsing to zero height.
    expect(placeholder?.style.minHeight).toBe('10rem')
  })
})

describe('PackageView scroll completion gating', () => {
  it('completes a questionnaire-free page at its end and unlocks the next', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))
    expect(sceneIndices()).toEqual([0])

    setEndIntersecting(0, true)

    // Page one is complete, so page two unlocks and mounts.
    expect(sceneIndices()).toEqual([0, 1])
    expect(lastSaved(saveState).pages['page:plain-1.mdx']?.completed).toBe(true)
  })

  it('keeps the next page locked at the end until questionnaires submit', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    setEndIntersecting(0, true)
    expect(sceneIndices()).toEqual([0])
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()

    // The end is reached but the page still has an unsubmitted questionnaire, so
    // the page after it stays locked and the boundary notice shows at its bottom.
    const boundary = container.querySelector('[data-scroll-locked]')
    expect(boundary).not.toBeNull()
    expect(container.querySelector('[data-scene-index="0"]')?.contains(boundary!)).toBe(true)
    expect(boundary?.textContent).toContain('Complete this page to continue.')

    answerQuestionnaire()
    expect(sceneIndices()).toEqual([0, 1])
    // Completing the page unlocked the next one, so the notice is gone.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
  })

  it('waits for the page end when the questionnaire is submitted first', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    answerQuestionnaire()
    expect(sceneIndices()).toEqual([0])

    setEndIntersecting(0, true)
    expect(sceneIndices()).toEqual([0, 1])
  })

  it('completes the package only after the final page completes', () => {
    const markCompleted = vi.fn()
    window.scormBridge = { markCompleted }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))
    expect(markCompleted).not.toHaveBeenCalled()

    setEndIntersecting(0, true)
    setEndIntersecting(1, true)

    expect(markCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('PackageView scroll virtualization and locking', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('virtualizes accessible pages outside the mounted window', () => {
    window.scormBridge = { restoreState: restoreAllFourPages }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // The active page and its next page mount; pages further down render as
    // placeholders, and the boundary notice waits until the frontier page's end
    // is reached.
    expect(container.querySelector('[data-scroll-virtualized]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
    expect(sceneIndices()).toEqual([0, 1])
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).not.toBeNull()
  })

  it('mounts an earlier placeholder when the anchor scrolls back to it', () => {
    const saveState = vi.fn()
    // Resume deep enough that page one is accessible but outside the mounted
    // window, so it renders as a placeholder.
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-4.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { completed: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    const placeholder = container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')
    expect(placeholder).not.toBeNull()
    expect(sceneIndices()).not.toContain(0)

    // Scrolling back so the anchor lands in page one mounts it and stores it as
    // the location, replacing the placeholder.
    scrollToPage(0, FOUR_PAGE_HEIGHTS)

    expect(sceneIndices()).toContain(0)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('activates a distant placeholder when a jump lands deep inside it', () => {
    const saveState = vi.fn()
    // A reached accessible tail: pages one and two are done and page three was
    // opened, so page three is accessible but sits outside the mounted window and
    // renders as a placeholder below the viewport.
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-1.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { visited: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    const placeholder = container.querySelector('[data-scroll-virtualized="page:plain-3.mdx"]')
    expect(placeholder).not.toBeNull()
    expect(sceneIndices()).not.toContain(2)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // The anchor is tested against the whole placeholder region, so a jump that
    // lands past the page's start — its middle or lower portion, as End, PageDown
    // or a scrollbar drag would — still activates it.
    scrollToPage(2, [1500, 1500, 1500])

    expect(sceneIndices()).toContain(2)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-3.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.visited).toBe(true)

    // Once mounted, the page completes through its end boundary exactly as it
    // would after a scroll, unlocking the next page.
    setEndIntersecting(2, true)
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.completed).toBe(true)
    expect(container.querySelector('[data-scroll-page="3"]')).not.toBeNull()
  })

  it('keeps a locked future page unmounted with no scene, placeholder or skeleton', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />))
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).toBeNull()
    // A locked page is never revealed — not its content, and not any loading
    // stand-in for it either.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.textContent).not.toContain('Body 4.')
  })

  it('keeps a mounted page height when the page is replaced by a placeholder', () => {
    // Resume deep enough that page three is the active, mounted page.
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-3.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { visited: true }
        }
      })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // Page three is mounted; report a height taller than a single viewport.
    const scene = container.querySelector('[data-scene-index="2"]')
    expect(scene).not.toBeNull()
    measureScene(scene as Element, 1234)

    // Scrolling back to page one moves page three out of the retained window, so
    // it is virtualized again — with its measured height, so nothing shifts.
    scrollToPage(0, [2000, 2000, 1234])

    const placeholder = container.querySelector<HTMLElement>(
      '[data-scroll-virtualized="page:plain-3.mdx"]'
    )
    expect(placeholder).not.toBeNull()
    // The placeholder keeps the measured height, so the pages below do not shift.
    expect(placeholder?.style.minHeight).toBe('1234px')
  })
})

describe('PackageView scroll anchor detection', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  function renderFourPages(saveState = vi.fn()) {
    window.scormBridge = { restoreState: restoreAllFourPages, saveState }
    act(() => root.render(<Player contentPackage={progressPackage} />))
    return { saveState }
  }

  it('keeps the current page while a tall page fills the viewport', () => {
    const { saveState } = renderFourPages()
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Half-way down a 1500px page the anchor has moved but is still inside it.
    scrollToOffset(500, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Still inside the same tall page near its lower part.
    scrollToOffset(1200, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('hands the current page to the neighbour when the anchor clearly crosses the boundary', () => {
    const { saveState } = renderFourPages()

    scrollToOffset(1200, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // A scroll that pushes the anchor well past page one's end — clear of the
    // hand-off deadband — hands the current page to the neighbour.
    scrollToOffset(1300, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // A scroll that clearly returns the anchor into page one's body, clear of the
    // deadband on the other side, hands it back.
    scrollToOffset(1100, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('does not oscillate while scrolling slowly around a boundary', () => {
    const { saveState } = renderFourPages()

    // Cross clearly into page two so it owns the anchor.
    scrollToOffset(1300, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // Nudge back and forth across the exact boundary: within the deadband the
    // current page is retained, so the location never flips with the pixel.
    for (const offset of [1250, 1220, 1210, 1235, 1205, 1230]) {
      scrollToOffset(offset, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
    }

    // Only a clear crossing back into page one releases it.
    scrollToOffset(1100, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('still reaches a page shorter than the hand-off deadband', () => {
    const { saveState } = renderFourPages()

    // Page two is only 40px tall — shorter than the base deadband — so the cap
    // keeps the hand-off band within half its height. Inside that band the
    // current page is retained ...
    scrollToOffset(1245, [1500, 40, 1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // ... but the short page is still reachable: once the anchor is clearly
    // inside it, it becomes the current page.
    scrollToOffset(1260, [1500, 40, 1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
  })

  it('retains nearby mounted pages when scrolling down and back up', () => {
    renderFourPages()

    // Scrolling down to page three retains the two pages above it as mounted
    // scenes as well as preloading the page below.
    scrollToPage(2, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(container.querySelector('[data-scroll-virtualized]')).toBeNull()

    // Scrolling far back up recycles the pages that are now distant, replacing
    // them with placeholders rather than leaving the whole document mounted.
    scrollToPage(0, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).toEqual([0, 1])
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).not.toBeNull()
  })

  it('does not activate a distant placeholder before the anchor reaches it', () => {
    const { saveState } = renderFourPages()

    // Page four is an off-screen placeholder; the current page is still page one.
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).not.toBeNull()
    expect(sceneIndices()).not.toContain(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // A scroll still inside page one must not prematurely hand activation to the
    // distant placeholder.
    scrollToOffset(500, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).not.toContain(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Only when the anchor actually reaches it does the page mount and activate.
    scrollToPage(3, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).toContain(3)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })
})

describe('PackageView scroll active page emphasis', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  function renderFourPages() {
    window.scormBridge = { restoreState: restoreAllFourPages, saveState: vi.fn() }
    act(() => root.render(<Player contentPackage={progressPackage} />))
  }

  function activeScene(): HTMLElement | null {
    return container.querySelector<HTMLElement>('[data-active="true"]')
  }

  /** The emphasis wrapper inside a given mounted scene. */
  function pageContent(index: number): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      `[data-scene-index="${index}"] [data-scroll-page-content]`
    )
  }

  it('marks exactly the page under the anchor as active as the current page moves', () => {
    renderFourPages()

    expect(activeScene()?.getAttribute('data-scene-index')).toBe('0')
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1)

    scrollToPage(1, FOUR_PAGE_HEIGHTS)

    // The anchor moved to page two, so exactly that scene is now the active one.
    expect(activeScene()?.getAttribute('data-scene-index')).toBe('1')
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1)

    // The page that lost the anchor stays fully in the flow: it is marked
    // inactive and only slightly emphasized down, never hidden or removed.
    const previous = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    expect(previous?.getAttribute('data-active')).toBe('false')
    expect(previous?.classList.contains('min-h-svh')).toBe(true)
    const previousContent = pageContent(0)
    expect(previousContent?.className).toContain('opacity-90')
    expect(previousContent?.className).not.toContain('opacity-0')
  })

  it('settles the active emphasis over 200ms and drops the transition under reduced motion', () => {
    renderFourPages()

    const content = pageContent(0)
    // A short, small opacity-and-translate settle; the reduced-motion variant
    // removes the transition entirely.
    expect(content?.className).toContain('transition')
    expect(content?.className).toContain('duration-200')
    expect(content?.className).toContain('ease-out')
    expect(content?.className).toContain('motion-reduce:transition-none')
    // Under reduced motion the emphasis is neutralized, not merely un-animated:
    // the offset and opacity are forced back to their resting values so activity
    // cannot produce a transition-less jump or a state fade.
    expect(content?.className).toContain('motion-reduce:translate-y-0')
    expect(content?.className).toContain('motion-reduce:opacity-100')
    // The active page is at rest with nothing scaled or hidden.
    expect(content?.className).toContain('translate-y-0')
    expect(content?.className).toContain('opacity-100')
    expect(content?.className).not.toContain('scale')
    expect(content?.className).not.toContain('hidden')
  })

  it('forces the inactive emphasis offset and opacity to rest under reduced motion', () => {
    renderFourPages()

    // Page two is mounted but not active, so it carries the emphasis offset.
    const inactive = pageContent(1)
    expect(inactive?.className).toContain('translate-y-1')
    expect(inactive?.className).toContain('opacity-90')
    // Reduced motion resets both, so the inactive offset cannot linger as a jump
    // when the page becomes active under the preference.
    expect(inactive?.className).toContain('motion-reduce:translate-y-0')
    expect(inactive?.className).toContain('motion-reduce:opacity-100')
    expect(inactive?.className).toContain('motion-reduce:transition-none')
  })
})

describe('PackageView scroll locked boundary', () => {
  it('shows the boundary at the bottom of the current page only once its end is reached', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    // Nothing is shown until the frontier page's end boundary is crossed.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()

    setEndIntersecting(0, true)

    const boundary = container.querySelector('[data-scroll-locked]')
    const scene = container.querySelector('[data-scene-index="0"]')
    expect(boundary).not.toBeNull()
    // It lives inside the current page and is its last element, so it reads as
    // the bottom of that page rather than a separate screen.
    expect(scene?.contains(boundary!)).toBe(true)
    expect(scene?.lastElementChild).toBe(boundary)
    expect(boundary?.textContent).toContain('Complete this page to continue.')
  })

  it('removes the boundary and mounts the next page once the frontier completes', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    setEndIntersecting(0, true)
    expect(container.querySelector('[data-scroll-locked]')).not.toBeNull()

    answerQuestionnaire()

    // Completion unlocked the next page, so the generic boundary is gone and the
    // newly accessible page is the frontier, still untouched at its own start.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
    expect(sceneIndices()).toEqual([0, 1])
  })

  it('never renders locked page content even while the boundary is shown', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))
    setEndIntersecting(0, true)

    expect(text()).not.toContain('Setup instructions.')
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()
  })
})

describe('PackageView scroll persistence', () => {
  it('stores each answer under its page namespace', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={gatedPackage} />))
    act(() => input('first').click())

    expect(lastSaved(saveState).pages['page:intro.mdx']?.answers).toEqual({
      'question:intro.mdx:1:1': 'first'
    })
  })

  it('passes integer progress as pages complete', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={progressPackage} />))
    setEndIntersecting(0, true)
    expect(lastProgress(saveState)).toBe(25)

    setEndIntersecting(1, true)
    expect(lastProgress(saveState)).toBe(50)
    expect(Number.isInteger(lastProgress(saveState))).toBe(true)
  })

  it('keeps page-scoped answers for a question id reused across pages', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={sharedQuestionPackage} />))
    act(() => input('yes').click())
    setEndIntersecting(0, true)
    act(() => findButton('Submit questionnaire').click())

    // Completing page A unlocked page B, which is mounted as its next page, and
    // reuses the same question id but renders its own, unanswered state.
    expect(inputInScene(1, 'yes').checked).toBe(false)
    expect(inputInScene(1, 'no').checked).toBe(false)

    const saved = lastSaved(saveState)
    expect(saved.pages['page:a.mdx']?.answers).toEqual({ 'question:shared': 'yes' })
    expect(saved.pages['page:b.mdx']?.answers).toBeUndefined()
  })

  it('restores saved answers and submitted questionnaires read-only', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:intro.mdx',
        pages: {
          'page:intro.mdx': {
            visited: true,
            answers: {
              'question:intro.mdx:1:1': 'first',
              'question:intro.mdx:1:2': ['alpha']
            },
            submittedQuestionnaires: ['questionnaire:intro.mdx:1:1']
          }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={gatedPackage} />))

    expect(submittedControl('first').checked).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedControl('alpha').checked).toBe(true)
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(text()).not.toContain('Submit questionnaire')
    expect(saveState).not.toHaveBeenCalled()

    setEndIntersecting(0, true)
    expect(container.querySelector('[data-scroll-page="1"]')).not.toBeNull()
  })

  it('drops an unknown saved location and starts on the first page', () => {
    window.scormBridge = {
      restoreState: () => ({ location: 'page:missing.mdx', pages: {} })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    expect(sceneIndices()).toEqual([0])
  })

  it('restores the location once under StrictMode', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-2.mdx',
        pages: { 'page:plain-1.mdx': { completed: true } }
      }),
      saveState
    }

    act(() =>
      root.render(
        <StrictMode>
          <Player contentPackage={progressPackage} />
        </StrictMode>
      )
    )

    expect(sceneIndices()).toContain(1)
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('restores a saved location instantly rather than with a smooth scroll', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-3.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { visited: true }
        }
      })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    expect(scrollIntoView).toHaveBeenCalled()
    for (const [options] of scrollIntoView.mock.calls) {
      expect(options).toMatchObject({ block: 'start', behavior: 'auto' })
    }
  })
})

describe('PackageView same-page Path navigation', () => {
  it('keeps a completed page and its visited self-reference stable', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={selfPathPackage} />))

    setEndIntersecting(0, true)
    expect(lastSaved(saveState).pages['page:self.mdx']?.completed).toBe(true)

    const selfEntry = container.querySelector<HTMLButtonElement>('[data-path-entry]')
    expect(selfEntry?.dataset.pathStatus).toBe('visited')
    expect(selfEntry?.disabled).toBe(false)

    act(() => selfEntry?.click())

    // Confirming the page already on screen must not reset its boundary signals.
    expect(lastSaved(saveState).pages['page:self.mdx']?.completed).toBe(true)
    expect(sceneIndices()).toContain(0)
  })
})

describe('PackageView non-adjacent Path navigation', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  /** A completed prefix that leaves the last page accessible and in range. */
  function restoreWithCompletedPrefix(): {
    location: string
    pages: Record<string, { visited?: boolean; completed?: boolean }>
  } {
    return {
      location: 'page:path.mdx',
      pages: {
        'page:path.mdx': { completed: true },
        'page:plain-2.mdx': { completed: true },
        'page:plain-3.mdx': { completed: true }
      }
    }
  }

  it('scrolls the mounted target scene, not the placeholder it replaces', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    // The target sits outside the window: only a placeholder is mounted.
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).not.toBeNull()
    expect(container.querySelector('[data-scene-index="3"]')).toBeNull()

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The jump mounted the real target scene; the semantic current page is only
    // moved once the physical scroll settles, never ahead of it.
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    // The staged jump scrolled the mounted scene, never the placeholder it
    // replaced (a placeholder carries `data-scroll-page` but no scene index).
    const contexts = scrollIntoView.mock.contexts as Element[]
    expect(contexts.some((element) => element.getAttribute('data-scene-index') === '3')).toBe(true)
    expect(contexts.some((element) => element.hasAttribute('data-scroll-virtualized'))).toBe(false)

    // A deliberate Path jump animates to the target scene ...
    const targetCall = contexts.findIndex(
      (element) => element.getAttribute('data-scene-index') === '3'
    )
    expect(scrollIntoView.mock.calls[targetCall]?.[0]).toMatchObject({
      block: 'start',
      behavior: 'smooth'
    })

    // ... and only after it settles does the target become the stored location.
    settleScrollJump()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('keeps the intended destination over a stale neighbour scroll', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // A stale scroll position left over from the re-centre would put the anchor
    // in the neighbour page; while the jump is in flight it must not steal the
    // intended destination.
    scrollToPage(1, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:path.mdx')
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()

    // The smooth animation finishes at the target, and only then does the target
    // become the stored location — it, not the stale neighbour frame, is what the
    // settled viewport actually shows.
    scrollToPage(3, FOUR_PAGE_HEIGHTS)
    settleScrollJump()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('reconciles the current page with the viewport when a jump is interrupted', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The learner interrupts the smooth scroll: the viewport comes to rest over
    // page two instead of the intended page four, and the jump settles there.
    scrollToPage(1, FOUR_PAGE_HEIGHTS)
    settleScrollJump()

    // Geometry, not the staged destination, decides the current page and the
    // mounted window; the abandoned target is then virtualized again.
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
    expect(sceneIndices()).toContain(1)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).not.toBeNull()

    // Suppression is released: a later scroll still drives the current page.
    scrollToPage(0, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:path.mdx')
  })

  it('retains activation suppression through the jump and releases it on settle', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The staged jump committed: the destination scene mounted, but the physical
    // scroll has not settled, so the stored location has not moved.
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    // While the smooth scroll animates, a scroll whose anchor points at another
    // page must not move the current page.
    scrollToPage(1, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    // The animation ends; the jump settles on the physical viewport at the target.
    scrollToPage(3, FOUR_PAGE_HEIGHTS)
    settleScrollJump()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')

    // Detection takes effect again: scrolling back activates page one.
    scrollToPage(0, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:path.mdx')
  })

  it('releases suppression on the settle fallback when the scroll reports nothing', () => {
    // jsdom's `scrollIntoView` is a stub: neither `scroll` nor `scrollend` ever
    // arrives, so the bounded fallback has to lift the suppression rather than
    // leave it pending forever.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const saveState = vi.fn()
      window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

      act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))
      act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

      expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()

      // Still suppressed before the fallback fires.
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:path.mdx')

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // The fallback released the suppression, so a scroll now updates the page.
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds suppression past the quiet period until the animation reports a scroll', () => {
    // A smooth animation can take longer than the quiet period to deliver its
    // first `scroll` frame. The quiet period must not be armed at the moment the
    // jump is staged, or suppression would end before the scroll even begins; the
    // overall timeout, not the quiet period, is what bounds an eventless jump.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const saveState = vi.fn()
      window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

      act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))
      act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

      expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()

      // Past the quiet period with no scroll at all: still suppressed, because
      // the suppression is only released once scrolling is observed to stop.
      act(() => {
        vi.advanceTimersByTime(500)
      })
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:path.mdx')

      // The overall timeout still lifts it when nothing ever arrives.
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases suppression a quiet period after the last scroll event', () => {
    // Without `scrollend`, suppression is released once scrolling has been quiet
    // for the settle period. The period starts on the first event and each further
    // event restarts it, so the release tracks the last frame, not the first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const saveState = vi.fn()
      window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

      act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))
      act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

      expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()

      // The animation reports a frame; the quiet period starts now.
      act(() => {
        document.dispatchEvent(new Event('scroll'))
        vi.advanceTimersByTime(100)
      })
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:path.mdx')

      // A further frame restarts the period, so it is not yet quiet long enough.
      act(() => {
        document.dispatchEvent(new Event('scroll'))
        vi.advanceTimersByTime(100)
      })
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:path.mdx')

      // Quiet for the full settle period after the last frame: released.
      act(() => {
        vi.advanceTimersByTime(200)
      })
      scrollToPage(1, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
    } finally {
      vi.useRealTimers()
    }
  })

  it('scrolls a Path jump instantly and reconciles immediately under reduced motion', () => {
    preferReducedMotion()
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // A deliberate jump still mounts the target scene, but under reduced motion
    // the browser is asked to jump instantly rather than animate.
    const contexts = scrollIntoView.mock.contexts as Element[]
    const targetCall = contexts.findIndex(
      (element) => element.getAttribute('data-scene-index') === '3'
    )
    expect(scrollIntoView.mock.calls[targetCall]?.[0]).toMatchObject({
      block: 'start',
      behavior: 'auto'
    })

    // `behavior: 'auto'` positions the document synchronously, so activation is
    // reconciled in the same commit — no `scrollend` and no bounded timeout is
    // waited for. jsdom reports no geometry to read, so the no-geometry fallback
    // records the intended target as the current page.
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')

    // Suppression is fully released, so once the restore settles a later scroll
    // drives the current page through ordinary detection, exactly as before.
    scrollToPage(1, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
  })
})

describe('PackageView short-page jump navigation', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('keeps every short page visible after a jump mounted', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreShortPages, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Before the jump the distant target is only a placeholder.
    expect(container.querySelector('[data-scroll-virtualized="page:plain-3.mdx"]')).not.toBeNull()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The smooth jump lands the short target (page three) at the viewport top, so
    // two further short pages share the viewport below it. `scrollToOffset`
    // reports that settled position as the animation's last frame would.
    scrollToOffset(600, SHORT_PAGE_HEIGHTS)
    settleScrollJump()

    // The viewport, not the target alone, defines the mounted window, so the short
    // neighbour below stays a real scene rather than being virtualized away.
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(container.querySelector('[data-scroll-virtualized="page:plain-5.mdx"]')).toBeNull()
    expect(sceneIndices()).toContain(4)
  })
})

describe('PackageView scroll location revisiting', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('updates the location again when a page is revisited after another', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-1.mdx',
        pages: { 'page:plain-1.mdx': { completed: true } }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    scrollToPage(1, [1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // Returning to A after B reports A again and moves the location back.
    scrollToPage(0, [1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('keeps StrictMode duplicate effects from double-writing a revisit', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-1.mdx',
        pages: { 'page:plain-1.mdx': { completed: true } }
      }),
      saveState
    }

    act(() =>
      root.render(
        <StrictMode>
          <Player contentPackage={plainTwoPagePackage} />
        </StrictMode>
      )
    )

    scrollToPage(1, [1500, 1500])
    scrollToPage(0, [1500, 1500])

    // One write per activation — mount, B, then A again. StrictMode's doubled
    // effects and a repeat of the id already stored are both no-ops.
    expect(saveState).toHaveBeenCalledTimes(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })
})

describe('PackageView scroll refresh restore', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  // The middle page (index 2) is deliberately short: the instant restore lands
  // its top at the viewport top, so the fixed reading anchor falls *past* its end
  // into the next page — the exact refresh shape that used to hand the location
  // to a neighbour before the learner scrolled.
  const RESTORE_HEIGHTS = [300, 300, 100, 300, 300]

  /** Completed prefix so the middle page is accessible; its next stays locked. */
  function restoreMiddleLockedNext(): {
    location: string
    pages: Record<string, { completed: boolean }>
  } {
    return {
      location: 'page:plain-3.mdx',
      pages: {
        'page:short-path.mdx': { completed: true },
        'page:plain-2.mdx': { completed: true }
      }
    }
  }

  /** The same prefix plus the middle page done, so its next page is accessible. */
  function restoreMiddleUnlockedNext(): {
    location: string
    pages: Record<string, { completed: boolean }>
  } {
    return {
      location: 'page:plain-3.mdx',
      pages: {
        'page:short-path.mdx': { completed: true },
        'page:plain-2.mdx': { completed: true },
        'page:plain-3.mdx': { completed: true }
      }
    }
  }

  /** Places the page at `index` at the viewport top, where its restore lands it. */
  function placeAtTop(index: number, heights: number[]): void {
    const start = heights.slice(0, index).reduce((sum, value) => sum + value, 0)
    layoutRegions(heights, start)
  }

  /** Delivers the asynchronous `scroll` echo of a programmatic restore. */
  function echoRestoreScroll(): void {
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
  }

  it('keeps the restored short page current when the restore echo arrives', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The instant restore positioned the short middle page at the viewport top,
    // so the anchor now sits inside the accessible next page.
    placeAtTop(2, RESTORE_HEIGHTS)
    echoRestoreScroll()

    // Detection has not run during the restore: the restored page is still the
    // location, and the neighbour the anchor points at was never marked seen.
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(lastSaved(saveState).pages['page:plain-4.mdx']).toBeUndefined()
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('does not activate a neighbour on the restore echo even once geometry settles', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // A freshly mounted neighbour reflows and reports its settled height while
    // the restore is still in progress; the re-render must not re-resolve the
    // location, and the following restore echo must not either.
    measureScene(container.querySelector('[data-scene-index="3"]') as Element, 900)
    placeAtTop(2, RESTORE_HEIGHTS)

    // The window the restore committed is the baseline the echo is judged
    // against: detection running on the echo could not only move the location
    // but recycle the mounted window around whichever neighbour the anchor
    // reached.
    const mountedWindow = sceneIndices()
    expect(mountedWindow).toEqual([0, 1, 2, 3])
    echoRestoreScroll()

    // The echo left the current page, its visited data and the mounted window
    // exactly as the restore committed them.
    expect(sceneIndices()).toEqual(mountedWindow)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(lastSaved(saveState).pages['page:plain-4.mdx']).toBeUndefined()
  })

  it('keeps the restored page current on a tall page whose anchor stays inside it', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    const TALL_HEIGHTS = [1500, 1500, 1500, 1500, 1500]
    placeAtTop(2, TALL_HEIGHTS)
    echoRestoreScroll()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // A genuine scroll inside the same tall page keeps the location too.
    scrollToPage(2, TALL_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('keeps the restored page on a normal-height page whose anchor stays inside it', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    const NORMAL_HEIGHTS = [700, 700, 700, 700, 700]
    placeAtTop(2, NORMAL_HEIGHTS)
    echoRestoreScroll()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // A genuine scroll that keeps the anchor inside the same page holds it.
    scrollToPage(2, NORMAL_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('restores the first accessible page with only its reachable window mounted', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({ location: 'page:short-path.mdx', pages: {} }),
      saveState
    }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Nothing is completed, so only the first page is accessible and mounted.
    expect(sceneIndices()).toEqual([0])
    placeAtTop(0, RESTORE_HEIGHTS)
    echoRestoreScroll()
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')
  })

  it('restores the last accessible page with its overscan window and a locked next', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-4.mdx',
        pages: {
          'page:short-path.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { completed: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Pages one to four are accessible; the last restored page's window reaches
    // back over its overscan above, while the locked page after it never mounts.
    expect(sceneIndices()).toEqual([1, 2, 3])
    expect(container.querySelector('[data-scroll-page="4"]')).toBeNull()

    placeAtTop(3, RESTORE_HEIGHTS)
    echoRestoreScroll()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('mounts the accessible next page in the restore window without handing over', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The overscan window around the restored page includes its accessible next
    // page, so it is a real scene rather than a placeholder from the first paint.
    expect(sceneIndices()).toContain(3)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // Once the restore settles, a genuine scroll detects normally and hands the
    // location to the page the anchor actually reached.
    scrollToOffset(600, RESTORE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('keeps a locked next page unmounted through the restore', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleLockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The next page is locked, so it never mounts inside the restore window.
    expect(sceneIndices()).toEqual([0, 1, 2])
    expect(container.querySelector('[data-scroll-page="3"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('resumes ordinary detection once the restore settles', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Scrolling up to the first page and back down to the restored one moves the
    // location exactly as an uninterrupted session would.
    scrollToPage(0, RESTORE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')

    scrollToPage(2, RESTORE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('settles the restore across StrictMode remounts and resumes detection', () => {
    const saveState = vi.fn()
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() =>
      root.render(
        <StrictMode>
          <Player contentPackage={shortPagesPackage} />
        </StrictMode>
      )
    )

    // StrictMode runs the mount effects twice: the instant position effect
    // scrolled the restored scene on both passes, and the frame chain was
    // cancelled by the simulated unmount and re-queued on the remount. The
    // committed window and the restored location still stand.
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // The re-queued chain has not run yet, so the restore is still in phase and
    // absorbs its own echo: neither the current page nor the mounted window move.
    const mountedWindow = sceneIndices()
    placeAtTop(2, RESTORE_HEIGHTS)
    echoRestoreScroll()
    expect(sceneIndices()).toEqual(mountedWindow)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // Draining the re-queued frames ends the restore phase.
    flushFrames()

    // The restore flag did not stick: detection is live again, so a genuine
    // scroll hands the location to the page the anchor actually reached.
    scrollToOffset(600, RESTORE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('settles the restore immediately when animation frames are unavailable', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.stubGlobal('cancelAnimationFrame', undefined)
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // There is no frame boundary to wait for, so the restore completes at mount
    // and a scroll is detected with no explicit flush.
    scrollToOffset(600, RESTORE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('positions the restore with browser-native scrolling on a natural-height page', () => {
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    const scene = container.querySelector('[data-scene-index="2"]')
    expect(scene).not.toBeNull()
    // A page reserves a minimum small viewport; there is no dynamic viewport
    // height, no centering and no inner scroll viewport: the document is the
    // single, browser-native scroll container, so a mobile gesture scrolls it
    // directly with no correction of its own.
    expect(scene?.classList.contains('min-h-svh')).toBe(true)
    expect(scene?.classList.contains('min-h-dvh')).toBe(false)
    expect(scene?.classList.contains('justify-center')).toBe(false)
    expect(scrollWrappers()).toHaveLength(0)

    // The restore is the instant jump the browser performs natively.
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })

  it('restores instantly even when reduced motion is requested', () => {
    preferReducedMotion()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Reduced motion only affects deliberate Path jumps; a resume is always an
    // instant jump, so the preference changes nothing here.
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })

  it('keeps explicit Path navigation working after a restore', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:path.mdx',
        pages: {
          'page:path.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { completed: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))
    flushFrames()

    // A Path jump to the distant last page still mounts its real scene, animates
    // there, and only stores it once the scroll settles.
    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    scrollToPage(3, FOUR_PAGE_HEIGHTS)
    settleScrollJump()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })
})

describe('PackageView slides presentation', () => {
  it('renders exactly one page at a time', () => {
    act(() => root.render(<Player contentPackage={slidesPackage} />))

    expect(sceneIndices()).toEqual([0])
    expect(text()).toContain('Body 1.')
    expect(text()).not.toContain('Body 2.')
  })

  it('advances only after the page is complete and renders the next page alone', () => {
    act(() => root.render(<Player contentPackage={slidesPackage} />))

    // A questionnaire-free slide completes once shown, so the control appears.
    const next = findButton('Continue to next page')
    act(() => next.click())

    expect(sceneIndices()).toEqual([1])
    expect(text()).toContain('Body 2.')
    expect(text()).not.toContain('Body 1.')
  })

  it('gates the next slide on the question gate', () => {
    act(() => root.render(<Player contentPackage={gatedSlidesPackage} />))

    // The intro slide carries a questionnaire: no next control until submitted.
    expect(() => findButton('Continue to next page')).toThrow()
    answerQuestionnaire()
    expect(findButton('Continue to next page')).toBeDefined()
  })

  it('marks the displayed slide as the location', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={slidesPackage} />))

    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })
})

describe('PackageView tiles interactions', () => {
  it('renders cards and opens the selected tile in a dialog', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))

    expect(text()).toContain('Functions')
    expect(dialog()).toBeNull()

    act(() => findButton('Functions').click())
    expect(dialog()).not.toBeNull()
    expect(documentText()).toContain('Function body.')
  })

  it('renders locked tiles as disabled so they are behaviorally inaccessible', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))

    const locked = container.querySelectorAll<HTMLButtonElement>(
      '[data-tile-status="locked"] button'
    )
    expect(locked.length).toBeGreaterThan(0)
    for (const button of locked) {
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('wraps authored tile content in prose typography', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))
    act(() => findButton('Functions').click())

    const prose = dialog()?.querySelector('.prose')
    expect(prose).not.toBeNull()
    expect(prose?.textContent).toContain('Function body.')
  })

  it('renders authored Markdown depths 1-6 as matching h1-h6 in the dialog', () => {
    act(() => root.render(<Player contentPackage={headingTilesPackage} />))
    act(() => findButton('Headings').click())

    const content = dialog()
    expect(content).not.toBeNull()
    for (let level = 1; level <= 6; level += 1) {
      expect(content?.querySelector(`h${level}`)).not.toBeNull()
      expect(content?.textContent).toContain(`Level ${level}`)
    }
  })

  it('closes the dialog on Escape', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))
    act(() => findButton('Functions').click())
    expect(dialog()).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(dialog()).toBeNull()
  })

  it('stores the opened tile as the location and marks it visited', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={tilesPackage} />))
    act(() => findButton('Functions').click())

    expect(lastSaved(saveState)).toEqual({
      location: 'item:functions.mdx',
      pages: { 'item:functions.mdx': { visited: true } }
    })
    expect(lastProgress(saveState)).toBe(33)
  })

  it('unlocks the next tile once the previous one is opened', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))

    const lockedBefore = container.querySelector('[data-tile-status="locked"]')
    expect(lockedBefore).not.toBeNull()

    act(() => findButton('Functions').click())
    const close = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
    act(() => close?.click())

    const firstTwo = tileButtons().slice(0, 2)
    expect(firstTwo.every((button) => !button.disabled)).toBe(true)
  })

  it('reopens the saved tile and restores its answers read-only', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'item:quiz.mdx',
        pages: {
          'item:quiz.mdx': {
            visited: true,
            answers: { 'question:shared': 'no' },
            submittedQuestionnaires: ['questionnaire:quiz.mdx']
          }
        }
      })
    }

    act(() => root.render(<Player contentPackage={quizTilesPackage} />))

    expect(dialog()).not.toBeNull()
    expect(documentText()).toContain('Shared prompt')
    const no = submittedControl('no')
    expect(no.checked).toBe(true)
    expect(no.disabled).toBe(true)
  })

  it('completes once every tile has been opened and notifies the bridge once', () => {
    const markCompleted = vi.fn()
    const finish = vi.fn()
    window.scormBridge = { markCompleted, finish }

    act(() => root.render(<Player contentPackage={tilesPackage} />))
    expect(markCompleted).not.toHaveBeenCalled()

    const close = () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
    act(() => findButton('Functions').click())
    act(() => close()?.click())
    act(() => findButton('Types').click())
    act(() => close()?.click())
    act(() => findButton('Extra details').click())

    expect(markCompleted).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('never renders a completion banner or progress UI', () => {
    act(() => root.render(<Player contentPackage={tilesPackage} />))
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(text()).not.toContain('Package complete')
  })
})
