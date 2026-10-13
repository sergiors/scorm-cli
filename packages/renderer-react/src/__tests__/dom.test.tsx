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
 * An element's classes with any responsive variant prefix stripped, so `sm:px-4`
 * reads as `px-4` for a spacing assertion independent of the breakpoint.
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

/**
 * Four pages whose third page carries a questionnaire. Restoring the third page
 * as merely visited then leaves a locked gap at page two and a locked successor
 * at page four, so the accessible run is non-contiguous.
 */
const gappedVisitPackage: ContentPackage = {
  metadata: { title: 'Gapped visit' },
  presentation: {
    type: 'scroll',
    pages: [
      plainPage(1),
      plainPage(2),
      sharedPage('page:plain-3.mdx', 'plain-3.mdx', 'Plain 3'),
      plainPage(4)
    ]
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
  it('keeps the page scene at its natural content height with no viewport sizing or centering', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    const scene = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    expect(scene).not.toBeNull()
    // Natural content height: no viewport-based minimum, fixed or dynamic, so a
    // short page is exactly as tall as its content and a long one simply grows.
    expect(scene?.classList.contains('min-h-svh')).toBe(false)
    expect(scene?.classList.contains('min-h-dvh')).toBe(false)
    expect(scene?.classList.contains('h-svh')).toBe(false)
    expect(scene?.classList.contains('max-h-svh')).toBe(false)
    expect(scene?.classList.contains('justify-center')).toBe(false)
    // The width and horizontal padding are not repeated on the page slot; they
    // live once on the shared column around the whole list.
    expect(scene?.className).not.toContain('max-w-3xl')
    expect(scene?.className).not.toContain('px-4')
    // The measured region itself never carries the emphasis transform, so its
    // geometry stays exactly what anchor detection reads.
    expect(scene?.classList.contains('transition')).toBe(false)
    expect(scene?.classList.contains('translate-y-1')).toBe(false)
    // The wrapper carries no vertical padding, margin, gap or scroll class — any
    // of which would open an artificial space between consecutive page wrappers.
    const wrapperUtilities = baseClasses(scene)
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-', 'gap-', 'scroll-']) {
      expect(wrapperUtilities.some((name) => name.startsWith(spacing))).toBe(false)
    }

    // The page content carries no vertical padding, margin or gap of its own
    // either, so consecutive pages meet with only their natural typography
    // spacing between them and no artificial vertical space is introduced.
    const content = scene?.querySelector<HTMLElement>('[data-scroll-page-content]')
    expect(content).not.toBeNull()
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-', 'gap-']) {
      expect(baseClasses(content).some((name) => name.startsWith(spacing))).toBe(false)
    }

    // The prose region that wraps the authored content adds no vertical padding
    // of its own either — spacing comes only from the typography between the
    // content's own blocks, never an explicit gap around every page.
    const prose = content?.querySelector<HTMLElement>('.prose')
    expect(prose).not.toBeNull()
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-']) {
      expect(baseClasses(prose).some((name) => name.startsWith(spacing))).toBe(false)
    }
  })

  it('frames the list in one shared column with no nested scroller', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />))

    // Exactly one column frames the whole reading list — never one per page slot.
    const columns = container.querySelectorAll<HTMLElement>('[data-scroll-column]')
    expect(columns).toHaveLength(1)
    const column = columns[0]!
    // It supplies the responsive width and horizontal padding...
    expect(column.className).toContain('mx-auto')
    expect(column.className).toContain('w-full')
    expect(column.className).toContain('max-w-3xl')
    expect(column.className).toContain('px-4')
    expect(column.className).toContain('sm:px-6')
    // ...but no overflow, height or vertical padding that could make it a second
    // scroll container; the document stays the only scroller.
    const utilities = baseClasses(column)
    for (const forbidden of ['overflow-', 'h-', 'min-h-', 'max-h-', 'py-', 'pt-', 'pb-']) {
      expect(utilities.some((name) => name.startsWith(forbidden))).toBe(false)
    }
    expect(column.querySelector('.overflow-y-auto')).toBeNull()
    expect(column.querySelector('.overflow-auto')).toBeNull()
    // The page slots render inside it, so they inherit its width without
    // repeating the layout classes.
    expect(column.contains(renderedPage(0))).toBe(true)
  })

  it('keeps the loading and error slots small inside the shared column', async () => {
    const { provider, rejectLoad } = deferredProvider(plainOnePagePackage)

    act(() =>
      root.render(<LazyPlayer contentPackage={plainOnePagePackage} contentProvider={provider} />)
    )

    const column = container.querySelector<HTMLElement>('[data-scroll-column]')
    expect(column).not.toBeNull()

    // The loading slot is a small, static, natural-height indication — never a
    // viewport-tall panel — that adds no size, width or spacing of its own, so it
    // stays small and the swap to real content changes neither the page's natural
    // size nor the spacing. The shared column supplies the width and padding.
    const skeleton = container.querySelector<HTMLElement>('[data-scroll-loading]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.classList.contains('min-h-svh')).toBe(false)
    expect(skeleton?.classList.contains('min-h-dvh')).toBe(false)
    expect(skeleton?.className).not.toContain('max-w-3xl')
    expect(baseClasses(skeleton).some((name) => name.startsWith('py-'))).toBe(false)
    expect(baseClasses(skeleton?.firstElementChild).some((name) => name.startsWith('py-'))).toBe(
      false
    )
    expect(column?.contains(skeleton)).toBe(true)
    // Small: only a handful of short skeleton lines, not a page-sized placeholder.
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length ?? 0).toBeLessThanOrEqual(4)

    await act(async () => {
      rejectLoad('page:plain-1.mdx')
    })
    await flushLoads()

    // The error slot likewise adds no size or spacing of its own, so it stays
    // small inside the shared column.
    const error = container.querySelector<HTMLElement>('[data-scroll-error]')
    expect(error).not.toBeNull()
    expect(error?.classList.contains('min-h-svh')).toBe(false)
    expect(error?.className).not.toContain('max-w-3xl')
    expect(baseClasses(error).some((name) => name.startsWith('py-'))).toBe(false)
    expect(baseClasses(error?.firstElementChild).some((name) => name.startsWith('py-'))).toBe(false)
    expect(column?.contains(error)).toBe(true)
  })

  it('lets a page longer than the viewport grow without clipping or centering', () => {
    // jsdom performs no layout, so the guarantee is asserted at the style level:
    // the wrapper sets no viewport height at all and clips nothing, so content
    // simply extends the page and stays top-aligned rather than being scaled,
    // capped or centered.
    act(() => root.render(<Player contentPackage={plainOnePagePackage} />))

    const scene = container.querySelector<HTMLElement>('[data-scene-index="0"]')
    expect(scene).not.toBeNull()
    const sceneClasses = (scene?.className ?? '').split(/\s+/)
    expect(sceneClasses).not.toContain('min-h-svh')
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
    // natural-height scene, never a height-preserving spacer — and the reload
    // opens at the saved accessible page's index.
    expect(virtualizedTotal()).toBe(4)
    expect(sceneIndices()).toEqual([3])
    expect(renderedPage(3)?.classList.contains('min-h-svh')).toBe(false)
  })
})

describe('PackageView scroll Virtuoso-owned geometry', () => {
  it('gives Virtuoso no custom item-height compensation for natural-height pages', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />))

    // Positions for not-yet-measured pages stay Virtuoso's own: it probes the
    // first rendered page to derive a default and refines every size as pages
    // measure. The presentation adds no `defaultItemHeight` (never a
    // viewport-sized estimate), no per-index `heightEstimates` and no
    // `fixedItemHeight`, and renders exactly the visible window.
    expect(virtuosoMock.lastProps?.defaultItemHeight).toBeUndefined()
    expect(virtuosoMock.lastProps?.heightEstimates).toBeUndefined()
    expect(virtuosoMock.lastProps?.fixedItemHeight).toBeUndefined()
    expect(virtuosoMock.lastProps?.overscan).toBe(0)
    // The document is the single scroller, so Virtuoso uses window scroll.
    expect(virtuosoMock.lastProps?.useWindowScroll).toBe(true)
  })

  it('asks Virtuoso to place a deep Path target at the top, instantly', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:path.mdx',
        pages: {
          'page:path.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { completed: true }
        }
      })
    }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))
    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // Virtuoso owns where the unmeasured target lands; the presentation only
    // asks it to put the target at the top of the viewport with no animation.
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 3, align: 'start', behavior: 'auto' }
    ])
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
    // Page two is now accessible, and because completion just unlocked it, its
    // module is requested eagerly so scrolling to it finds content already
    // resolving instead of a fresh load.
    expect(calls).toContain('page:plain-2.mdx')

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

  it('requests the restored page and only one accessible page ahead, never a locked tail', async () => {
    const { provider, calls, resolve } = deferredProvider(progressPackage)
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-2.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true }
        }
      })
    }

    act(() =>
      root.render(<LazyPlayer contentPackage={progressPackage} contentProvider={provider} />)
    )

    // The restored page loads first, and only the accessible page after it is
    // requested ahead of time — the locked page four is never eagerly fetched.
    expect(calls).toEqual(['page:plain-2.mdx', 'page:plain-3.mdx'])
    expect(calls).not.toContain('page:plain-4.mdx')
    await act(async () => {
      resolve('page:plain-2.mdx')
    })
    await flushLoads()

    expect(sceneIndices()).toEqual([1])

    // Scrolling down to the next accessible page mounts its slot, whose module
    // was already requested ahead; the page after it is now requested ahead.
    showScrollPage(2)
    await act(async () => {
      resolve('page:plain-3.mdx')
    })
    await flushLoads()
    expect(sceneIndices()).toEqual([2])
    expect(container.textContent).toContain('Body 3.')
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

  it('never re-scrolls the list when the current page changes', () => {
    const { saveState } = renderFourPages()

    // Moving the visible window changes the location, but the presentation never
    // reacts by issuing a scroll: the location is an output of the viewport, not
    // an input to it, so no feedback loop can form.
    showScrollPage(2)
    showScrollPage(0)
    showScrollPage(3)

    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
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

  it('places the boundary on a restored visited page whose document successor is locked', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-1.mdx',
        pages: { 'page:plain-3.mdx': { visited: true } }
      })
    }

    act(() => root.render(<Player contentPackage={gappedVisitPackage} />))

    // Page one is the first not-done page and page three stays reachable as a
    // restored visited page, so the accessible run is [1, 3] and skips the
    // still-locked page two.
    expect(virtualizedTotal()).toBe(2)
    expect(text()).toContain('Body 1.')
    expect(text()).not.toContain('Body 2.')

    // Nothing is shown until the frontier page's end is reached.
    expect(container.querySelector('[data-scroll-locked]')).toBeNull()

    // The frontier is page three, at accessible index one. Its document successor
    // is the locked page four — not its successor in the accessible run, which is
    // absent — so the boundary belongs at the bottom of page three.
    showScrollPage(1)
    expect(text()).toContain('Shared prompt')
    setEndIntersecting(1, true)

    const boundary = container.querySelector('[data-scroll-locked]')
    expect(boundary).not.toBeNull()
    expect(container.querySelector('[data-scene-index="1"]')?.contains(boundary!)).toBe(true)
    expect(boundary?.textContent).toContain('Complete this page to continue.')

    // Neither locked page is mounted or reveals its content.
    expect(text()).not.toContain('Body 2.')
    expect(text()).not.toContain('Body 4.')
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

  it('resumes the saved location once under StrictMode', () => {
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

    // A reload resumes the saved page, and StrictMode's doubled effects do not
    // double-write its location.
    expect(sceneIndices()).toEqual([1])
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
  })

  it('restores the saved accessible location without issuing a scroll', () => {
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

    // The list opens directly at the restored page's index, and no startup
    // navigation (`scrollToIndex`) is issued — the initial item *is* the
    // position, so initialization never creates a feedback loop.
    expect(virtuosoMock.lastInitialIndex()).toBe(2)
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
    expect(sceneIndices()).toEqual([2])
  })

  it('falls back to the first page for an unknown saved location', () => {
    // An unknown id is dropped by the sanitizer, so the location is absent and
    // the list opens at the first accessible page without any scripted scroll.
    window.scormBridge = { restoreState: () => ({ location: 'page:missing.mdx', pages: {} }) }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    expect(virtuosoMock.lastInitialIndex()).toBe(0)
    expect(sceneIndices()).toEqual([0])
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
  })

  it('falls back to the first page for a locked saved location', () => {
    // The saved id names a still-locked page, so it is not in the accessible run
    // and the list opens at the first accessible page instead.
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-4.mdx',
        pages: { 'page:plain-1.mdx': { completed: true } }
      })
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    expect(virtuosoMock.lastInitialIndex()).toBe(0)
    expect(sceneIndices()).toEqual([0])
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
  })

  it('restores the saved page while keeping its earlier restored answers and submissions', () => {
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

    // The reload resumes on the saved page, and the earlier page's restored
    // answers and submitted questionnaire are still rendered read-only when the
    // learner scrolls back to it — only the reading position resumes.
    expect(sceneIndices()).toEqual([1])
    showScrollPage(0)
    expect(submittedControl('first').checked).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedControl('alpha').checked).toBe(true)
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(text()).not.toContain('Submit questionnaire')
  })

  it('keeps restored completion and answers without overwriting the restored location', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:b.mdx',
        pages: {
          'page:a.mdx': { completed: true },
          'page:b.mdx': { visited: true, answers: { 'question:shared': 'yes' } }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={sharedQuestionPackage} />))

    // The reload resumes on the saved page. Because that page is already marked
    // visited and already the location, the first seen report is a no-op — the
    // restored location is never transiently overwritten by page zero.
    expect(sceneIndices()).toEqual([1])
    expect(saveState).not.toHaveBeenCalled()
    // The restored answer still renders on the resumed page...
    expect(input('yes').checked).toBe(true)
    // ...and restored completion keeps the next page reachable.
    expect(virtualizedTotal()).toBe(2)
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

    // The jump first ensures the target's module is resolving, so the target is
    // requested immediately and the list is left in place until it settles. The
    // jump does not guarantee the content is already committed — Virtuoso mounts
    // the item on its next commit — it only avoids starting the load at the jump.
    expect(calls).toContain('page:plain-4.mdx')
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)

    await act(async () => {
      resolve('page:plain-4.mdx')
    })
    await flushLoads()

    // Once the target exists the jump is an immediate, non-animated
    // `scrollToIndex`; the virtualizer mounts the already-loaded target.
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 3, align: 'start', behavior: 'auto' }
    ])
    expect(sceneIndices()).toEqual([3])
    expect(container.querySelector('[data-scroll-page="3"] [data-slot="skeleton"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('moves to a failed Path target so its retryable error slot is shown', async () => {
    const { provider, resolve, rejectLoad } = deferredProvider(nonAdjacentPathPackage)
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState: vi.fn() }

    act(() =>
      root.render(<LazyPlayer contentPackage={nonAdjacentPathPackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:path.mdx')
    })
    await flushLoads()

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    await act(async () => {
      rejectLoad('page:plain-4.mdx')
    })
    await flushLoads()

    // The target failed to load, but the jump still moves there so the learner
    // sees the target's own retry affordance rather than a silent no-op.
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 3, align: 'start', behavior: 'auto' }
    ])
    const error = container.querySelector<HTMLElement>('[data-scroll-error]')
    expect(error).not.toBeNull()
    expect(error?.getAttribute('data-scroll-page')).toBe('3')
    expect(error?.textContent).toContain('This content could not be loaded.')

    // The retry action loads the target and replaces the error with its content.
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again')
    )
    act(() => retry?.click())
    await act(async () => {
      resolve('page:plain-4.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-error]')).toBeNull()
    expect(container.textContent).toContain('Body 4.')
  })
})

describe('PackageView Path jump supersession', () => {
  const gatePage: PageNode = {
    type: 'page',
    id: 'page:gate.mdx',
    source: 'gate.mdx',
    metadata: { title: 'Gate' },
    content: [{ type: 'path', pageIds: ['page:target-a.mdx', 'page:target-b.mdx'] }]
  }
  const targetAPage: PageNode = {
    type: 'page',
    id: 'page:target-a.mdx',
    source: 'target-a.mdx',
    metadata: { title: 'Target A' },
    content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Target A body.' }] }]
  }
  const targetBPage: PageNode = {
    type: 'page',
    id: 'page:target-b.mdx',
    source: 'target-b.mdx',
    metadata: { title: 'Target B' },
    content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Target B body.' }] }]
  }
  const jumpRacePackage: ContentPackage = {
    metadata: { title: 'Jump race' },
    presentation: { type: 'scroll', pages: [gatePage, targetAPage, targetBPage] }
  }

  it('lets a newer Path jump supersede an older one still loading', async () => {
    const { provider, resolve } = deferredProvider(jumpRacePackage)
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:gate.mdx',
        pages: {
          'page:gate.mdx': { completed: true },
          'page:target-a.mdx': { visited: true, completed: true }
        }
      }),
      saveState
    }

    act(() =>
      root.render(<LazyPlayer contentPackage={jumpRacePackage} contentProvider={provider} />)
    )
    await act(async () => {
      resolve('page:gate.mdx')
    })
    await flushLoads()

    const entries = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'))

    // Target A is already visited and Target B is the next available reference,
    // so both entries are clickable.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual(['visited', 'available'])

    // Two jumps in quick succession while both targets are still loading.
    act(() => entries()[0]?.click())
    act(() => entries()[1]?.click())
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)

    // The older target resolves first, but its jump has been superseded and must
    // not move the list; only the newer target's jump lands.
    await act(async () => {
      resolve('page:target-a.mdx')
    })
    await flushLoads()
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)

    await act(async () => {
      resolve('page:target-b.mdx')
    })
    await flushLoads()
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 2, align: 'start', behavior: 'auto' }
    ])
    expect(sceneIndices()).toEqual([2])
    expect(lastSaved(saveState).location).toBe('page:target-b.mdx')
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

  it('resumes at the saved page and only loads it plus one accessible page ahead', async () => {
    const { provider, calls, resolve } = deferredProvider(shortPagesPackage)
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() =>
      root.render(<LazyPlayer contentPackage={shortPagesPackage} contentProvider={provider} />)
    )

    // Virtuoso opens at the restored page's index, so its slot mounts and
    // requests content; only the next accessible page is requested one ahead,
    // and the locked tail beyond it is never rendered or loaded.
    expect(virtuosoMock.lastInitialIndex()).toBe(2)
    expect(sceneIndices()).toEqual([2])
    expect(calls).toEqual(['page:plain-3.mdx', 'page:plain-4.mdx'])
    expect(calls).not.toContain('page:plain-5.mdx')
    expect(saveState).not.toHaveBeenCalled()

    await act(async () => {
      resolve('page:plain-3.mdx')
    })
    await flushLoads()

    expect(container.querySelector('[data-scroll-loading]')).toBeNull()
    expect(renderedPage(2)?.querySelector('.prose')).not.toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    // The locked tail page was never mounted, so it was never marked seen.
    expect(lastSaved(saveState).pages['page:plain-5.mdx']).toBeUndefined()
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
    // last accessible one is not in the list at all, and the reload opens at the
    // saved accessible page.
    expect(virtualizedTotal()).toBe(4)
    expect(renderedPage(4)).toBeNull()
    expect(sceneIndices()).toEqual([3])
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
  })

  it('keeps a locked next page out of the list at the start', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleLockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The next page is locked, so it is not a list item; the reload opens at the
    // saved accessible page.
    expect(virtualizedTotal()).toBe(3)
    expect(renderedPage(3)).toBeNull()
    expect(sceneIndices()).toEqual([2])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
  })

  it('tracks the current page from the visible range after a reload', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext, saveState }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    // The reload opens at the restored page and stores it as the location.
    expect(sceneIndices()).toEqual([2])
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')

    // Scrolling back up and forward moves the location exactly as an
    // uninterrupted session would, without re-scrolling the list.
    showScrollPage(0)
    expect(lastSaved(saveState).location).toBe('page:short-path.mdx')

    showScrollPage(2)
    expect(lastSaved(saveState).location).toBe('page:plain-3.mdx')
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)
  })

  it('opens on a natural-height restored page with no inner scroll viewport', () => {
    window.scormBridge = { restoreState: restoreMiddleUnlockedNext }

    act(() => root.render(<Player contentPackage={shortPagesPackage} />))

    const scene = renderedPage(2)
    expect(scene).not.toBeNull()
    // A page keeps its natural height — no viewport-based sizing, no centering
    // and no inner scroll viewport: the document is the single, browser-native
    // scroll container, which Virtuoso uses directly. A single shared column
    // frames the list without adding an inner scroller of its own.
    expect(scene?.classList.contains('min-h-svh')).toBe(false)
    expect(scene?.classList.contains('min-h-dvh')).toBe(false)
    expect(scene?.classList.contains('justify-center')).toBe(false)
    expect(container.querySelectorAll('[data-scroll-column]')).toHaveLength(1)
    expect(container.querySelector('[data-scroll-column]')?.className).toContain('max-w-3xl')
    expect(container.querySelector('.overflow-y-auto')).toBeNull()
    expect(container.querySelector('.overflow-auto')).toBeNull()

    // The reload sits at Virtuoso's own initial item — the restored index, not a
    // scripted scroll.
    expect(virtuosoMock.lastInitialIndex()).toBe(2)
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
