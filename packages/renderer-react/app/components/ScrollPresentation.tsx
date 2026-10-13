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
 *
 * The observed sentinel is purely a *completion* signal — the moment the learner
 * has read to the end of a page — never a positioning input. React Virtuoso
 * remains the sole owner of scroll position and geometry.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * The single shared column that frames the whole reading list: a consistent,
 * responsive width and horizontal content padding applied once around the
 * virtualizer instead of being repeated on every page slot. It carries no
 * overflow, height, vertical padding, centering, margin or gap, so it neither
 * introduces a second scroll container nor opens artificial space between
 * pages; the responsive horizontal padding just keeps content off the viewport
 * edges. The document stays the only scroller.
 *
 * Content, its loading indication and its error state all sit inside it, so
 * swapping one for another never changes the page's width or its spacing.
 */
const PAGE_COLUMN = 'mx-auto w-full max-w-3xl px-4 sm:px-6'

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
   * independent lazily loaded module; the page after the current one is requested
   * once the shared policy reports it accessible, and a locked page's module is
   * never fetched.
   */
  contentProvider: ContentProvider
  /** Persisted state per page id, for restored answers and submitted state. */
  pageStates: Record<string, PlayerPageState>
  /**
   * Page id named by the saved lesson location (`PlayerState.location`), so a
   * refresh resumes on the bookmarked page instead of the first one. It is read
   * only once, to seed the initial reading position; it falls back to the first
   * accessible page when the id is absent, unknown, or still locked under the
   * shared progression policy.
   */
  initialPageId?: string
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
 * Every page keeps its *natural* content height — no minimum viewport, no
 * centering, no artificial spacing — so the document is exactly as tall as the
 * authored content and Virtuoso measures each page as it renders. The whole
 * reading list is framed once by a single shared column — one responsive max
 * width and horizontal padding around the virtualizer, never repeated on a page
 * slot — and that column adds no overflow, height or vertical padding, so it
 * never becomes a second scroll container. The list holds exactly the
 * *accessible* pages, in document order, with locked pages simply absent: a
 * locked future page is not a list item at all, so it can never be mounted,
 * imported or prefetched. The accessible set is not necessarily contiguous —
 * beyond the done prefix and the first not-done page, the shared policy also
 * keeps every previously reached (visited) page accessible — so the run may skip
 * a still-locked page that sits between two accessible ones.
 *
 * A page's module is requested one page ahead of the reading anchor — the page
 * after the current one, once the shared policy reports it accessible — and again
 * whenever Virtuoso mounts a slot, so a page the learner has not reached starts
 * resolving just before it is needed. A locked page is not in the accessible run,
 * so it can never be requested, and the tail beyond that next page is never
 * prefetched. The document (window) is the only scroller; Virtuoso uses it
 * directly (`useWindowScroll`), so there is no inner viewport and no second
 * geometry system.
 *
 * The semantic current page is the top edge page: the first page the virtualizer
 * reports as visible. Virtuoso changes only when the learner scrolls, and a
 * change only updates the location and marks the page visited — it never
 * repositions the list, so state updates can never feed back into scrolling.
 * Explicit navigation (a Path jump) first ensures the target's module is
 * resolving — a user-explicit load attempt that reattempts a page whose earlier
 * prefetch failed — then goes straight through `scrollToIndex`, with no mounted
 * DOM required and no animation; a newer jump supersedes an older one still
 * loading.
 * Because a jump target is an unmeasured page, Virtuoso owns where it lands: it
 * positions from its own size estimates and refines them as pages measure, with
 * no custom height compensation and no viewport-sized default (see the list
 * props below).
 *
 * A reload resumes the saved reading position. The runtime exposes the lesson
 * location as a sanitized `PlayerState.location` — SCORM 1.2 stores it in
 * `cmi.core.lesson_location`, SCORM 2004 in `cmi.location`, and the runtime
 * normalizes both into the same semantic id — and the presentation seeds its
 * initial position from it: the accessible page that id names, or the first
 * accessible page when it is absent, unknown, or still locked. The index is
 * computed once on first mount and handed straight to Virtuoso as its initial
 * item, so the list opens directly at that page with no scripted scroll. The
 * semantic current page is initialized to the same restored page, so the first
 * seen report matches it rather than transiently overwriting the saved location
 * with page zero. Restored answers, submissions and progress are unaffected.
 */
export function ScrollPresentation({
  pages,
  contentProvider,
  pageStates,
  initialPageId,
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

  // The accessible pages, in document order. The shared policy exposes the done
  // prefix plus the first not-done page, and also keeps any previously reached
  // (visited) page accessible, so the set can be non-contiguous; filtering the
  // ordered pages preserves their document order and keeps list positions
  // aligned with the pages the learner can actually reach.
  const accessiblePages = pages.filter((page) => accessible.has(page.id))

  const loader = useContentLoader(contentProvider)
  const { isLoaded, request, ensure } = loader

  // The accessible pages of the *current* render, so an asynchronous Path jump
  // resolves its target index against the latest list without closing over a
  // stale array.
  const accessiblePagesRef = useRef(accessiblePages)
  accessiblePagesRef.current = accessiblePages

  // The reading position the list opens at, computed once on first mount: the
  // accessible page named by the saved lesson location, or the first accessible
  // page when the location is absent, unknown, or still locked. It is captured
  // here — before `activeId` or any later location change — so it is a stable
  // constant handed to Virtuoso as the initial item, never re-derived from state
  // that the presentation itself writes. A later `PlayerState.location` change
  // (a scroll or a Path jump) therefore never repositions the list.
  const [initialIndex] = useState(() => {
    const index = accessiblePages.findIndex((page) => page.id === initialPageId)
    return index >= 0 ? index : 0
  })

  // The semantic current page starts at the restored item, so the first seen
  // report matches the restored location instead of transiently writing page
  // zero over it. It then follows the visible range exactly as before.
  const [activeId, setActiveId] = useState(() => accessiblePages[initialIndex]?.id ?? '')

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

  // The immediate next accessible page after the reading anchor. It is requested
  // ahead of time so it is already resolving before the learner reaches it — the
  // page a completion just unlocked, or, on a resumed session, the next already
  // accessible page. Only ever one page ahead: a locked page is never in the
  // accessible run, and the further tail is left to Virtuoso, which requests a
  // page's module when it actually mounts its slot. No scroll is issued here.
  const activeIndex = accessiblePages.findIndex((page) => page.id === activeId)
  const nextPage = activeIndex >= 0 ? accessiblePages[activeIndex + 1] : undefined
  const prefetchId = nextPage?.id ?? null
  useEffect(() => {
    if (prefetchId !== null) {
      request(prefetchId)
    }
  }, [prefetchId, request])

  // A Path jump to a referenced page. The reference only resolves when the
  // shared policy reports the page accessible; a locked page is ignored. The
  // target's module is ensured to be resolving first — a user-explicit load
  // attempt, issued here because the learner deliberately jumped, so it also
  // reattempts a page whose earlier prefetch failed instead of waiting for a
  // remount to retry it — then the jump is an immediate `scrollToIndex` on the
  // virtualizer, so it needs no mounted scene, no animation and no smoothing.
  // Virtuoso mounts the item on the next commit, so a freshly resolved module
  // may still show its small loading slot for a commit before the content is on
  // screen — the jump does not guarantee the content is already painted. A later
  // jump bumps the token, so a slower earlier target can never supersede a newer
  // one.
  const navigationRef = useRef(0)
  function navigateToPageId(pageId: string) {
    if (accessiblePagesRef.current.findIndex((page) => page.id === pageId) < 0) {
      return
    }
    const navigation = (navigationRef.current += 1)
    const scrollToTarget = () => {
      const index = accessiblePagesRef.current.findIndex((page) => page.id === pageId)
      if (index >= 0) {
        virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'auto' })
      }
    }

    if (isLoaded(pageId)) {
      scrollToTarget()
      return
    }

    // Move once the target settles. A failed load still moves to the target, so
    // its own error slot — with its retry action — is what the learner sees
    // rather than the reading failing silently; a superseded jump never moves.
    const settleJump = () => {
      if (navigationRef.current === navigation) {
        scrollToTarget()
      }
    }
    ensure(pageId).then(settleJump, settleJump)
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

  if (pages.length === 0 || accessiblePages.length === 0) {
    return null
  }

  // The frontier of the sequential progression: the last page the learner can
  // currently reach. When its end is reached but the page after it is still
  // locked, the boundary notice belongs at the bottom of *that* page and
  // disappears the moment completion unlocks the next.
  const finalAccessibleIndex = accessiblePages.length - 1
  // The frontier's position in the accessible run is not a `pages` index: the
  // run can skip a locked page, so the page that actually follows the frontier
  // is found in document order rather than at `finalAccessibleIndex + 1`.
  const finalAccessiblePage = accessiblePages[finalAccessibleIndex]!
  const finalPageIndex = pages.findIndex((page) => page.id === finalAccessiblePage.id)
  const nextAfterFinalLocked =
    finalPageIndex + 1 < pages.length && !accessible.has(pages[finalPageIndex + 1]!.id)

  return (
    <div data-scroll-column className={PAGE_COLUMN}>
      <Virtuoso
        ref={virtuosoRef}
        useWindowScroll
        totalCount={accessiblePages.length}
        // The list opens directly at the restored reading position — the
        // accessible page named by the saved lesson location, or item zero when
        // there is none — with no scripted scroll. The index is a stable
        // constant, so a later location change never repositions the list.
        initialTopMostItemIndex={initialIndex}
        // Only a server-rendered shell (the app renders client-side) needs a
        // forced initial item; on the client Virtuoso opens at the initial index.
        initialItemCount={typeof window === 'undefined' ? 1 : undefined}
        // Render exactly the visible window, so `rangeChanged` reports the pages
        // the viewport actually shows rather than a pre-rendered overscan band.
        // No `defaultItemHeight`, `heightEstimates` or `fixedItemHeight` is
        // given: pages keep their natural, measured heights and Virtuoso owns
        // geometry. Before a page is measured Virtuoso derives its own default
        // size by probing the first rendered page, then refines every position
        // as pages measure — so a deep Path jump may settle briefly, but it is
        // never positioned by a custom or viewport-sized height estimate.
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
    </div>
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
 * resolving renders a small, static loading slot; a failed load renders a small
 * retry affordance.
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
 * The slot for an accessible page whose module is still loading. It is a small,
 * static, natural-height indication rather than a viewport-tall panel: it never
 * reserves or fakes a page's size, so the document stays exactly as tall as the
 * content that actually exists. Its shadcn skeletons are static (no pulse), so
 * the presentation has no motion of its own; a visually hidden status keeps the
 * pending state available to assistive technology.
 */
function PageSkeleton({ index }: { index: number }) {
  return (
    <div data-scene-index={index} data-scroll-page={index} data-scroll-loading>
      <div role="status" className="space-y-3">
        <span className="sr-only">
          <FormattedMessage id="scroll.loading" />
        </span>
        <Skeleton className="h-7 w-2/3 animate-none" />
        <Skeleton className="h-4 w-full animate-none" />
        <Skeleton className="h-4 w-4/5 animate-none" />
      </div>
    </div>
  )
}

/**
 * A page whose module failed to load. It adds no size or spacing of its own
 * inside the shared column, so the document layout stays small and unchanged
 * and it offers a single retry action rather than hiding the failure.
 */
function PageLoadError({ index, onRetry }: { index: number; onRetry: () => void }) {
  return (
    <div data-scene-index={index} data-scroll-page={index} data-scroll-error>
      <div className="flex flex-col items-start gap-3">
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
 * One page in the virtualized document. It keeps its natural content height —
 * no minimum or fixed viewport, no vertical centering, no clipping and no
 * vertical padding — so a short page is exactly as tall as its content and a
 * long page simply grows, while consecutive pages meet with only their natural
 * typography spacing between them. Virtuoso measures the rendered height and
 * owns the surrounding geometry.
 *
 * A page's end sentinel reports when its end is reached, and the page completes
 * once that end was reached *and* every questionnaire it contains was submitted.
 * The observer is used only as a completion signal; it never positions the list
 * — Virtuoso alone owns scroll position. The completion state is local to the
 * page, so the presentation holds no cross-page observer state and a page never
 * has to be re-measured.
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
    >
      <div data-scroll-page-content>
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
      className="flex items-center justify-center gap-2 py-6 text-muted-foreground"
    >
      <Lock aria-hidden="true" className="size-5" />
      <p className="text-sm">
        <FormattedMessage id="scroll.locked" />
      </p>
    </div>
  )
}
