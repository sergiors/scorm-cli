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
import { virtuosoMock } from './virtuoso-mock'

// The real Virtuoso virtualizes against measured DOM geometry, which jsdom does
// not provide. The suite drives a deterministic double that models the parts the
// presentation relies on: the rendered window, `rangeChanged`, the initial
// index and `scrollToIndex`.
vi.mock('react-virtuoso', () => import('./virtuoso-mock'))

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
  virtuosoMock.reset()
  originalIntersectionObserver = globalThis.IntersectionObserver
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
  // jsdom does not implement scrolling; stub the entry point the slides
  // presentation uses so the run stays side-effect free and observable.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
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

function setEndIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-end="${index}"]`)
  if (!sentinel) {
    throw new Error(`No end sentinel for page ${index}`)
  }
  driveObserver(sentinel, isIntersecting)
}

/**
 * Moves React Virtuoso's rendered window to an item index, modelling a learner
 * scroll that leaves the window's top edge on that page. The double reports the
 * new range, so the semantic current page follows the visible range.
 */
function showScrollPage(index: number): void {
  act(() => virtuosoMock.setAnchor?.(index))
}

/** Indices of the mounted scenes, in document order. */
function sceneIndices(): number[] {
  return Array.from(container.querySelectorAll('[data-scene-index]'), (node) =>
    Number(node.getAttribute('data-scene-index'))
  )
}

/** Whether the presentation rendered page `index` in its virtualized window. */
function renderedPage(index: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-scroll-page="${index}"]`)
}

/**
 * An element's classes with any responsive variant prefix stripped, so `sm:py-12`
 * reads as `py-12` for a spacing assertion independent of the breakpoint.
 */
function baseClasses(element: Element | null | undefined): string[] {
  return (element?.className ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => name.slice(name.lastIndexOf(':') + 1))
}

/** The accessible item count the presentation last handed the virtualizer. */
function virtualizedTotal(): number | undefined {
  return virtuosoMock.lastTotalCount()
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
    // Responsive horizontal padding keeps the content off the viewport edges.
    expect(scene?.className).toContain('px-4')
    // The wrapper carries no vertical padding, margin, gap or scroll class — any
    // of which would open an artificial space between consecutive page wrappers.
    const wrapperUtilities = baseClasses(scene)
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-', 'gap-', 'scroll-']) {
      expect(wrapperUtilities.some((name) => name.startsWith(spacing))).toBe(false)
    }

    // The intentional, responsive vertical padding lives inside the page, on its
    // content, so a page still reads with breathing room from its top and bottom
    // edges even though the wrapper itself is spacing-free.
    const content = scene?.querySelector<HTMLElement>('[data-scroll-page-content]')
    expect(content).not.toBeNull()
    const contentClasses = (content?.className ?? '').split(/\s+/)
    expect(contentClasses).toContain('py-8')
    expect(contentClasses).toContain('sm:py-12')
  })

  it('keeps the loading and error slots frame- and padding-consistent with content', async () => {
    const { provider, rejectLoad } = deferredProvider(plainOnePagePackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={plainOnePagePackage} contentProvider={provider} />)
    )

    // The skeleton reuses the page frame — still a minimum small viewport, still
    // spacing-free on the wrapper — and the same inner content padding, so the
    // swap to real content changes neither the minimum size nor the spacing.
    const skeleton = container.querySelector<HTMLElement>('[data-scroll-loading]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.classList.contains('min-h-svh')).toBe(true)
    expect(baseClasses(skeleton).some((name) => name.startsWith('py-'))).toBe(false)
    expect(baseClasses(skeleton?.firstElementChild)).toContain('py-8')
    expect(baseClasses(skeleton?.firstElementChild)).toContain('py-12')

    await act(async () => {
      rejectLoad('page:plain-1.mdx')
    })
    await flushLoads()

    // The error slot keeps the same frame and the same inner padding as content.
    const error = container.querySelector<HTMLElement>('[data-scroll-error]')
    expect(error).not.toBeNull()
    expect(error?.classList.contains('min-h-svh')).toBe(true)
    expect(baseClasses(error).some((name) => name.startsWith('py-'))).toBe(false)
    expect(baseClasses(error?.firstElementChild)).toContain('py-8')
    expect(baseClasses(error?.firstElementChild)).toContain('py-12')
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

  it('exposes every accessible page to the virtualizer with no spacer', () => {
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

    // Every accessible page is an item the virtualizer may render — a real,
    // viewport-tall scene, never a height-preserving spacer — and the reload
    // opens on the first page even though a later one was saved as the location.
    expect(virtualizedTotal()).toBe(4)
    expect(sceneIndices()).toEqual([0])
    expect(renderedPage(0)?.classList.contains('min-h-svh')).toBe(true)
  })
})

describe('PackageView scroll completion gating', () => {
  it('completes a questionnaire-free page at its end and unlocks the next', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))
    expect(sceneIndices()).toEqual([0])
    expect(virtualizedTotal()).toBe(1)

    setEndIntersecting(0, true)

    // Page one is complete, so page two becomes accessible — a new list item —
    // and renders once the learner scrolls to it.
    expect(virtualizedTotal()).toBe(2)
    expect(lastSaved(saveState).pages['page:plain-1.mdx']?.completed).toBe(true)

    showScrollPage(1)
    expect(sceneIndices()).toEqual([1])
    expect(text()).toContain('Body 2.')
  })

  it('keeps the next page locked at the end until questionnaires submit', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    setEndIntersecting(0, true)
    expect(sceneIndices()).toEqual([0])
    expect(renderedPage(1)).toBeNull()
    expect(virtualizedTotal()).toBe(1)

    // The end is reached but the page still has an unsubmitted questionnaire, so
    // the page after it stays locked and the boundary notice shows at its bottom.
    const boundary = container.querySelector('[data-scroll-locked]')
    expect(boundary).not.toBeNull()
    expect(container.querySelector('[data-scene-index="0"]')?.contains(boundary!)).toBe(true)
    expect(boundary?.textContent).toContain('Complete this page to continue.')

    answerQuestionnaire()
    expect(virtualizedTotal()).toBe(2)
    // Completing the page unlocked the next one, so the notice is gone.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
  })

  it('waits for the page end when the questionnaire is submitted first', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    answerQuestionnaire()
    expect(virtualizedTotal()).toBe(1)

    setEndIntersecting(0, true)
    expect(virtualizedTotal()).toBe(2)
  })

  it('completes the package only after the final page completes', () => {
    const markCompleted = vi.fn()
    window.scormBridge = { markCompleted }

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />))
    expect(markCompleted).not.toHaveBeenCalled()

    setEndIntersecting(0, true)
    showScrollPage(1)
    setEndIntersecting(1, true)

    expect(markCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('PackageView scroll accessible list and locking', () => {
  it('exposes every accessible page and never a locked one', () => {
    window.scormBridge = { restoreState: restoreAllFourPages }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // All four pages are accessible, so the virtualizer is told there are four
    // items; the boundary notice waits until the frontier page's end is reached.
    expect(virtualizedTotal()).toBe(4)
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
  })

  it('tracks the current page as the visible window moves away and back', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreAllFourPages, saveState }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // Scrolling down and back re-renders the window and moves the location, and
    // a page's loaded content is kept by the loader across the round trip.
    showScrollPage(2)
    expect(sceneIndices()).toEqual([2])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    showScrollPage(0)
    expect(sceneIndices()).toEqual([0])
    expect(text()).toContain('Body 1.')
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('activates a distant accessible page once the visible window reaches it', () => {
    const saveState = vi.fn()
    // A reached accessible tail: pages one and two are done and page three was
    // opened, so page three is accessible and in the list from the first paint.
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

    expect(virtualizedTotal()).toBe(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    // Only when the visible window's top edge actually reaches it does the
    // location move.
    showScrollPage(2)

    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.visited).toBe(true)

    // Once active, the page completes through its end boundary exactly as it
    // would after a scroll, unlocking the next page.
    setEndIntersecting(2, true)
    expect(lastSaved(saveState).pages['page:plain-3.mdx']?.completed).toBe(true)
    expect(virtualizedTotal()).toBe(4)
  })

  it('keeps a locked future page out of the list with no scene or skeleton', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />))
    expect(renderedPage(1)).toBeNull()
    // A locked page is not a list item at all — never its content, and never any
    // loading stand-in for it either.
    expect(virtualizedTotal()).toBe(1)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.textContent).not.toContain('Body 4.')
  })
})

describe('PackageView scroll lazy page loading', () => {
  it('shows a page skeleton for the first page until its module resolves', async () => {
    const { provider, calls, resolve } = deferredProvider(progressPackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={progressPackage} contentProvider={provider} />)
    )

    // The first page's slot mounts immediately and requests its module, and a
    // stable, viewport-tall skeleton stands in until it resolves. No other page
    // is rendered or requested.
    expect(calls).toEqual(['page:plain-1.mdx'])
    expect(container.querySelector('[data-scroll-loading]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-page="0"] .prose')).toBeNull()

    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-loading]')).toBeNull()
    expect(container.querySelector('[data-scroll-page="0"] .prose')).not.toBeNull()
    expect(container.textContent).toContain('Body 1.')
  })

  it('shows a skeleton slot while a newly reachable page loads and replaces it', async () => {
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
    // Page two is now accessible, but it is not requested until the virtualizer
    // renders it.
    expect(calls).not.toContain('page:plain-2.mdx')

    showScrollPage(1)

    // Page two's slot mounts and requests its module; a stable skeleton stands
    // in while it loads.
    expect(calls).toContain('page:plain-2.mdx')
    expect(container.querySelector('[data-scroll-page="1"] [data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

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
    showScrollPage(1)
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
    expect(container.textContent).toContain('Body 2.')
  })

  it('loads the first page and requests later pages only as the window reaches them', async () => {
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

    // The first page loads first, and no later page is requested — the saved
    // deep location is ignored, so its module is never eagerly fetched.
    expect(calls).toEqual(['page:plain-1.mdx'])
    await act(async () => {
      resolve('page:plain-1.mdx')
    })
    await flushLoads()

    expect(calls).not.toContain('page:plain-4.mdx')
    expect(sceneIndices()).toEqual([0])

    // Scrolling down to a later accessible page mounts its slot, which requests
    // its module and renders it once resolved.
    showScrollPage(1)
    expect(calls).toContain('page:plain-2.mdx')
    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()
    expect(sceneIndices()).toEqual([1])
    expect(container.textContent).toContain('Body 2.')
  })
})

describe('PackageView scroll current page tracking', () => {
  function renderFourPages(saveState = vi.fn()) {
    window.scormBridge = { restoreState: restoreAllFourPages, saveState }
    act(() => root.render(<Player contentPackage={progressPackage} />))
    return { saveState }
  }

  it('makes the top edge page of the visible window current', () => {
    const { saveState } = renderFourPages()
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    showScrollPage(1)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    showScrollPage(2)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    showScrollPage(3)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('does not move the location until the visible window changes', () => {
    const { saveState } = renderFourPages()

    // Re-reporting the same window — as the virtualizer does on any re-render —
    // is a no-op, and a distant page is not activated until the window reaches
    // it.
    showScrollPage(0)
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')

    showScrollPage(3)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('hands the current page back when the window returns to a page', () => {
    const { saveState } = renderFourPages()

    showScrollPage(1)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    showScrollPage(0)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })
})

describe('PackageView scroll active page marker', () => {
  function renderFourPages() {
    window.scormBridge = { restoreState: restoreAllFourPages, saveState: vi.fn() }
    act(() => root.render(<Player contentPackage={progressPackage} />))
  }

  it('marks exactly the page at the top of the visible window as active', () => {
    renderFourPages()

    expect(
      container.querySelector<HTMLElement>('[data-active="true"]')?.getAttribute('data-scene-index')
    ).toBe('0')
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1)

    showScrollPage(1)

    expect(
      container.querySelector<HTMLElement>('[data-active="true"]')?.getAttribute('data-scene-index')
    ).toBe('1')
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1)
  })

  it('adds no animation or transition of its own', () => {
    renderFourPages()

    const content = container.querySelector<HTMLElement>('[data-scroll-page-content]')
    expect(content).not.toBeNull()
    expect(content?.className).not.toContain('transition')
    expect(content?.className).not.toContain('animate')
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

  it('removes the boundary and unlocks the next page once the frontier completes', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    setEndIntersecting(0, true)
    expect(container.querySelector('[data-scroll-locked]')).not.toBeNull()

    answerQuestionnaire()

    // Completion unlocked the next page, so the generic boundary is gone and the
    // newly accessible page is the frontier, still untouched at its own start.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()
    expect(virtualizedTotal()).toBe(2)
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

    showScrollPage(1)
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

    // Completing page A unlocked page B; rendering it reuses the same question id
    // but shows its own, unanswered state.
    showScrollPage(1)
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
    expect(virtualizedTotal()).toBe(2)
  })

  it('drops an unknown saved location and starts on the first page', () => {
    window.scormBridge = {
      restoreState: () => ({ location: 'page:missing.mdx', pages: {} })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    expect(sceneIndices()).toEqual([0])
  })

  it('writes the starting location once under StrictMode', () => {
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

    // A reload opens on the first page even though a later one was saved, and
    // StrictMode's doubled effects do not double-write the location.
    expect(sceneIndices()).toEqual([0])
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('starts at the first page despite a saved advanced location and never scrolls', () => {
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

    // The list opens at item zero, ignoring the saved location entirely, and no
    // startup navigation (`scrollToIndex`) is issued.
    expect(virtuosoMock.lastInitialIndex()).toBe(0)
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
    expect(sceneIndices()).toEqual([0])
  })

  it('preserves restored answers and submissions while starting at the first page', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:setup.mdx',
        pages: {
          'page:intro.mdx': {
            completed: true,
            answers: {
              'question:intro.mdx:1:1': 'first',
              'question:intro.mdx:1:2': ['alpha']
            },
            submittedQuestionnaires: ['questionnaire:intro.mdx:1:1']
          }
        }
      })
    }

    act(() => root.render(<Player contentPackage={gatedPackage} />))

    // The reload opens on the first page, and its restored answers and submitted
    // questionnaire are still rendered read-only: only the reading position
    // restarts, never the learner's answers.
    expect(sceneIndices()).toEqual([0])
    expect(submittedControl('first').checked).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedControl('alpha').checked).toBe(true)
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(text()).not.toContain('Submit questionnaire')
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

  it('jumps to the referenced page through the virtualizer', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    expect(lastSaved(saveState).location).toBe('page:path.mdx')
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The jump is an immediate, non-animated `scrollToIndex` to the target's
    // index; the virtualizer renders the target and it becomes the location.
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 3, align: 'start', behavior: 'auto' }
    ])
    expect(sceneIndices()).toEqual([3])
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('requests a target whose module is not loaded when the jump mounts it', async () => {
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

    expect(calls).not.toContain('page:plain-4.mdx')

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The jump is issued immediately; the target's slot then mounts, requests its
    // module and a skeleton stands in while it resolves.
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 3, align: 'start', behavior: 'auto' }
    ])
    expect(calls).toContain('page:plain-4.mdx')
    expect(container.querySelector('[data-scroll-page="3"] [data-slot="skeleton"]')).not.toBeNull()

    await act(async () => {
      resolve('page:plain-4.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-page="3"] [data-slot="skeleton"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })
})

describe('PackageView short-page jump navigation', () => {
  it('jumps to the referenced short page through the virtualizer', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreShortPages, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // Every accessible short page is an item the virtualizer can reach.
    expect(virtualizedTotal()).toBe(5)

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 2, align: 'start', behavior: 'auto' }
    ])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(sceneIndices()).toEqual([2])
  })
})

describe('PackageView scroll location revisiting', () => {
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

    showScrollPage(1)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // Returning to A after B reports A again and moves the location back.
    showScrollPage(0)
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

    showScrollPage(1)
    showScrollPage(0)

    // One write per activation — mount, B, then A again. StrictMode's doubled
    // effects and a repeat of the id already stored are both no-ops.
    expect(saveState).toHaveBeenCalledTimes(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })
})

describe('PackageView scroll reload start', () => {
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

  it('starts at the first page and never renders or loads a saved later page', async () => {
    const { provider, calls, resolve } = deferredProvider(shortPagesPackage)
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() =>
      root.render(<LazyPlayer contentPackage={shortPagesPackage} contentProvider={provider} />)
    )

    // Virtuoso opens at item zero — the saved location (index 2) is ignored — so
    // only the first page's slot mounts and requests content; the saved later
    // page is neither rendered nor loaded.
    expect(virtuosoMock.lastInitialIndex()).toBe(0)
    expect(sceneIndices()).toEqual([0])
    expect(calls).toEqual(['page:short-path.mdx'])
    expect(saveState).not.toHaveBeenCalled()

    await act(async () => {
      resolve('page:short-path.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-loading]')).toBeNull()
    expect(renderedPage(0)?.querySelector('.prose')).not.toBeNull()
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')
    // The saved later page was never mounted, so it was never marked seen.
    expect(lastSaved(saveState).pages['page:plain-4.mdx']).toBeUndefined()
  })

  it('keeps the page after the last accessible one out of the list', () => {
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

    // Pages one to four are accessible list items; the locked page after the
    // last accessible one is not in the list at all, and the reload still opens
    // on the first page.
    expect(virtualizedTotal()).toBe(4)
    expect(renderedPage(4)).toBeNull()
    expect(sceneIndices()).toEqual([0])
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')
  })

  it('keeps a locked next page out of the list at the start', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleLockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The next page is locked, so it is not a list item; the reload opens on the
    // first page regardless of the saved location.
    expect(virtualizedTotal()).toBe(3)
    expect(renderedPage(3)).toBeNull()
    expect(sceneIndices()).toEqual([0])
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')
  })

  it('tracks the current page from the visible range after a reload', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The reload opens on the first page and stores it as the location, ignoring
    // the saved later one.
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')

    // Scrolling down and back moves the location exactly as an uninterrupted
    // session would.
    showScrollPage(2)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    showScrollPage(0)
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')
  })

  it('opens on a natural-height first page with no inner scroll viewport', () => {
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    const scene = renderedPage(0)
    expect(scene).not.toBeNull()
    // A page reserves a minimum small viewport; there is no dynamic viewport
    // height, no centering and no inner scroll viewport: the document is the
    // single, browser-native scroll container, which Virtuoso uses directly.
    expect(scene?.classList.contains('min-h-svh')).toBe(true)
    expect(scene?.classList.contains('min-h-dvh')).toBe(false)
    expect(scene?.classList.contains('justify-center')).toBe(false)
    expect(container.querySelector('.overflow-y-auto')).toBeNull()

    // The reload sits at Virtuoso's own initial item zero — not a scripted
    // scroll — and the saved location never positions it.
    expect(virtuosoMock.lastInitialIndex()).toBe(0)
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
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
