// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrollPresentation } from '../../app/components/presentations/ScrollPresentation'
import { SlidesPresentation } from '../../app/components/presentations/SlidesPresentation'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import { PlayerProvider, usePlayerActions } from '../../app/lib/player-context'
import type { ContentNode, ContentPackage, PlayerState } from '../../app/types'
import { readingAnchorsForPage } from '../../app/lib/reading-anchors'
import { inlineContentProvider, questionnaireNode, singleChoiceQuestion } from './fixtures'
import { virtuosoMock } from './virtuoso-mock'

vi.mock('react-virtuoso', () => import('./virtuoso-mock'))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const content: ContentNode[] = [
  { type: 'paragraph', children: [{ type: 'text', value: 'First paragraph' }] },
  { type: 'paragraph', children: [{ type: 'text', value: 'Second paragraph' }] }
]

const contentPackage: ContentPackage = {
  metadata: { title: 'Anchor saves' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:a.mdx',
        source: 'a.mdx',
        metadata: { title: 'A' },
        content
      }
    ]
  }
}

const samePagePathContent: ContentNode[] = [
  content[0]!,
  { type: 'path', pageIds: ['page:a.mdx'] },
  questionnaireNode
]

const samePagePathPackage: ContentPackage = {
  metadata: { title: 'Same-page Path anchor' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:a.mdx',
        source: 'a.mdx',
        metadata: { title: 'A' },
        content: samePagePathContent
      }
    ]
  }
}

const firstAnchor = readingAnchorsForPage('page:a.mdx', content).get('0')?.id
const secondAnchor = readingAnchorsForPage('page:a.mdx', content).get('1')?.id
const anchorTops = new Map<string, number>([[firstAnchor!, -50]])

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  virtuosoMock.reset()
  virtuosoMock.visibleCount = 0.1
  originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const anchor = this.getAttribute('data-reading-anchor')
    if (anchor !== null) {
      return {
        top: anchorTops.get(anchor) ?? 500,
        height: 40,
        bottom: 540,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    }
    return {
      top: 0,
      height: 1000,
      bottom: 1000,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect
  })
  // Slides navigation resets the window scroller; jsdom cannot scroll.
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

function CompletionControl() {
  const { markCompleted } = usePlayerActions()
  return (
    <button type="button" data-complete onClick={() => markCompleted('page:a.mdx')}>
      Complete
    </button>
  )
}

function PathJumpAnswerControl() {
  const { setAnswer } = usePlayerActions()
  return (
    <>
      <button
        type="button"
        data-answer-first
        onClick={() => setAnswer('page:a.mdx', singleChoiceQuestion.id, 'first')}
      >
        First answer
      </button>
      <button
        type="button"
        data-answer-second
        onClick={() => setAnswer('page:a.mdx', singleChoiceQuestion.id, 'second')}
      >
        Second answer
      </button>
    </>
  )
}

function saved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

describe('latest reading anchor on existing saves', () => {
  it('persists once when the active anchor changes, but not for repeated pixel movement', () => {
    const saveState = vi.fn()
    window.scormBridge = { saveState }
    const provider = inlineContentProvider(contentPackage)

    act(() =>
      root.render(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={contentPackage}>
            <CompletionControl />
            <ScrollPresentation
              pages={
                contentPackage.presentation.type === 'scroll'
                  ? contentPackage.presentation.pages
                  : []
              }
              contentProvider={provider}
            />
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    )

    expect(saveState).toHaveBeenCalledTimes(1)
    expect(saved(saveState).location).toBe('page:a.mdx')

    act(() => {
      virtuosoMock.scrollToOffset?.(300)
    })

    expect(saveState).toHaveBeenCalledTimes(2)
    expect(saved(saveState).location).toBe(`page:a.mdx#${firstAnchor}`)

    act(() => {
      virtuosoMock.scrollToOffset?.(360)
    })
    expect(saveState).toHaveBeenCalledTimes(2)

    anchorTops.set(firstAnchor!, -100)
    anchorTops.set(secondAnchor!, -10)
    act(() => {
      virtuosoMock.scrollToOffset?.(420)
    })
    expect(saveState).toHaveBeenCalledTimes(3)
    expect(saved(saveState).location).toBe(`page:a.mdx#${secondAnchor}`)

    act(() => container.querySelector<HTMLButtonElement>('[data-complete]')?.click())

    expect(saveState).toHaveBeenCalledTimes(4)
    expect(saved(saveState).location).toBe(`page:a.mdx#${secondAnchor}`)
    expect(JSON.stringify(saved(saveState))).not.toContain('420')
  })

  it('drops the prior anchor after a Path jump to the already-active page', () => {
    const saveState = vi.fn()
    const anchor = readingAnchorsForPage('page:a.mdx', samePagePathContent).get('0')!.id
    anchorTops.set(anchor, -50)
    window.scormBridge = { saveState }
    const provider = inlineContentProvider(samePagePathPackage)
    const pages =
      samePagePathPackage.presentation.type === 'scroll'
        ? samePagePathPackage.presentation.pages
        : []

    act(() =>
      root.render(
        <PlayerI18nProvider>
          <PlayerProvider contentPackage={samePagePathPackage}>
            <PathJumpAnswerControl />
            <ScrollPresentation pages={pages} contentProvider={provider} />
          </PlayerProvider>
        </PlayerI18nProvider>
      )
    )

    act(() => virtuosoMock.scrollToOffset?.(300))
    expect(saveState).toHaveBeenCalledTimes(2)
    act(() => container.querySelector<HTMLButtonElement>('[data-answer-first]')?.click())
    expect(saved(saveState).location).toBe(`page:a.mdx#${anchor}`)
    expect(saveState).toHaveBeenCalledTimes(3)

    // Virtuoso may not emit a scroll when asked to jump to its active item.
    const dispatchEvent = window.dispatchEvent.bind(window)
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
      if (event.type === 'scroll') {
        return true
      }
      return dispatchEvent(event)
    })
    act(() => container.querySelector<HTMLButtonElement>('[data-path-entry]')?.click())
    dispatchSpy.mockRestore()

    expect(virtuosoMock.scrollToIndexCalls).toContainEqual({
      index: 0,
      align: 'start',
      behavior: 'auto'
    })
    expect(saveState).toHaveBeenCalledTimes(4)

    act(() => container.querySelector<HTMLButtonElement>('[data-answer-second]')?.click())

    expect(saveState).toHaveBeenCalledTimes(5)
    expect(saved(saveState).location).toBe('page:a.mdx')
    expect(JSON.stringify(saved(saveState))).not.toContain(anchor)
  })
})

const slidesContentOne: ContentNode[] = [
  { type: 'paragraph', children: [{ type: 'text', value: 'Slide one paragraph' }] }
]
const slidesContentTwo: ContentNode[] = [
  { type: 'paragraph', children: [{ type: 'text', value: 'Slide two paragraph' }] }
]

const slidesContentPackage: ContentPackage = {
  metadata: { title: 'Slides anchor saves' },
  presentation: {
    type: 'slides',
    pages: [
      {
        type: 'page',
        id: 'page:slide-one.mdx',
        source: 'slide-one.mdx',
        metadata: { title: 'Slide one' },
        content: slidesContentOne
      },
      {
        type: 'page',
        id: 'page:slide-two.mdx',
        source: 'slide-two.mdx',
        metadata: { title: 'Slide two' },
        content: slidesContentTwo
      }
    ]
  }
}

const quizSlideContent: ContentNode[] = [
  { type: 'paragraph', children: [{ type: 'text', value: 'Quiz slide paragraph' }] },
  questionnaireNode
]

const quizPackage: ContentPackage = {
  metadata: { title: 'Slides quiz anchor' },
  presentation: {
    type: 'slides',
    pages: [
      {
        type: 'page',
        id: 'page:quiz-slide.mdx',
        source: 'quiz-slide.mdx',
        metadata: { title: 'Quiz slide' },
        content: quizSlideContent
      }
    ]
  }
}

function AnswerControl() {
  const { setAnswer } = usePlayerActions()
  return (
    <button
      type="button"
      data-answer
      onClick={() => setAnswer('page:quiz-slide.mdx', singleChoiceQuestion.id, 'first')}
    >
      Answer
    </button>
  )
}

function renderSlidesWith(contentPackage: ContentPackage, extra: ReactNode = null): void {
  const provider = inlineContentProvider(contentPackage)
  const pages =
    contentPackage.presentation.type === 'slides' ? contentPackage.presentation.pages : []
  act(() =>
    root.render(
      <PlayerI18nProvider>
        <PlayerProvider contentPackage={contentPackage}>
          {extra}
          <SlidesPresentation pages={[...pages]} contentProvider={provider} />
        </PlayerProvider>
      </PlayerI18nProvider>
    )
  )
}

describe('Slides reading anchor tracking', () => {
  it('records scrolling without a commit and drops the stale anchor on navigation', () => {
    const saveState = vi.fn()
    // The first block of slide one sits above the viewport top, so the scroll
    // tracker resolves it as the slide's reading position.
    const slideOneAnchorId = readingAnchorsForPage('page:slide-one.mdx', slidesContentOne).get(
      '0'
    )!.id
    anchorTops.set(slideOneAnchorId, -80)
    window.scormBridge = { saveState }
    renderSlidesWith(slidesContentPackage)

    expect(saved(saveState).location).toBe('page:slide-one.mdx')

    // The active anchor transition persists, but the page identity in state is
    // unchanged and no viewport geometry is included.
    const beforeScroll = saveState.mock.calls.length
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(saveState.mock.calls.length).toBe(beforeScroll + 1)
    expect(saved(saveState).location).toBe(`page:slide-one.mdx#${slideOneAnchorId}`)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(saveState.mock.calls.length).toBe(beforeScroll + 1)

    // Navigation records the new page and never the anchor read on the slide
    // the learner left.
    const nextButton = container.querySelector<HTMLButtonElement>('[data-slides-next] button')
    expect(nextButton).not.toBeNull()
    act(() => nextButton?.click())

    expect(saved(saveState).location).toBe('page:slide-two.mdx')
    expect(Object.keys(saved(saveState)).sort()).toEqual(['location', 'pages'])
    expect(JSON.stringify(saved(saveState))).not.toContain(slideOneAnchorId)
  })

  it('carries a scroll-tracked anchor into an explicit save on the same slide', () => {
    const saveState = vi.fn()
    const slideAnchorId = readingAnchorsForPage('page:quiz-slide.mdx', quizSlideContent).get(
      '0'
    )!.id
    anchorTops.set(slideAnchorId, -80)
    window.scormBridge = { saveState }
    // The questionnaire stays unanswered, so mounting persists exactly one save.
    renderSlidesWith(quizPackage, <AnswerControl />)

    expect(saved(saveState).location).toBe('page:quiz-slide.mdx')
    expect(saveState.mock.calls).toHaveLength(1)

    // An anchor transition persists immediately; an unchanged anchor does not.
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(saveState.mock.calls).toHaveLength(2)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(saveState.mock.calls).toHaveLength(2)

    // An explicit learner answer on the same slide persists, and the saved
    // lesson location still carries the active anchor, with no viewport data.
    const answerButton = container.querySelector<HTMLButtonElement>('[data-answer]')
    expect(answerButton).not.toBeNull()
    act(() => answerButton?.click())

    expect(saved(saveState)).toEqual({
      location: `page:quiz-slide.mdx#${slideAnchorId}`,
      pages: expect.any(Object)
    })
    expect(Object.keys(saved(saveState)).sort()).toEqual(['location', 'pages'])
  })
})
