import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import type { AnswerValue, ContentNode, PageNode, PlayerPageState } from '../types'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  getSequentialAccess
} from '../lib/content-helpers'
import { useContentLoader, type ContentProvider } from '../lib/content-loader'
import { clampPageIndex } from '../lib/sequence'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { ContentLoadError } from './ContentLoadError'
import { ContentRenderer } from './ContentRenderer'

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
   * The single runtime source of each page's authored content. Only the current
   * page's module is loaded, plus the next page's once it is accessible — a
   * locked page's module is never requested.
   */
  contentProvider: ContentProvider
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
 * Shows exactly one page at a time, in order. Only the current page's content
 * is loaded and rendered, so neighbouring pages are never exposed. Advancing is
 * gated by the shared sequential progression policy: the next control appears
 * only once the active page is complete — every questionnaire on it submitted —
 * and stepping back is always available while a previous page exists. A Path can
 * only jump to a page the policy reports as accessible.
 *
 * The current page's module is loaded on display; while it resolves a stable,
 * full-height skeleton stands in, so the slide never flashes an empty or wrong
 * page. The next page's module is preloaded only once the progression reports it
 * accessible, and a locked page's module is never requested. The page is stored
 * as the location and reported complete only after its content exists, so a
 * navigation never transiently moves the location to a page that is not yet
 * shown.
 */
export function SlidesPresentation({
  pages,
  contentProvider,
  initialIndex = 0,
  pageStates,
  onPageSeen,
  onPageCompleted,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition
}: SlidesPresentationProps) {
  const ids = pages.map((page) => page.id)
  const { accessible } = getSequentialAccess(ids, donePageIds(pages, pageStates))
  const { content, isLoaded, hasError, request, retry } = useContentLoader(contentProvider)

  const [currentIndex, setCurrentIndex] = useState(() => {
    const requested = clampPageIndex(initialIndex, pages.length)
    const requestedId = pages[requested]?.id
    return requestedId !== undefined && accessible.has(requestedId) ? requested : 0
  })

  const currentPage = pages[currentIndex]

  // The next page's id once the shared progression reports it accessible, so the
  // prefetch below can depend on a stable primitive instead of the access set.
  const nextPage = pages[currentIndex + 1]
  const prefetchId = nextPage !== undefined && accessible.has(nextPage.id) ? nextPage.id : null

  // Load the current page, and preload the next one only when it is accessible.
  // A locked page never reaches `request`, so its module is never fetched.
  useEffect(() => {
    if (currentPage !== undefined) {
      request(currentPage.id)
    }
    if (prefetchId !== null) {
      request(prefetchId)
    }
  }, [currentPage?.id, prefetchId, request])

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

  const loaded = isLoaded(currentPage.id)
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

      {!loaded ? (
        hasError(currentPage.id) ? (
          <SlideLoadError onRetry={() => retry(currentPage.id)} />
        ) : (
          <SlideSkeleton />
        )
      ) : (
        <PageScene
          key={currentPage.id}
          page={currentPage}
          index={currentIndex}
          nodes={content(currentPage.id) ?? []}
          pathPages={pages}
          pageStates={pageStates}
          onNavigatePathPage={navigateToPageId}
          pageState={pageState}
          onAnswer={onAnswer}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
          onVideoPosition={onVideoPosition}
        />
      )}

      {/*
        The displayed page is only stored as the location (and reported complete)
        once its content exists, so a slide whose module is still resolving is
        never shown as seen and the location never lands on an unseen page.
      */}
      {loaded ? (
        <>
          <PageSeenReporter pageId={currentPage.id} onPageSeen={onPageSeen} />
          <PageCompletionReporter
            pageId={currentPage.id}
            complete={pageComplete}
            onPageCompleted={onPageCompleted}
          />
        </>
      ) : null}

      {hasNext && pageComplete && loaded ? (
        <NextControl onClick={() => goToPage(currentIndex + 1)} />
      ) : null}
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
  /** The slide's resolved content nodes (lazily loaded). */
  nodes: ContentNode[]
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
  nodes,
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
          nodes={nodes}
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

/**
 * The stable slot shown while the current slide's module resolves. It mirrors
 * the slide's full-height, centred layout so swapping in the real page does not
 * shift anything, and is inert (`aria-hidden`) so assistive technology never
 * announces the placeholder.
 */
function SlideSkeleton() {
  return (
    <div
      data-slide-loading
      aria-hidden="true"
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-18"
    >
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  )
}

/**
 * The current slide whose module failed to load. It keeps the slide's
 * full-height layout and offers a single retry action rather than silently
 * showing an empty slide.
 */
function SlideLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-slide-error
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-start justify-center gap-3 px-6 py-18"
    >
      <ContentLoadError onRetry={onRetry} />
    </div>
  )
}

/** Floating control that returns to the previous page. */
function PreviousControl({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-slides-previous
      className="pointer-events-none fixed inset-y-0 left-0 z-10 flex items-center bg-foreground/5 px-2.5 backdrop-blur-sm"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
    </div>
  )
}

/** Floating control that advances to the next page once the current one is complete. */
function NextControl({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-slides-next
      className="pointer-events-none fixed inset-y-0 right-0 z-10 flex items-center bg-foreground/5 px-2.5 backdrop-blur-sm"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}
