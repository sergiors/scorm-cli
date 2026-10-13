import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { Lock } from 'lucide-react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import type { AnswerValue, ContentNode, PageNode, PlayerPageState } from '../types'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  getSequentialAccess
} from '../lib/content-helpers'
import { useContentLoader, type ContentProvider, type ContentLoader } from '../lib/content-loader'
import { cn } from '../lib/utils'
import { ContentRenderer } from './ContentRenderer'
import { ContentLoadError } from './ContentLoadError'
import { Skeleton } from './ui/skeleton'

/**
 * A page's end boundary counts as reached once its end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so it fires just
 * before the very bottom. The viewport is the document, which is also the
 * Virtuoso scroller in window-scroll mode, so a non-negative margin keeps the
 * signal reachable at the maximum scroll offset, including for pages no taller
 * than the viewport.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * The shared frame of every page slot: a minimum of one small viewport
 * (`min-h-svh`, never a dynamic one) with a consistent, responsive width and
 * horizontal content padding. Real content, its skeleton and its error state all
 * use it, so swapping a skeleton for real content never changes the page's
 * minimum size; a longer page still simply grows.
 *
 * It carries no vertical padding, margin, gap or scroll class, so consecutive
 * page wrappers meet directly with no artificial spacing between them; the
 * responsive horizontal padding keeps the content off the viewport edges.
 */
const PAGE_FRAME = 'mx-auto w-full max-w-3xl min-h-svh px-4'

/**
 * The responsive vertical padding of a page's *content*, applied inside the
 * shared frame rather than to the wrapper it lives in. Keeping it off the
 * wrapper lets consecutive page wrappers meet directly with no artificial gap,
 * while the authored content still reads with intentional breathing room from
 * the page's top and bottom edges on every viewport. Real content, its skeleton
 * and its error state all use it, so swapping one for another never changes the
 * page's internal spacing either.
 */
const PAGE_CONTENT_PADDING = 'py-8 sm:py-12'

/**
 * The height, in pixels, Virtuoso assumes for a page it has not measured yet,
 * so it can lay out and position the list before any content exists. Every page
 * reserves at least one small viewport, so the viewport height is a close lower
 * bound and a good estimate for the initial (skeleton) slot.
 */
function defaultPageHeight(): number {
  return typeof window === 'undefined' ? 800 : window.innerHeight
}

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

export interface ScrollPresentationProps {
  pages: PageNode[]
  /**
   * The single runtime source of each page's authored content. Every page is an
   * independent lazily loaded module; a page is requested only once Virtuoso
   * mounts its slot, and a locked page's module is never fetched.
   */
  contentProvider: ContentProvider
  /** Persisted state per page id, for restored answers and submitted state. */
  pageStates: Record<string, PlayerPageState>
  /** Invoked once per page the learner reaches, storing it as the location. */
  onPageSeen: (id: string) => void
  /**
   * Invoked once when a page is complete: its end boundary was reached and every
   * questionnaire it contains has been submitted. Completion unlocks the next
   * page in the shared sequential progression.
   */
  onPageCompleted: (id: string) => void
  /** Persists a question answer for a page. */
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void
  /** Marks a questionnaire on a page as submitted. */
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void
  /** Persists a video's semantic playback position in seconds, scoped to the page. */
  onVideoPosition?: (pageId: string, videoId: string, seconds: number) => void
}

/**
 * The reading presentation: a single native document scroller owned by React
 * Virtuoso, which exclusively handles virtualization, dynamic page geometry,
 * positioning and mounting.
 *
 * The list is the contiguous run of *accessible* pages, in order — a locked
 * future page is not a list item at all, so it can never be mounted, imported or
 * prefetched. A page's module is requested only when Virtuoso mounts its slot,
 * so lazily loaded content is fetched exactly when the virtualizer needs it.
 * The document (window) is the only scroller; Virtuoso uses it directly
 * (`useWindowScroll`), so there is no inner viewport and no second geometry
 * system.
 *
 * The semantic current page is the top edge page: the first page the virtualizer
 * reports as visible. Virtuoso changes only when the learner scrolls, and a
 * change only updates the location and marks the page visited — it never
 * repositions the list, so state updates can never feed back into scrolling.
 * Explicit navigation (a Path jump) goes straight through `scrollToIndex`, with
 * no mounted DOM required.
 *
 * Every reload starts at the first page, at the top of the document: the list is
 * always initialised at item zero and no saved location positions it, so a
 * refresh never reopens a deep page. Restored answers, submissions and progress
 * are unaffected — only the reading position restarts.
 */
export function ScrollPresentation({
  pages,
  contentProvider,
  pageStates,
  onPageSeen,
  onPageCompleted,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition
}: ScrollPresentationProps) {
  const ids = pages.map((page) => page.id)
  const { accessible } = getSequentialAccess(
    ids,
    donePageIds(pages, pageStates),
    reachedPageIds(pages, pageStates)
  )

  // The contiguous accessible run, in document order. The shared policy unlocks
  // a prefix, so filtering the ordered pages keeps list positions aligned with
  // the pages the learner can actually reach.
  const accessiblePages = pages.filter((page) => accessible.has(page.id))

  const loader = useContentLoader(contentProvider)
  const { isLoaded } = loader

  // The list always opens at its first accessible page. No saved location is
  // read or passed to Virtuoso, so a reload restarts at page zero / the top of
  // the document instead of resuming a prior reading position.
  const [activeId, setActiveId] = useState(() => accessiblePages[0]?.id ?? '')

  // The synchronous mirror of `activeId`, so a range update can no-op on an
  // unchanged page without closing over stale state.
  const activeIdRef = useRef(activeId)
  function setActive(pageId: string) {
    if (activeIdRef.current === pageId) {
      return
    }
    activeIdRef.current = pageId
    setActiveId(pageId)
  }

  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // A Path jumps to a referenced page. The reference only resolves when the
  // shared policy reports the page as accessible; a locked page is ignored. The
  // jump is an immediate `scrollToIndex` on the virtualizer, so it needs no
  // mounted scene, no animation and no smoothing — the list is simply placed at
  // the target's start. Virtuoso mounts (and therefore requests) the page as it
  // scrolls there.
  function navigateToPageId(pageId: string) {
    const position = accessiblePages.findIndex((page) => page.id === pageId)
    if (position < 0) {
      return
    }
    virtuosoRef.current?.scrollToIndex({ index: position, align: 'start', behavior: 'auto' })
  }

  // The semantic current page is the top edge page: the first page Virtuoso
  // reports as visible. Its rendered range excludes overscan, so a change is
  // driven only by where the viewport actually is; it updates the location and
  // never repositions the list.
  function handleRangeChanged(range: ListRange) {
    const page = accessiblePages[range.startIndex]
    if (page !== undefined) {
      setActive(page.id)
    }
  }

  // The frozen estimate Virtuoso uses before a page is measured, so it can
  // compute the initial position (and the total height) without probing — and
  // therefore without rendering — a page the learner has not reached.
  const [estimatedPageHeight] = useState(defaultPageHeight)

  if (pages.length === 0 || accessiblePages.length === 0) {
    return null
  }

  // The frontier of the sequential progression: the last page the learner can
  // currently reach. When its end is reached but the page after it is still
  // locked, the boundary notice belongs at the bottom of *that* page and
  // disappears the moment completion unlocks the next.
  const finalAccessibleIndex = accessiblePages.length - 1
  const nextAfterFinalLocked =
    finalAccessibleIndex + 1 < pages.length && !accessible.has(pages[finalAccessibleIndex + 1]!.id)

  return (
    <>
      <Virtuoso
        ref={virtuosoRef}
        useWindowScroll
        totalCount={accessiblePages.length}
        initialTopMostItemIndex={0}
        // Only a server-rendered shell (the app renders client-side) needs a
        // forced initial item; on the client Virtuoso opens at item zero without
        // it, so a reload always starts at the first page.
        initialItemCount={typeof window === 'undefined' ? 1 : undefined}
        defaultItemHeight={estimatedPageHeight}
        // Render exactly the visible window, so `rangeChanged` reports the pages
        // the viewport actually shows rather than a pre-rendered overscan band.
        overscan={0}
        computeItemKey={(index) => accessiblePages[index]?.id ?? index}
        rangeChanged={handleRangeChanged}
        itemContent={(index) => {
          const page = accessiblePages[index]
          if (page === undefined) {
            return null
          }
          return (
            <PageSlot
              page={page}
              index={index}
              contentLoader={loader}
              active={page.id === activeId}
              pathPages={pages}
              pageStates={pageStates}
              onNavigatePathPage={navigateToPageId}
              pageState={pageStates[page.id]}
              onAnswer={onAnswer}
              onQuestionnaireSubmitted={onQuestionnaireSubmitted}
              onVideoPosition={onVideoPosition}
              onPageCompleted={onPageCompleted}
              showLockedBoundary={index === finalAccessibleIndex && nextAfterFinalLocked}
            />
          )
        }}
      />

      {/*
        The location only moves once the active page's content exists, so a page
        whose module is still resolving is never reported as seen — and the saved
        location is not transiently changed.
      */}
      <PageSeenReporter pageId={isLoaded(activeId) ? activeId : ''} onPageSeen={onPageSeen} />
    </>
  )
}

/**
 * Stores the active page as the current location and marks it visited, once per
 * activation. The ref holds the *last reported* id, not a set of every id ever
 * seen, so a genuine change reports again — including revisiting A after B, which
 * moves the location back to A — while StrictMode's doubled effect for the same
 * id is a no-op.
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
    if (!pageId || reportedRef.current === pageId) {
      return
    }
    reportedRef.current = pageId
    onPageSeen(pageId)
  }, [pageId, onPageSeen])

  return null
}

/**
 * Reports a page completion exactly once. The ref guard keeps repeated observer
 * callbacks and StrictMode's doubled effects from reporting the same page more
 * than once.
 */
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

interface PageSlotProps {
  page: PageNode
  /** The page's position in the accessible run (its Virtuoso item index). */
  index: number
  /** The shared content loader, for this page's content and load lifecycle. */
  contentLoader: ContentLoader
  /** Whether this page is under the reading anchor. */
  active: boolean
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
  /** Reports the page completion exactly once. */
  onPageCompleted: (id: string) => void
  /**
   * Whether the page after this one is still locked, so the generic "complete
   * this page to continue" boundary belongs at the bottom of this page once its
   * end is reached.
   */
  showLockedBoundary: boolean
}

/**
 * One mounted page in the virtualized document. Mounting is what requests the
 * page's module, so content is loaded exactly when Virtuoso needs the page and
 * never for a page outside the rendered window. A page whose module is still
 * resolving renders a stable, viewport-tall skeleton slot; a failed load renders
 * a small retry affordance.
 */
function PageSlot({
  page,
  index,
  contentLoader,
  active,
  pathPages,
  pageStates,
  onNavigatePathPage,
  pageState,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition,
  onPageCompleted,
  showLockedBoundary
}: PageSlotProps) {
  const { request, retry } = contentLoader

  useEffect(() => {
    request(page.id)
  }, [page.id, request])

  if (!contentLoader.isLoaded(page.id)) {
    return contentLoader.hasError(page.id) ? (
      <PageLoadError index={index} onRetry={() => retry(page.id)} />
    ) : (
      <PageSkeleton index={index} />
    )
  }

  return (
    <PageScene
      page={page}
      index={index}
      nodes={contentLoader.content(page.id) ?? []}
      active={active}
      pathPages={pathPages}
      pageStates={pageStates}
      onNavigatePathPage={onNavigatePathPage}
      pageState={pageState}
      onAnswer={onAnswer}
      onQuestionnaireSubmitted={onQuestionnaireSubmitted}
      onVideoPosition={onVideoPosition}
      onPageCompleted={onPageCompleted}
      showLockedBoundary={showLockedBoundary}
    />
  )
}

/**
 * The stable slot for an accessible page whose module is still loading. It uses
 * the same frame as the page it replaces — viewport-tall, same width — and the
 * same inner content padding, so swapping in the real content does not animate
 * height or shift its spacing. Its shadcn skeletons are static (no pulse), so
 * the presentation has no motion of its own.
 */
function PageSkeleton({ index }: { index: number }) {
  return (
    <div
      data-scene-index={index}
      data-scroll-page={index}
      data-scroll-loading
      aria-hidden="true"
      className={PAGE_FRAME}
    >
      <div className={cn(PAGE_CONTENT_PADDING, 'space-y-4')}>
        <Skeleton className="h-8 w-2/3 animate-none" />
        <Skeleton className="h-4 w-full animate-none" />
        <Skeleton className="h-4 w-5/6 animate-none" />
        <Skeleton className="h-4 w-4/6 animate-none" />
      </div>
    </div>
  )
}

/**
 * A page whose module failed to load. It keeps the shared page frame — and the
 * same inner content padding as real content — so the document layout is
 * unchanged, and offers a single retry action rather than hiding the failure.
 */
function PageLoadError({ index, onRetry }: { index: number; onRetry: () => void }) {
  return (
    <div data-scene-index={index} data-scroll-page={index} data-scroll-error className={PAGE_FRAME}>
      <div className={cn(PAGE_CONTENT_PADDING, 'flex flex-col items-start gap-3')}>
        <ContentLoadError onRetry={onRetry} />
      </div>
    </div>
  )
}

interface PageSceneProps {
  page: PageNode
  index: number
  /** The page's resolved content nodes (lazily loaded, or inline). */
  nodes: ContentNode[]
  /**
   * Whether this is the page under the reading anchor. It marks the scene so the
   * current page is observable; it never affects whether the content is present
   * or its geometry.
   */
  active: boolean
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
  /** Reports the page completion exactly once. */
  onPageCompleted: (id: string) => void
  /**
   * Whether the page after this one is still locked, so the generic "complete
   * this page to continue" boundary belongs at the bottom of this page once its
   * end is reached.
   */
  showLockedBoundary: boolean
}

/**
 * One page in the virtualized document. It keeps its natural content height — a
 * minimum of one small viewport (`min-h-svh`) with no forced fixed height and no
 * vertical centering — so a page shorter than the viewport still fills it while
 * any longer page simply grows. The wrapper itself carries no vertical spacing;
 * the content inside it takes the shared responsive padding instead. Virtuoso
 * measures the rendered height and owns the surrounding geometry.
 *
 * A page's end sentinel reports when its end is reached, and the page completes
 * once that end was reached *and* every questionnaire it contains was submitted.
 * The completion state is local to the page, so the presentation holds no
 * cross-page observer state and a page never has to be re-measured.
 */
function PageScene({
  page,
  index,
  nodes,
  active,
  pathPages,
  pageStates,
  onNavigatePathPage,
  pageState,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition,
  onPageCompleted,
  showLockedBoundary
}: PageSceneProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const [endReached, setEndReached] = useState(false)

  useEffect(() => {
    const element = endRef.current
    if (element === null || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (last !== undefined) {
          setEndReached(last.isIntersecting)
        }
      },
      // In window-scroll mode the document (the Virtuoso scroller) is the root,
      // so `null` observes against the same viewport the virtualizer uses.
      { root: null, rootMargin: PAGE_END_MARGIN, threshold: 0 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const complete =
    endReached &&
    areQuestionnairesSubmitted(
      collectQuestionnaireIds(nodes),
      pageState?.submittedQuestionnaires ?? []
    )

  return (
    <div
      data-scene-index={index}
      data-scroll-page={index}
      data-active={active ? 'true' : 'false'}
      aria-label={page.metadata.title}
      className={PAGE_FRAME}
    >
      <div data-scroll-page-content className={PAGE_CONTENT_PADDING}>
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

      <div ref={endRef} data-scroll-end={index} aria-hidden="true" className="h-px w-full" />

      {showLockedBoundary && endReached && !complete ? <LockedBoundary /> : null}

      <PageCompletionReporter
        pageId={page.id}
        complete={complete}
        onPageCompleted={onPageCompleted}
      />
    </div>
  )
}

/**
 * Marks that the page after the current one remains locked, without mounting or
 * revealing any locked content. It sits at the bottom of the final accessible
 * page (see {@link PageScene}) and is a natural-height notice rather than a
 * viewport-tall panel, so it reads as the end of that page, not a separate
 * screen.
 */
function LockedBoundary() {
  return (
    <div
      data-scroll-locked
      className="flex items-center justify-center gap-2 pt-12 text-muted-foreground"
    >
      <Lock aria-hidden="true" className="size-5" />
      <p className="text-sm">
        <FormattedMessage id="scroll.locked" />
      </p>
    </div>
  )
}
