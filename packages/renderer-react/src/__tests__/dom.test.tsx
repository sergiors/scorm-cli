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

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  observers.length = 0
  resizeObservers.length = 0
  originalIntersectionObserver = globalThis.IntersectionObserver
  originalResizeObserver = globalThis.ResizeObserver
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
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

/**
 * Drives the activation observer for a page's scroll region. A mounted scene and
 * a virtualized placeholder both expose the same `[data-scroll-page]` region, so
 * this models the page becoming visible anywhere inside it—including a jump into
 * its middle or lower portion, not only across its start boundary.
 */
function setRegionIntersecting(index: number, isIntersecting: boolean): void {
  const region = container.querySelector(`[data-scroll-page="${index}"]`)
  if (!region) {
    throw new Error(`No scroll region for page ${index}`)
  }
  driveObserver(region, isIntersecting)
}

function setEndIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-end="${index}"]`)
  if (!sentinel) {
    throw new Error(`No end sentinel for page ${index}`)
  }
  driveObserver(sentinel, isIntersecting)
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
    // The remaining pages are locked and never mounted.
    expect(container.querySelector('[data-scroll-locked]')).not.toBeNull()
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

    answerQuestionnaire()
    expect(sceneIndices()).toEqual([0, 1])
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
  it('virtualizes accessible pages outside the active window', () => {
    // Resume deep enough that several earlier pages are accessible at once.
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

    // The active page mounts; a page outside the window renders a placeholder
    // instead of its content.
    expect(container.querySelector('[data-scroll-virtualized]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-locked]')).not.toBeNull()
  })

  it('activates and mounts a page when its placeholder region becomes visible', () => {
    const saveState = vi.fn()
    // Resume deep enough that earlier pages are accessible but outside the
    // active window, so they render as placeholders.
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-3.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { completed: true },
          'page:plain-3.mdx': { visited: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Player contentPackage={progressPackage} />))

    // Page one is virtualized: a placeholder stands in for its content.
    const placeholder = container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')
    expect(placeholder).not.toBeNull()
    expect(sceneIndices()).not.toContain(0)

    // Scrolling (or an instant jump) that brings the placeholder region into the
    // activation band must mount the page and store it as the location.
    setRegionIntersecting(0, true)

    expect(sceneIndices()).toContain(0)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
  })

  it('activates a distant placeholder when a jump lands in its lower region', () => {
    const saveState = vi.fn()
    // A reached accessible tail: pages one and two are done and page three was
    // opened, so page three is accessible but sits outside the active window and
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

    // The whole placeholder region is observed, so a jump that lands past its
    // start boundary—End, PageDown or a scrollbar drag that leaves its start
    // above the viewport—still activates it.
    const state = observerFor(placeholder as Element)
    expect(state.options?.rootMargin).toBe('0px 0px -50% 0px')

    setRegionIntersecting(2, true)

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

  it('disconnects a placeholder observer once the page mounts', () => {
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

    const placeholder = container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')
    const state = observerFor(placeholder as Element)
    expect(state.elements.size).toBe(1)

    setRegionIntersecting(0, true)

    // The placeholder unmounts and its observer releases the detached region, so
    // nothing keeps watching a page that is no longer virtualized.
    expect(container.querySelector('[data-scroll-virtualized="page:plain-1.mdx"]')).toBeNull()
    expect(state.elements.size).toBe(0)
  })

  it('keeps a locked future page unmounted with no scene or placeholder', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />))
    expect(container.querySelector('[data-scroll-page="1"]')).toBeNull()
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).toBeNull()
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

    // Moving back to page one virtualizes page three again.
    setRegionIntersecting(0, true)

    const placeholder = container.querySelector<HTMLElement>(
      '[data-scroll-virtualized="page:plain-3.mdx"]'
    )
    expect(placeholder).not.toBeNull()
    // The placeholder keeps the measured height, so the pages below do not shift.
    expect(placeholder?.style.minHeight).toBe('1234px')
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
    setRegionIntersecting(1, true)

    // Page B reuses the same question id but renders its own, unanswered state.
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

    // The jump re-centred the window and mounted the real target scene.
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-virtualized="page:plain-4.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')

    // The staged jump scrolled the mounted scene, never the placeholder it
    // replaced (a placeholder carries `data-scroll-page` but no scene index).
    const contexts = scrollIntoView.mock.contexts as Element[]
    expect(contexts.some((element) => element.getAttribute('data-scene-index') === '3')).toBe(true)
    expect(contexts.some((element) => element.hasAttribute('data-scroll-virtualized'))).toBe(false)
  })

  it('keeps the intended destination over a stale neighbour activation', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    // The neighbour region the re-centre is about to virtualize. Its observer is
    // still connected while the jump commits.
    const neighbour = container.querySelector('[data-scroll-page="1"]')
    expect(neighbour).not.toBeNull()

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click()
      // The browser may deliver a stale observation for that neighbour as the
      // window moves; it must not steal the intended destination.
      driveObserver(neighbour as Element, true)
    })

    expect(lastSaved(saveState).location).toBe('page:plain-4.mdx')
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()
  })

  it('releases activation suppression once the staged jump settles', () => {
    const saveState = vi.fn()
    window.scormBridge = { restoreState: restoreWithCompletedPrefix, saveState }

    act(() => root.render(<Player contentPackage={nonAdjacentPathPackage} />))

    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())

    // The staged jump committed: the destination scene mounted and the
    // suppression it raised was released once the jump settled.
    expect(container.querySelector('[data-scene-index="3"]')).not.toBeNull()

    // A page outside the re-centred window still renders as a placeholder, and
    // its region activation is no longer ignored.
    const placeholder = container.querySelector('[data-scroll-virtualized="page:plain-2.mdx"]')
    expect(placeholder).not.toBeNull()
    expect(sceneIndices()).not.toContain(1)

    setRegionIntersecting(1, true)

    expect(sceneIndices()).toContain(1)
    expect(container.querySelector('[data-scroll-virtualized="page:plain-2.mdx"]')).toBeNull()
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')
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

    setRegionIntersecting(1, true)
    expect(lastSaved(saveState).location).toBe('page:plain-2.mdx')

    // Returning to A after B reports A again and moves the location back.
    setRegionIntersecting(0, true)
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

    setRegionIntersecting(1, true)
    setRegionIntersecting(0, true)

    // One write per activation — mount, B, then A again. StrictMode's doubled
    // effects and a repeat of the id already stored are both no-ops.
    expect(saveState).toHaveBeenCalledTimes(3)
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx')
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
