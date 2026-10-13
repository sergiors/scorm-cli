import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { AnswerValue, PageNode, PlayerPageState } from '../types'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  getSequentialAccess
} from '../lib/content-helpers'
import { clampPageIndex } from '../lib/sequence'
import { Button } from './ui/button'
import { ContentRenderer } from './ContentRenderer'

/** The nodes already opened or done, which the shared access policy treats as reached. */
function reachedPageIds(
  pages: readonly PageNode[],
  pageStates: Record<string, PlayerPageState>
): Set<string> {
  return new Set(
    pages
      .filter((page) => {
        const state = pageStates[page.id]
        return state?.visited === true || state?.completed === true
      })
      .map((page) => page.id)
  )
}

/** The nodes whose own completion rule has been met, which advance the done prefix. */
function donePageIds(
  pages: readonly PageNode[],
  pageStates: Record<string, PlayerPageState>
): Set<string> {
  return new Set(
    pages.filter((page) => pageStates[page.id]?.completed === true).map((page) => page.id)
  )
}

export interface SlidesPresentationProps {
  pages: PageNode[]
  /**
   * Page to open on first mount, so a saved lesson location can resume on the
   * bookmarked page instead of the first one. Clamped to the accessible pages.
   */
  initialIndex?: number
  /** Persisted state per page id, for restored answers and submitted state. */
  pageStates: Record<string, PlayerPageState>
  /**
   * Invoked once per displayed page — on first mount and on every transition —
   * to store it as the current location and mark it visited.
   */
  onPageSeen: (id: string) => void
  /**
   * Invoked once when the displayed page is complete: every questionnaire it
   * contains has been submitted. Completion is what unlocks the next page.
   */
  onPageCompleted: (id: string) => void
  /** Persists a question answer for the displayed page. */
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void
  /** Marks a questionnaire on the displayed page as submitted. */
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void
  /** Persists a video's semantic playback position in seconds, scoped to the page. */
  onVideoPosition?: (pageId: string, videoId: string, seconds: number) => void
}

/**
 * Shows exactly one page at a time, in order. Only the active page is rendered,
 * so neighbouring pages are never exposed. Advancing is gated by the shared
 * sequential progression policy: the next control appears only once the active
 * page is complete — every questionnaire on it submitted — and stepping back is
 * always available while a previous page exists. A Path can only jump to a page
 * the policy reports as accessible.
 */
export function SlidesPresentation({
  pages,
  initialIndex = 0,
  pageStates,
  onPageSeen,
  onPageCompleted,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition
}: SlidesPresentationProps) {
  const ids = pages.map((page) => page.id)
  const { accessible } = getSequentialAccess(
    ids,
    donePageIds(pages, pageStates),
    reachedPageIds(pages, pageStates)
  )

  const [currentIndex, setCurrentIndex] = useState(() => {
    const requested = clampPageIndex(initialIndex, pages.length)
    const requestedId = pages[requested]?.id
    return requestedId !== undefined && accessible.has(requestedId) ? requested : 0
  })

  const currentPage = pages[currentIndex]

  // Every page opens at its top; the reset runs before paint so a previous
  // page's offset never leaks into the next one.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [currentPage?.id])

  const goToPage = useCallback(
    (index: number) => {
      const nextIndex = clampPageIndex(index, pages.length)
      const target = pages[nextIndex]
      if (!target || nextIndex === currentIndex || !accessible.has(target.id)) {
        return
      }
      setCurrentIndex(nextIndex)
    },
    [accessible, currentIndex, pages]
  )

  const navigateToPageId = useCallback(
    (pageId: string) => {
      const index = pages.findIndex((page) => page.id === pageId)
      if (index >= 0 && accessible.has(pageId)) {
        goToPage(index)
      }
    },
    [accessible, goToPage, pages]
  )

  if (!currentPage) {
    return null
  }

  const pageState = pageStates[currentPage.id]
  const questionnaireIds = collectQuestionnaireIds(currentPage.content)
  const pageComplete = areQuestionnairesSubmitted(
    questionnaireIds,
    pageState?.submittedQuestionnaires ?? []
  )
  const hasNext = currentIndex < pages.length - 1
  const hasPrevious = currentIndex > 0

  return (
    <>
      {hasPrevious ? <PreviousControl onClick={() => goToPage(currentIndex - 1)} /> : null}

      <PageScene
        key={currentPage.id}
        page={currentPage}
        index={currentIndex}
        pathPages={pages}
        pageStates={pageStates}
        onNavigatePathPage={navigateToPageId}
        pageState={pageState}
        onAnswer={onAnswer}
        onQuestionnaireSubmitted={onQuestionnaireSubmitted}
        onVideoPosition={onVideoPosition}
      />

      <PageSeenReporter pageId={currentPage.id} onPageSeen={onPageSeen} />

      <PageCompletionReporter
        pageId={currentPage.id}
        complete={pageComplete}
        onPageCompleted={onPageCompleted}
      />

      {hasNext && pageComplete ? <NextControl onClick={() => goToPage(currentIndex + 1)} /> : null}
    </>
  )
}

/**
 * Reports the displayed page exactly once per display, storing it as the current
 * location and marking it visited. The ref guard keeps StrictMode's doubled
 * effects from writing the same page twice, while a genuine transition changes
 * the id and reports again.
 */
function PageSeenReporter({
  pageId,
  onPageSeen
}: {
  pageId: string
  onPageSeen: (id: string) => void
}) {
  const reportedRef = useRef<string | null>(null)

  useEffect(() => {
    if (reportedRef.current === pageId) {
      return
    }
    reportedRef.current = pageId
    onPageSeen(pageId)
  }, [pageId, onPageSeen])

  return null
}

/** Reports a page completion exactly once, guarding StrictMode's doubled effects. */
function PageCompletionReporter({
  pageId,
  complete,
  onPageCompleted
}: {
  pageId: string
  complete: boolean
  onPageCompleted: (id: string) => void
}) {
  const reportedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!complete || reportedRef.current === pageId) {
      return
    }
    reportedRef.current = pageId
    onPageCompleted(pageId)
  }, [complete, pageId, onPageCompleted])

  return null
}

interface PageSceneProps {
  page: PageNode
  index: number
  /** Root pages, so a Path on this page can resolve its references. */
  pathPages: readonly PageNode[]
  /** Persisted state per root page id, for Path visited status. */
  pageStates: Record<string, PlayerPageState>
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
  pageState?: PlayerPageState
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void
  onVideoPosition?: (pageId: string, videoId: string, seconds: number) => void
}

/** The single displayed slide, full-height so it fills the viewport. */
function PageScene({
  page,
  index,
  pathPages,
  pageStates,
  onNavigatePathPage,
  pageState,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition
}: PageSceneProps) {
  return (
    <div
      data-scene-index={index}
      aria-label={page.metadata.title}
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-18"
    >
      <section className="prose prose-stone max-w-none! dark:prose-invert">
        <ContentRenderer
          nodes={page.content}
          pathPages={pathPages}
          pageStates={pageStates}
          onNavigatePathPage={onNavigatePathPage}
          answers={pageState?.answers}
          submittedQuestionnaires={pageState?.submittedQuestionnaires}
          onAnswer={(questionId, value) => onAnswer(page.id, questionId, value)}
          onQuestionnaireSubmitted={(id) => onQuestionnaireSubmitted(page.id, id)}
          videoPositions={pageState?.videos}
          onVideoPosition={(videoId, seconds) => onVideoPosition?.(page.id, videoId, seconds)}
        />
      </section>
    </div>
  )
}

/** Floating control that returns to the previous page. */
function PreviousControl({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-slides-previous
      className="pointer-events-none fixed inset-x-0 top-0 z-10 flex justify-center bg-background/5 py-2.5 backdrop-blur-sm"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full"
      >
        <ArrowUp aria-hidden="true" />
        <FormattedMessage id="slides.previousPage" />
      </Button>
    </div>
  )
}

/** Floating control that advances to the next page once the current one is complete. */
function NextControl({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-slides-next
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center bg-background/5 py-2.5 backdrop-blur-sm"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full px-4"
      >
        <FormattedMessage id="slides.continueNextPage" />
        <ArrowDown aria-hidden="true" />
      </Button>
    </div>
  )
}
