import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { FormattedMessage } from 'react-intl'
import { Lock } from 'lucide-react'
import type { AnswerValue, ContentNode, PageNode, PlayerPageState } from '../types'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  getSequentialAccess
} from '../lib/content-helpers'
import { useContentLoader, type ContentProvider } from '../lib/content-loader'
import { clampPageIndex } from '../lib/sequence'
import { cn } from '../lib/utils'
import { ContentRenderer } from './ContentRenderer'
import { ContentLoadError } from './ContentLoadError'
import { Skeleton } from './ui/skeleton'

/**
 * The reading anchor, as a fraction of the viewport height: the top edge of the
 * viewport. The current page is the one whose rendered region spans that line —
 * the page occupying the top of the screen.
 *
 * A single point can only ever be inside one stacked region, so activation is
 * unique at any instant and needs neither a visibility ratio nor a boundary
 * deadband: nudging across a shared boundary resolves deterministically to the
 * page the line actually sits in. Anchoring at the very top also keeps the
 * initial restore self-consistent — a saved page is positioned with its own top
 * at the viewport top, so however short it is the anchor is inside it, and a
 * resume never hands the saved location to a neighbour before the learner
 * scrolls.
 */
const PAGE_ANCHOR_RATIO = 0

/**
 * A page's end boundary counts as reached once its end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so it fires just
 * before the very bottom. A non-negative margin keeps the signal reachable at
 * the maximum scroll offset, including for pages no taller than the viewport.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * How many accessible pages before the current one are kept loaded around the
 * reading position. Restoring a deep location only loads this small backward
 * context plus the current page, never the whole accessible prefix; older
 * accessible pages are backfilled one at a time as the learner scrolls back
 * towards them and stay loaded once reached.
 */
const BACK_CONTEXT = 2

/**
 * How many accessible pages after the current one are loaded, so a completion
 * that unlocks the next page immediately has its module loading behind the
 * skeleton slot below the current page.
 */
const FORWARD_CONTEXT = 1

/**
 * The shared frame of every page slot: a minimum of one small viewport
 * (`min-h-svh`, never a dynamic one), top-aligned with natural block padding and
 * a consistent responsive width. Real content, its skeleton and its error state
 * all use it, so swapping a skeleton for real content never changes the page's
 * size.
 */
const PAGE_FRAME = 'mx-auto w-full max-w-3xl min-h-svh px-4 py-12'

/**
 * Whether the learner has asked the platform to reduce motion. A deliberate Path
 * jump honours it by scrolling instantly (`behavior: 'auto'`) instead of
 * animating; the initial restore is always instant regardless of the preference,
 * so a resume never animates in from the top. Guarded for a host without
 * `matchMedia` — SSR and jsdom — so the check is inert rather than throwing.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
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
   * independent lazily loaded module; a page is requested only once it is
   * accessible, and a locked page's module is never fetched.
   */
  contentProvider: ContentProvider
  /**
   * Page that should be active on first mount, so a saved lesson location can
   * resume at the bookmarked page. Clamped to an accessible page.
   */
  initialIndex?: number
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
 * An append-only document of pages, scrolled natively with no inner viewport,
 * no virtualization, no spacers and no snap. Only accessible pages are ever
 * mounted; a locked future page is never imported, rendered or prefetched. Every
 * accessible page the learner has reached stays in the document for the rest of
 * the session, so the browser owns the scroll and pages grow naturally.
 *
 * The current page is the one under a fixed viewport anchor (see
 * {@link PAGE_ANCHOR_RATIO}), resolved from page geometry on the document's
 * `scroll` event. Changing the current page only updates the location and marks
 * the page visited — it never unloads or recycles a mounted page.
 *
 * Each page keeps its authored content in an independent Vite/Rollup chunk that
 * is imported only once the page becomes accessible. A page whose module is still
 * resolving renders a stable, viewport-tall skeleton slot; a failed load renders
 * a small retry affordance. Only a small window around the reading position loads
 * initially, so restoring a deep saved location does not load the whole preceding
 * prefix; older accessible pages are backfilled as the learner scrolls back and
 * load once. While the restored page's module — and the small backward context
 * whose committed height sits above it — resolves, the document shows a minimal
 * startup skeleton and no page is mounted, reported or detected, so a late
 * skeleton-to-content swap above the saved page can never move the saved
 * location.
 */
export function ScrollPresentation({
  pages,
  contentProvider,
  initialIndex = 0,
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
  const accessibleIndices = pages
    .map((_, index) => index)
    .filter((index) => accessible.has(pages[index]!.id))
  const accessibleSignature = accessibleIndices.join(',')

  const { content, isLoaded, hasError, request, retry } = useContentLoader(contentProvider)

  const [activeId, setActiveId] = useState(() => {
    const requested = clampPageIndex(initialIndex, pages.length)
    const requestedId = pages[requested]?.id
    if (requestedId !== undefined && accessible.has(requestedId)) {
      return requestedId
    }
    return accessibleIndices[0] !== undefined ? pages[accessibleIndices[0]]!.id : ''
  })

  // The synchronous mirror of `activeId`, so detection's `setActive` can no-op
  // on an unchanged page without closing over stale state.
  const activeIdRef = useRef(activeId)
  const setActive = useCallback((pageId: string) => {
    if (activeIdRef.current === pageId) {
      return
    }
    activeIdRef.current = pageId
    setActiveId(pageId)
  }, [])

  // The monotonic set of pages the presentation has asked for. It only ever
  // grows: a page requested for the reading window, a backfill or a Path jump
  // stays in the document for the whole session, which is what makes it
  // append-only. A page is rendered while it is requested — its module is
  // resolving behind a skeleton — or the moment its content is available, so a
  // skeleton never flashes back to empty as the loader settles.
  const [requestedIds, setRequestedIds] = useState<ReadonlySet<string>>(() => new Set())
  const ensureRequested = useCallback(
    (pageIds: readonly string[]) => {
      setRequestedIds((previous) => {
        let next: Set<string> | null = null
        for (const pageId of pageIds) {
          if (!previous.has(pageId)) {
            next ??= new Set(previous)
            next.add(pageId)
          }
        }
        return next ?? previous
      })
      for (const pageId of pageIds) {
        request(pageId)
      }
    },
    [request]
  )

  // The reading window: the current accessible page plus a small backward
  // context and one page ahead. It is recomputed as the learner moves, but only
  // ever requests — a page outside the window stays loaded, and a locked page is
  // never requested because the window walks accessible positions directly.
  useEffect(() => {
    const list = accessibleSignature === '' ? [] : accessibleSignature.split(',').map(Number)
    const activeIndex = pages.findIndex((page) => page.id === activeId)
    const position = list.indexOf(activeIndex)
    if (position < 0) {
      return
    }
    const first = Math.max(0, position - BACK_CONTEXT)
    const last = Math.min(list.length - 1, position + FORWARD_CONTEXT)
    const wanted: string[] = []
    for (let cursor = first; cursor <= last; cursor += 1) {
      const page = pages[list[cursor]!]
      if (page !== undefined) {
        wanted.push(page.id)
      }
    }
    ensureRequested(wanted)
  }, [activeId, accessibleSignature, ensureRequested, pages])

  // The page the session restored to, captured once. The startup gate waits on
  // this page and its explicit initial backward context, so a refresh resumes on
  // the saved page with everything above it already committed.
  const restoredIdRef = useRef(activeId)
  const restoredId = restoredIdRef.current

  // The small backward context the restore commits before it positions: the
  // accessible pages immediately preceding the saved one. Their skeleton→natural
  // height swaps sit *above* the saved page, so resolving one after positioning
  // would shift the saved page on an engine without scroll anchoring (Safari,
  // some LMS webviews) and regress the stored location. The startup therefore
  // waits for exactly this window — never the whole accessible prefix, which is
  // still backfilled lazily as the learner scrolls back.
  const restoredIndex = pages.findIndex((page) => page.id === restoredId)
  const restoredPosition = restoredIndex < 0 ? -1 : accessibleIndices.indexOf(restoredIndex)
  const backwardContextIds =
    restoredPosition < 0
      ? []
      : accessibleIndices
          .slice(Math.max(0, restoredPosition - BACK_CONTEXT), restoredPosition)
          .map((index) => pages[index]!.id)

  // The restored page must hold real content, and every backward-context module
  // must have settled first — loaded, or failed into a stable, viewport-tall
  // error frame that keeps its retry affordance reachable in place. Only then is
  // the document rendered, positioned once and ordinary detection enabled, so no
  // late swap above the saved page can move the location from under the learner.
  const ready =
    isLoaded(restoredId) &&
    backwardContextIds.every((id) => isLoaded(id) || hasError(id))

  // Detection is off until the restored page's content and its backward context
  // exist and the instant positioning has run, so a refresh can never
  // transiently report page zero, read the restore's own scroll echo as the
  // learner scrolling, or absorb a late height swap above the saved page.
  const restoreRef = useRef<HTMLDivElement>(null)
  const [restored, setRestored] = useState(false)

  // Reads the rendered page regions and moves the current page to the one under
  // the anchor. It runs on `scroll` and `resize`; a change is only ever driven by
  // where the viewport actually is. Returns whether any page region was readable,
  // so a host with no layout (SSR, jsdom) can fall back to the intended target.
  const rootRef = useRef<HTMLDivElement>(null)
  const detect = useCallback((): boolean => {
    const root = rootRef.current
    if (root === null) {
      return false
    }
    const anchor = window.innerHeight * PAGE_ANCHOR_RATIO
    for (const element of root.querySelectorAll<HTMLElement>('[data-scroll-page]')) {
      const rect = element.getBoundingClientRect()
      if (rect.top <= anchor && anchor < rect.bottom) {
        const page = pages[Number(element.getAttribute('data-scroll-page'))]
        if (page !== undefined) {
          setActive(page.id)
          return true
        }
      }
    }
    return false
  }, [pages, setActive])

  // Ordinary detection is only wired up once the restore has been positioned. No
  // detection runs on mount: the restored location already stands, and the only
  // thing a mount-time measurement could do is read geometry the restore's own
  // scroll has not settled yet.
  useEffect(() => {
    if (typeof window === 'undefined' || !restored) {
      return
    }
    window.addEventListener('scroll', detect, { passive: true })
    window.addEventListener('resize', detect)
    return () => {
      window.removeEventListener('scroll', detect)
      window.removeEventListener('resize', detect)
    }
  }, [detect, restored])

  // Resume at the restored page once, so a saved location opens where it was. It
  // waits for `ready` — the restored page plus its backward context committed —
  // so it positions a page whose neighbours above are already real, with nothing
  // left to grow into the restored position. The restore is deliberately instant
  // (`behavior: 'auto'`): a resumed lesson should already be where it left off,
  // not animate a long smooth scroll in from the top. It runs before ordinary
  // detection is attached, and because the restored page ends up top-aligned
  // under the anchor, the restore's own scroll echo resolves back to it rather
  // than to a neighbour.
  useLayoutEffect(() => {
    if (!ready || restored) {
      return
    }
    const element = restoreRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
    setRestored(true)
  }, [ready, restored])

  // A Path jumps to a referenced page. The reference only resolves when the
  // shared policy reports the page as accessible; a locked page is ignored. Its
  // module is requested (its skeleton mounts while it loads) and the scene is
  // scrolled only once real content exists, so the jump lands on the page itself
  // rather than on a skeleton. The semantic current page is never set ahead of
  // the physical scroll.
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null)
  const navigateToPageId = useCallback(
    (pageId: string) => {
      const index = pages.findIndex((page) => page.id === pageId)
      if (index < 0 || !accessible.has(pageId)) {
        return
      }
      ensureRequested([pageId])
      setPendingTargetId(pageId)
    },
    [accessible, ensureRequested, pages]
  )

  useLayoutEffect(() => {
    if (pendingTargetId === null) {
      return
    }
    if (!isLoaded(pendingTargetId)) {
      if (hasError(pendingTargetId)) {
        // A load error settles the jump without a scroll, so it is never left
        // pending.
        setPendingTargetId(null)
      }
      return
    }
    const index = pages.findIndex((page) => page.id === pendingTargetId)
    const element =
      index < 0
        ? null
        : rootRef.current?.querySelector<HTMLElement>(`[data-scene-index="${index}"]`)
    if (element == null) {
      // The scene is committed on the next render; the effect re-runs then.
      return
    }
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({
        block: 'start',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      })
    }
    // With no layout to read (SSR, jsdom) geometry cannot reconcile the current
    // page, so the intended target is recorded directly — after the scroll was
    // issued, never ahead of it. Where geometry exists, the settled viewport wins.
    if (!detect()) {
      setActive(pendingTargetId)
    }
    setPendingTargetId(null)
  }, [pendingTargetId, pages, isLoaded, hasError, detect, setActive])

  if (pages.length === 0) {
    return null
  }

  if (!ready) {
    return hasError(restoredId) ? (
      <ScrollStartupError onRetry={() => retry(restoredId)} />
    ) : (
      <ScrollStartupSkeleton />
    )
  }

  // The frontier of the sequential progression: the last page the learner can
  // currently reach. When its end is reached but the page after it is still
  // locked, the boundary notice belongs at the bottom of *that* page and
  // disappears the moment completion unlocks the next.
  const finalAccessibleIndex =
    accessibleIndices.length > 0 ? accessibleIndices[accessibleIndices.length - 1]! : -1
  const afterFinalIndex = finalAccessibleIndex + 1
  const nextAfterFinalLocked =
    afterFinalIndex > 0 &&
    afterFinalIndex < pages.length &&
    !accessible.has(pages[afterFinalIndex]!.id)

  // Every requested accessible page is rendered, in document order — a real
  // scene once its content exists, otherwise the stable skeleton slot. A locked
  // page has no id here, so it can never mount, load or prefetch.
  const renderedIndices = accessibleIndices.filter((index) => {
    const id = pages[index]!.id
    return requestedIds.has(id) || isLoaded(id)
  })

  return (
    <div data-scroll ref={rootRef}>
      {renderedIndices.map((index) => {
        const page = pages[index]!
        const pageId = page.id

        if (!isLoaded(pageId)) {
          if (hasError(pageId)) {
            return <PageLoadError key={pageId} index={index} onRetry={() => retry(pageId)} />
          }
          return <PageSkeleton key={pageId} index={index} />
        }

        return (
          <PageScene
            key={pageId}
            ref={pageId === restoredId ? restoreRef : undefined}
            page={page}
            index={index}
            nodes={content(pageId) ?? []}
            active={pageId === activeId}
            pathPages={pages}
            pageStates={pageStates}
            onNavigatePathPage={navigateToPageId}
            pageState={pageStates[pageId]}
            onAnswer={onAnswer}
            onQuestionnaireSubmitted={onQuestionnaireSubmitted}
            onVideoPosition={onVideoPosition}
            onPageCompleted={onPageCompleted}
            showLockedBoundary={index === finalAccessibleIndex && nextAfterFinalLocked}
          />
        )
      })}

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

/**
 * The minimal placeholder shown while the restored page's module and its
 * backward context resolve. It is
 * deliberately not addressable by page index (`data-scroll-page` is absent), so
 * it can never be read as a page region, and it reserves one viewport so the
 * layout does not jump when the real page appears.
 */
function ScrollStartupSkeleton() {
  return (
    <div data-scroll-startup aria-hidden="true" className={PAGE_FRAME}>
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
 * The restored page's module failed to load, so the resume never starts. It
 * offers the same retry affordance a page-level failure does rather than showing
 * the startup skeleton forever.
 */
function ScrollStartupError({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-scroll-startup-error className={cn(PAGE_FRAME, 'flex flex-col items-start gap-3')}>
      <ContentLoadError onRetry={onRetry} />
    </div>
  )
}

/**
 * The stable slot for an accessible page whose module is still loading. It uses
 * the same frame as the page it replaces — viewport-tall, same width and padding
 * — so swapping in the real content does not animate height.
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
 * A page whose module failed to load. It keeps the shared page frame so the
 * document layout is unchanged, and offers a single retry action rather than
 * hiding the failure.
 */
function PageLoadError({ index, onRetry }: { index: number; onRetry: () => void }) {
  return (
    <div
      data-scene-index={index}
      data-scroll-page={index}
      data-scroll-error
      className={cn(PAGE_FRAME, 'flex flex-col items-start gap-3')}
    >
      <ContentLoadError onRetry={onRetry} />
    </div>
  )
}

interface PageSceneProps {
  page: PageNode
  index: number
  ref?: Ref<HTMLDivElement>
  /** The page's resolved content nodes (lazily loaded, or inline). */
  nodes: ContentNode[]
  /**
   * Whether this is the page under the reading anchor. It only drives a subtle
   * opacity emphasis — never whether the content is present — so the scene stays
   * in the continuous flow as the current page moves.
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
 * One page in the append-only document. It keeps its natural content height — a
 * minimum of one small viewport (`min-h-svh`) with no forced fixed height and no
 * vertical centering — so a page shorter than the viewport still fills it while
 * any longer page simply grows; pages flow into one another with no inner scroll
 * container, and the document is the single scroll container.
 *
 * A page's end sentinel reports when its end is reached, and the page completes
 * once that end was reached *and* every questionnaire it contains was submitted.
 * The completion state is local to the page, so the presentation holds no
 * cross-page observer state and a page never has to be re-measured.
 */
function PageScene({
  page,
  index,
  ref,
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
      ref={ref}
      data-scene-index={index}
      data-scroll-page={index}
      data-active={active ? 'true' : 'false'}
      aria-label={page.metadata.title}
      className={PAGE_FRAME}
    >
      <div
        data-scroll-page-content
        className={cn(
          'transition-opacity duration-200 ease-out motion-reduce:transition-none',
          active ? 'opacity-100' : 'opacity-90'
        )}
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
