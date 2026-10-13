// @vitest-environment jsdom
import { StrictMode, act, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackageView } from '../../app/components/PackageView'
import type {
  ContentNode,
  ContentPackage,
  PageNode,
  PlayerState,
  QuestionnaireNode,
  ItemNode
} from '../../app/types'
import type { ContentProvider } from '../../app/lib/content-loader'
import { getPresentationNodes } from '@scorm-cli/core'
import {
  headingDepths,
  inlineContentProvider,
  introPage,
  setupPage,
  tilesPackage
} from './fixtures'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'

/**
 * Renders a package under the player's i18n provider, mirroring `PackageApp`.
 * The provider normally lives at the app boundary; these tests render
 * `PackageView` directly, so they supply it here. The inline provider answers
 * from the package's own content, so these tests render synchronously exactly as
 * an embedded package used to.
 */
function Player({ contentPackage }: { contentPackage: ContentPackage }) {
  const contentProvider = useMemo(() => inlineContentProvider(contentPackage), [contentPackage])
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} contentProvider={contentProvider} />
    </PlayerI18nProvider>
  )
}

/** Renders a package whose page/item bodies load on demand through `contentProvider`. */
function LazyPlayer({
  contentPackage,
  contentProvider
}: {
  contentPackage: ContentPackage
  contentProvider: ContentProvider
}) {
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} contentProvider={contentProvider} />
    </PlayerI18nProvider>
  )
}

/** Drains the microtask queue so an in-flight page module load settles. */
async function flushLoads(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  })
}

/**
 * A content provider whose `load` promises are settled explicitly by the test,
 * so the loading skeleton can be observed before content resolves. `get` never
 * answers, so every node in the provider is genuinely load-on-demand.
 */
function deferredProvider(contentPackage: ContentPackage) {
  const nodes = getPresentationNodes(contentPackage)
  const calls: string[] = []
  const pending = new Map<
    string,
    { resolve: (content: ContentNode[]) => void; reject: (error: unknown) => void }
  >()
  const provider: ContentProvider = {
    get: () => undefined,
    load(nodeId) {
      calls.push(nodeId)
      return new Promise<ContentNode[]>((resolve, reject) => {
        pending.set(nodeId, { resolve, reject })
      })
    }
  }
  const resolve = (nodeId: string) => {
    const entry = pending.get(nodeId)
    pending.delete(nodeId)
    entry?.resolve(nodes.find((node) => node.id === nodeId)?.content ?? [])
  }
  const rejectLoad = (nodeId: string) => {
    const entry = pending.get(nodeId)
    pending.delete(nodeId)
    entry?.reject(new Error('load failed'))
  }
  return { provider, calls, resolve, rejectLoad }
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

let originalIntersectionObserver: typeof IntersectionObserver | undefined
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  observers.length = 0
  originalIntersectionObserver = globalThis.IntersectionObserver
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
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

/** The slides "next page" control, which is icon-only (no text label). */
function nextSlideControl(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-slides-next] button')
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

/**
 * The reading anchor the presentation compares page regions against: the top
 * edge of the viewport. The current page is the one whose region spans the line
 * at the top of the screen.
 */
const ANCHOR = 0

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

/** Reports an arbitrary scroll offset with the given page heights. */
function scrollToOffset(scrollTop: number, heights: number[]): void {
  layoutRegions(heights, scrollTop)
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
}

/**
 * Reports a scroll position that leaves the reading anchor inside the given
 * page, modelling the learner scrolling until that page owns the anchor: the
 * page's top is placed on the anchor line at the viewport top.
 */
function scrollToPage(index: number, heights: number[]): void {
  const anchor = window.innerHeight * ANCHOR
  const start = heights.slice(0, index).reduce((sum, value) => sum + value, 0)
  scrollToOffset(start - anchor, heights)
}

function setEndIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-end="${index}"]`)
  if (!sentinel) {
    throw new Error(`No end sentinel for page ${index}`)
  }
  driveObserver(sentinel, isIntersecting)
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

  it('renders every accessible restored page as a real scene with no spacer', () => {
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

    // Every accessible page is a real, viewport-tall scene. The old
    // height-preserving spacer is gone, so nothing is left as a placeholder to
    // reserve or collapse room.
    expect(container.querySelector('[data-scroll-virtualized]')).toBeNull()
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    for (const index of [0, 1, 2, 3]) {
      const scene = container.querySelector(`[data-scene-index="${index}"]`)
      expect(scene?.classList.contains('min-h-svh')).toBe(true)
    }
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

describe('PackageView scroll append-only loading and locking', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('renders every accessible page and never a locked one', () => {
    window.scormBridge = { restoreState: restoreAllFourPages }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // All four pages are accessible, so all four mount; the boundary notice waits
    // until the frontier page's end is reached.
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(container.querySelector('[data-scroll-virtualized]')).toBeNull()
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
  })

  it('keeps a loaded page mounted when the current page moves away and back', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreAllFourPages, saveState }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // The document is append-only: scrolling far down and back up never recycles
    // a page, so the mounted set is unchanged throughout.
    scrollToPage(2, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    scrollToPage(0, FOUR_PAGE_HEIGHTS)
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('activates a distant accessible page once the anchor reaches it', () => {
    const saveState = vi.fn()
    // A reached accessible tail: pages one and two are done and page three was
    // opened, so page three is accessible and mounted from the first paint.
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

    expect(sceneIndices()).toEqual([0, 1, 2])
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // The anchor is tested against every mounted region, so a jump that lands
    // past the page's start — as End, PageDown or a scrollbar drag would — still
    // activates it.
    scrollToPage(2, [1500, 1500, 1500])

    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.visited).toBe(true)

    // Once active, the page completes through its end boundary exactly as it
    // would after a scroll, unlocking the next page.
    setEndIntersecting(2, true)
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.completed).toBe(true)
    expect(container.querySelector('[data-scroll-page="3"]')).not.toBeNull()
  })

  it('keeps a locked future page unmounted with no scene or skeleton', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />))
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()
    // A locked page is never revealed — not its content, and not any loading
    // stand-in for it either.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.textContent).not.toContain('Body 4.')
  })
})

describe('PackageView scroll lazy page loading', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('shows a startup skeleton until the restored page module resolves', async () => {
    const { provider, resolve } = deferredProvider(progressPackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={progressPackage} contentProvider={provider} />)
    )

    // The restored page is page one; until its module resolves only the startup
    // skeleton is shown and no page is mounted or reported.
    expect(container.querySelector('[data-scroll-startup]')).not.toBeNull()
    expect(sceneIndices()).toEqual([])

    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-startup]')).toBeNull()
    expect(sceneIndices()).toEqual([0])
    expect(container.textContent).toContain('Body 1.')
  })

  it('shows a skeleton slot while the next page loads and replaces it with content', async () => {
    const { provider, calls, resolve } = deferredProvider(plainTwoPagePackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={plainTwoPagePackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()
    expect(sceneIndices()).toEqual([0])

    setEndIntersecting(0, true)

    // Page two is unlocked and its module requested; a stable skeleton slot
    // stands in while it loads.
    expect(calls).toContain('page:plain-2.mdx')
    expect(container.querySelector('[data-scroll-page="1"] [data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

    expect(sceneIndices()).toEqual([0, 1])
    expect(container.querySelector('[data-scroll-page="1"] [data-slot="skeleton"]')).toBeNull()
    expect(container.textContent).toContain('Body 2.')
  })

  it('never requests a locked page module', async () => {
    const { provider, calls, resolve } = deferredProvider(progressPackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={progressPackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(calls).toEqual(['page:plain-1.mdx'])
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.textContent).not.toContain('Body 2.')
  })

  it('retries a page whose module failed to load', async () => {
    const { provider, calls, resolve, rejectLoad } = deferredProvider(plainTwoPagePackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={plainTwoPagePackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    setEndIntersecting(0, true)
    await act(async () => {
      rejectLoad('page:plain-2.mdx')
    })
    await flushLoads()

    const error = container.querySelector('[data-scroll-error]')
    expect(error).not.toBeNull()
    expect(error?.textContent).toContain('This content could not be loaded.')

    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again')
    )
    act(() => retry?.click())
    expect(calls.filter((id) => id === 'page:plain-2.mdx')).toHaveLength(2)

    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-error]')).toBeNull()
    expect(sceneIndices()).toEqual([0, 1])
  })

  it('loads a small backward context and backfills older pages as the learner scrolls back', async () => {
    const { provider, calls, resolve } = deferredProvider(progressPackage)
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

    act(() =>
      root.render(<LazyPlayer contentPackage={progressPackage} contentProvider={provider} />)
    )

    // The restored page and a small backward context load first — never the whole
    // preceding prefix.
    for (const id of ['page:plain-2.mdx', 'page:plain-3.mdx', 'page:plain-4.mdx']) {
      await act(async () => {
        resolve(id)
      })
    }
    await flushLoads()

    expect(calls).toContain('page:plain-4.mdx')
    expect(calls).not.toContain('page:plain-1.mdx')
    expect(sceneIndices()).toEqual([1, 2, 3])

    // Scrolling back towards the earliest loaded page backfills the older
    // accessible page, which then stays loaded.
    scrollToPage(1, FOUR_PAGE_HEIGHTS)
    expect(calls).toContain('page:plain-1.mdx')
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
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

  it('hands the current page to the neighbour when its end leaves the viewport top', () => {
    const { saveState } = renderFourPages()

    scrollToOffset(1400, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Past page one's end the top-of-viewport line is inside page two.
    scrollToOffset(1500, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // Scrolling back into page one's body hands it back.
    scrollToOffset(700, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('resolves a shared boundary to the single page the line actually sits in', () => {
    const { saveState } = renderFourPages()

    // The line is a point, so it can only ever be inside one page: crossing the
    // exact boundary flips deterministically with no deadband or oscillation.
    const expected: Array<[number, string]> = [
      [1499, 'page:plain-1.mdx'],
      [1500, 'page:plain-2.mdx'],
      [1499, 'page:plain-1.mdx'],
      [1501, 'page:plain-2.mdx']
    ]
    for (const [offset, location] of expected) {
      scrollToOffset(offset, FOUR_PAGE_HEIGHTS)
      expect(lastSaved(saveState).location).toBe(location)
    }
  })

  it('keeps a short page current while its top is at the line, then hands over', () => {
    const { saveState } = renderFourPages()

    // Page two is only 40px tall. It owns the line the moment its top reaches the
    // viewport top, however short it is ...
    scrollToOffset(1500, [1500, 40, 1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // ... and hands over once it has been scrolled fully past the line.
    scrollToOffset(1540, [1500, 40, 1500, 1500])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('does not activate a distant page before the anchor reaches it', () => {
    const { saveState } = renderFourPages()

    // Every accessible page is mounted, but the current page is still page one.
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // A scroll still inside page one must not prematurely hand activation to a
    // distant page.
    scrollToOffset(500, FOUR_PAGE_HEIGHTS)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Only when the anchor actually reaches it does the location move.
    scrollToPage(3, FOUR_PAGE_HEIGHTS)
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
    // A short opacity-only settle; the reduced-motion variant removes the
    // transition entirely.
    expect(content?.className).toContain('transition-opacity')
    expect(content?.className).toContain('duration-200')
    expect(content?.className).toContain('ease-out')
    expect(content?.className).toContain('motion-reduce:transition-none')
    // The emphasis is a subtle opacity only: nothing is scaled, offset, hidden
    // or removed from the flow.
    expect(content?.className).toContain('opacity-100')
    expect(content?.className).not.toContain('scale')
    expect(content?.className).not.toContain('translate')
    expect(content?.className).not.toContain('hidden')
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

  it('scrolls the mounted target scene to the referenced page', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    // The target is accessible, so its real scene is already mounted; nothing is
    // held back as a placeholder.
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-virtualized]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The jump mounted nothing new; the document stays append-only.
    expect(sceneIndices()).toEqual([0, 1, 2, 3])

    // A deliberate Path jump animates to the target scene ...
    const contexts = scrollIntoView.mock.contexts as Element[]
    const targetCall = contexts.findIndex(
      (element) => element.getAttribute('data-scene-index') === '3'
    )
    expect(targetCall).toBeGreaterThanOrEqual(0)
    expect(scrollIntoView.mock.calls[targetCall]?.[0]).toMatchObject({
      block: 'start',
      behavior: 'smooth'
    })

    // jsdom reports no geometry, so the intended target is recorded as the
    // current page — after the scroll was issued, never ahead of it.
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('requests a target whose module is not loaded and scrolls once it arrives', async () => {
    const { provider, calls, resolve } = deferredProvider(nonAdjacentPathPackage)
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() =>
      root.render(<LazyPlayer contentPackage={nonAdjacentPathPackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:path.mdx')
    })
    await flushLoads()

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The target's module is requested and a skeleton stands in while it
    // resolves; the jump waits rather than scrolling a placeholder.
    expect(calls).toContain('page:plain-4.mdx')
    expect(container.querySelector('[data-scroll-page="3"] [data-slot="skeleton"]')).not.toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(lastSaved(saveState).location).toBe('page:path.mdx')

    await act(async () => {
      resolve('page:plain-4.mdx')
    })
    await flushLoads()

    // Once the real scene exists the jump scrolls it, and the target becomes the
    // stored location where no geometry is available to reconcile.
    const contexts = scrollIntoView.mock.contexts as Element[]
    const targetCall = contexts.findIndex(
      (element) => element.getAttribute('data-scene-index') === '3'
    )
    expect(targetCall).toBeGreaterThanOrEqual(0)
    expect(scrollIntoView.mock.calls[targetCall]?.[0]).toMatchObject({
      block: 'start',
      behavior: 'smooth'
    })
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('scrolls a Path jump instantly under reduced motion', () => {
    preferReducedMotion()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // A deliberate jump still moves to the target scene, but under reduced motion
    // the browser is asked to jump instantly rather than animate.
    const contexts = scrollIntoView.mock.contexts as Element[]
    const targetCall = contexts.findIndex(
      (element) => element.getAttribute('data-scene-index') === '3'
    )
    expect(scrollIntoView.mock.calls[targetCall]?.[0]).toMatchObject({
      block: 'start',
      behavior: 'auto'
    })
  })
})

describe('PackageView short-page jump navigation', () => {
  useViewportHeight(VIEWPORT_HEIGHT)

  it('keeps every short page mounted after a jump', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreShortPages, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Every accessible short page is mounted from the first paint.
    expect(container.querySelector('[data-scene-index="2"]')).not.toBeNull()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The jump targets the short page three; the short pages around it stay real
    // scenes rather than being removed.
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
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

  // The pages around the restored one are short, so several share the viewport
  // at once; the restore still positions the saved page at the viewport top.
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

  it('waits for the restored page and its backward context before positioning', async () => {
    const { provider, calls, resolve } = deferredProvider(shortPagesPackage)
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() =>
      root.render(<LazyPlayer contentPackage={shortPagesPackage} contentProvider={provider} />)
    )

    // While the saved page's module resolves, no page is mounted and nothing is
    // reported, so the location is never transiently moved to page zero.
    expect(container.querySelector('[data-scroll-startup]')).not.toBeNull()
    expect(sceneIndices()).toEqual([])
    expect(saveState).not.toHaveBeenCalled()

    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)

    // The saved page resolves, but its two backward-context pages are still in
    // flight. Their skeleton slots sit *above* the saved page and would later
    // swap to their natural height, so positioning now would shift the saved
    // page on an engine without scroll anchoring. The restore therefore waits:
    // still only the startup skeleton, nothing mounted, positioned or detected.
    expect(calls).toContain('page:plain-3.mdx')
    await act(async () => {
      resolve('page:plain-3.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-startup]')).not.toBeNull()
    expect(sceneIndices()).toEqual([])
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(saveState).not.toHaveBeenCalled()

    // Detection is not wired up either, so a scroll while the context resolves
    // cannot move the location.
    scrollToOffset(0, SHORT_PAGE_HEIGHTS)
    expect(saveState).not.toHaveBeenCalled()

    // Once the backward context commits, the document renders and the saved page
    // is positioned exactly once, so late content above it cannot move it.
    await act(async () => {
      resolve('page:short-path.mdx')
    })
    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-startup]')).toBeNull()
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    // The accessible neighbour the anchor could otherwise fall into was never
    // marked seen on the restore.
    expect(lastSaved(saveState).pages['page:plain-4.mdx']).toBeUndefined()
  })

  it('restores the last accessible page with a small window and a locked next', () => {
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

    // Pages one to four are accessible and mounted; the locked page after the
    // last accessible one never mounts.
    expect(sceneIndices()).toEqual([0, 1, 2, 3])
    expect(container.querySelector('[data-scroll-page="4"]')).toBeNull()
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

  it('resumes ordinary detection once the restore is positioned', () => {
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
    const next = nextSlideControl()
    expect(next).not.toBeNull()
    act(() => next?.click())

    expect(sceneIndices()).toEqual([1])
    expect(text()).toContain('Body 2.')
    expect(text()).not.toContain('Body 1.')
  })

  it('gates the next slide on the question gate', () => {
    act(() => root.render(<Player contentPackage={gatedSlidesPackage} />))

    // The intro slide carries a questionnaire: no next control until submitted.
    expect(nextSlideControl()).toBeNull()
    answerQuestionnaire()
    expect(nextSlideControl()).not.toBeNull()
  })

  it('marks the displayed slide as the location', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={slidesPackage} />))

    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })
})

describe('PackageView slides lazy loading', () => {
  /** The previous-slide control, which is icon-only (no text label). */
  function previousSlideControl(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('[data-slides-previous] button')
  }

  it('loads only the current slide and reports it seen once its module resolves', async () => {
    const { provider, calls, resolve } = deferredProvider(slidesPackage)
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<LazyPlayer contentPackage={slidesPackage} contentProvider={provider} />))

    // Only the current slide is requested; a locked neighbour is never fetched.
    // While it resolves a skeleton stands in and nothing is reported.
    expect(calls).toEqual(['page:plain-1.mdx'])
    expect(container.querySelector('[data-slide-loading]')).not.toBeNull()
    expect(sceneIndices()).toEqual([])
    expect(saveState).not.toHaveBeenCalled()

    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-slide-loading]')).toBeNull()
    expect(sceneIndices()).toEqual([0])
    expect(container.textContent).toContain('Body 1.')
    // The location only moves once the slide actually exists.
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('preloads the next slide only once accessible and skeletons the transition', async () => {
    const { provider, calls, resolve } = deferredProvider(slidesPackage)

    act(() => root.render(<LazyPlayer contentPackage={slidesPackage} contentProvider={provider} />))
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    // Page one completed on display, so page two is now accessible and its
    // module is preloaded ahead of the transition.
    expect(calls).toContain('page:plain-2.mdx')
    const next = nextSlideControl()
    expect(next).not.toBeNull()

    act(() => next?.click())

    // The next slide's module is still resolving, so a stable skeleton stands in
    // and the previous slide's content is gone — never a wrong page.
    expect(container.querySelector('[data-slide-loading]')).not.toBeNull()
    expect(sceneIndices()).toEqual([])
    expect(container.textContent).not.toContain('Body 1.')

    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-slide-loading]')).toBeNull()
    expect(sceneIndices()).toEqual([1])
    expect(container.textContent).toContain('Body 2.')
    expect(calls.filter((id) => id === 'page:plain-2.mdx')).toHaveLength(1)
  })

  it('never requests a locked slide module', async () => {
    const { provider, calls, resolve } = deferredProvider(gatedSlidesPackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={gatedSlidesPackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:intro.mdx')
    })
    await flushLoads()

    // The intro slide's questionnaire is unsubmitted, so the next slide stays
    // locked and its module is never requested.
    expect(calls).toEqual(['page:intro.mdx'])
    expect(nextSlideControl()).toBeNull()
    expect(container.textContent).not.toContain('Setup instructions.')
  })

  it('reuses a previously loaded slide without reloading it', async () => {
    const { provider, calls, resolve } = deferredProvider(slidesPackage)

    act(() => root.render(<LazyPlayer contentPackage={slidesPackage} contentProvider={provider} />))
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()
    act(() => nextSlideControl()?.click())
    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()
    expect(sceneIndices()).toEqual([1])

    // Stepping back renders the cached first slide immediately, without a second
    // load.
    act(() => previousSlideControl()?.click())
    expect(sceneIndices()).toEqual([0])
    expect(container.textContent).toContain('Body 1.')
    expect(calls.filter((id) => id === 'page:plain-1.mdx')).toHaveLength(1)
  })

  it('retries a slide whose module failed to load', async () => {
    const { provider, calls, resolve, rejectLoad } = deferredProvider(slidesPackage)
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<LazyPlayer contentPackage={slidesPackage} contentProvider={provider} />))
    await act(async () => {
      rejectLoad('page:plain-1.mdx')
    })
    await flushLoads()

    const error = container.querySelector('[data-slide-error]')
    expect(error).not.toBeNull()
    expect(error?.textContent).toContain('This content could not be loaded.')
    // A slide that never loaded is never reported as the location.
    expect(saveState).not.toHaveBeenCalled()

    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again')
    )
    act(() => retry?.click())
    expect(calls.filter((id) => id === 'page:plain-1.mdx')).toHaveLength(2)

    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-slide-error]')).toBeNull()
    expect(sceneIndices()).toEqual([0])
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

describe('PackageView tiles lazy item loading', () => {
  it('keeps every card visible and loads an item body only when it is opened', async () => {
    const { provider, calls, resolve } = deferredProvider(tilesPackage)

    act(() => root.render(<LazyPlayer contentPackage={tilesPackage} contentProvider={provider} />))

    // The grid renders from the manifest, so card titles are present without any
    // item body and nothing has been requested yet.
    expect(text()).toContain('Functions')
    expect(text()).toContain('Types')
    expect(text()).toContain('Extra details')
    expect(calls).toEqual([])

    act(() => findButton('Functions').click())

    // Opening the tile requests exactly its module and keeps the dialog shell
    // (title included) while a skeleton stands in for the body.
    expect(calls).toEqual(['item:functions.mdx'])
    expect(dialog()).not.toBeNull()
    expect(dialog()?.querySelector('[data-item-loading]')).not.toBeNull()
    expect(documentText()).not.toContain('Function body.')

    await act(async () => {
      resolve('item:functions.mdx')
    })
    await flushLoads()

    expect(dialog()?.querySelector('[data-item-loading]')).toBeNull()
    expect(documentText()).toContain('Function body.')
  })

  it('never requests a locked item body', async () => {
    const { provider, calls, resolve } = deferredProvider(tilesPackage)

    act(() => root.render(<LazyPlayer contentPackage={tilesPackage} contentProvider={provider} />))
    act(() => findButton('Functions').click())
    await act(async () => {
      resolve('item:functions.mdx')
    })
    await flushLoads()

    // Opening the first tile unlocked the second, but only the opened item's body
    // was ever requested — a visible-but-locked card is never loaded.
    expect(calls).toEqual(['item:functions.mdx'])
  })

  it('loads the restored item when its dialog reopens', async () => {
    const { provider, calls, resolve } = deferredProvider(quizTilesPackage)
    window.scormBridge = {
      restoreState: () => ({
        location: 'item:quiz.mdx',
        pages: { 'item:quiz.mdx': { visited: true } }
      })
    }

    act(() =>
      root.render(<LazyPlayer contentPackage={quizTilesPackage} contentProvider={provider} />)
    )

    // The saved item reopens immediately and its module is requested, with a
    // skeleton in the dialog until the body resolves.
    expect(calls).toEqual(['item:quiz.mdx'])
    expect(dialog()?.querySelector('[data-item-loading]')).not.toBeNull()

    await act(async () => {
      resolve('item:quiz.mdx')
    })
    await flushLoads()

    expect(documentText()).toContain('Shared prompt')
  })

  it('retries an item whose module failed to load', async () => {
    const { provider, calls, resolve, rejectLoad } = deferredProvider(tilesPackage)

    act(() => root.render(<LazyPlayer contentPackage={tilesPackage} contentProvider={provider} />))
    act(() => findButton('Functions').click())
    await act(async () => {
      rejectLoad('item:functions.mdx')
    })
    await flushLoads()

    const error = dialog()?.querySelector('[data-item-error]')
    expect(error).not.toBeNull()
    expect(error?.textContent).toContain('This content could not be loaded.')

    const retry = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again')
    )
    act(() => retry?.click())
    expect(calls.filter((id) => id === 'item:functions.mdx')).toHaveLength(2)

    await act(async () => {
      resolve('item:functions.mdx')
    })
    await flushLoads()

    expect(dialog()?.querySelector('[data-item-error]')).toBeNull()
    expect(documentText()).toContain('Function body.')
  })
})
