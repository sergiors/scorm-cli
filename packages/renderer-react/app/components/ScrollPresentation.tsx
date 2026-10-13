import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { FormattedMessage } from 'react-intl'
import { Lock } from 'lucide-react'
import type { AnswerValue, PageNode, PlayerPageState } from '../types'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  getSequentialAccess
} from '../lib/content-helpers'
import { clampPageIndex } from '../lib/sequence'
import { ContentRenderer } from './ContentRenderer'

/**
 * A page counts as active while its region overlaps the upper half of the scroll
 * viewport, so scrolling down hands activity to the page entering the top half
 * and the virtualization window follows the learner.
 *
 * Observing the region rather than only its start boundary line means an instant
 * jump that lands anywhere inside a page—End, PageDown, a scrollbar drag or a
 * restored location—still activates the page the viewport now shows. A jump into
 * the middle or lower portion of a distant placeholder leaves its start above the
 * viewport, so a start sentinel alone would never cross this band and the page
 * would stay a blank placeholder.
 *
 * The band is a half-open slice, not a line, so the boundary between two pages
 * can fall inside it and both neighbouring regions can intersect it at once —
 * pages are only guaranteed to be a viewport tall, which bounds the *starts* in
 * the band to one, not the regions. That single start means a scroll or jump
 * crosses at most one activation boundary per frame, so exactly one region flips
 * from not-visible to visible and the active page never flip-flops. The window of
 * one page each side keeps both regions around that boundary mounted (a scene or
 * its placeholder, both observed with this margin), so the hand-off is deliberate.
 */
const PAGE_ACTIVE_MARGIN = '0px 0px -50% 0px'

/**
 * A page's end boundary counts as reached once the end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so it fires just
 * before the very bottom. A non-negative margin keeps the signal reachable at
 * the maximum scroll offset, including for pages no taller than the viewport.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * How many pages on each side of the active page keep their content mounted.
 * Pages outside the window render as height-preserving placeholders, so a long
 * continuous scroll never mounts the whole document at once.
 */
const VIRTUALIZATION_WINDOW = 1

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
 * A continuous, virtualized document of pages. Every page the shared sequential
 * progression policy reports as accessible renders in reading order; locked
 * future pages are never mounted, so their content cannot be reached until the
 * preceding page completes. Only pages inside the virtualization window mount
 * their content, keeping a long scroll cheap. Each accessible page completes
 * once its end boundary is reached and every questionnaire on it is submitted,
 * which in turn unlocks the next page.
 */
export function ScrollPresentation({
  pages,
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
  const observerSupported = typeof IntersectionObserver !== 'undefined'

  const [activeId, setActiveId] = useState(() => {
    const requested = clampPageIndex(initialIndex, pages.length)
    const requestedId = pages[requested]?.id
    if (requestedId !== undefined && accessible.has(requestedId)) {
      return requestedId
    }
    return accessibleIndices[0] !== undefined ? pages[accessibleIndices[0]]!.id : ''
  })

  const activeIndex = accessibleIndices.find((index) => pages[index]!.id === activeId) ?? -1

  // Observer activations are normally driven straight into `activeId`. A Path
  // jump suppresses them until it settles (see `navigateToPageId`), so the
  // intended destination cannot be stolen by a neighbour crossing the band as
  // the virtualization window re-centres.
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null)
  const pendingTargetRef = useRef<string | null>(null)

  const activate = useCallback((pageId: string) => {
    if (pendingTargetRef.current !== null) {
      return
    }
    setActiveId(pageId)
  }, [])

  // Measured outer heights of the scenes that have mounted, so a scene replaced
  // by a placeholder keeps its exact size and the document does not jump when
  // the window moves. Only pages that have actually mounted are measured; the
  // rest fall back to the placeholder's own viewport-tall default.
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({})
  const handlePageHeight = useCallback((pageId: string, height: number) => {
    setPageHeights((previous) =>
      previous[pageId] === height ? previous : { ...previous, [pageId]: height }
    )
  }, [])

  const [endedIds, setEndedIds] = useState<ReadonlySet<string>>(() => new Set())
  const handleEndChange = useCallback((pageId: string, reached: boolean) => {
    setEndedIds((previous) => {
      const has = previous.has(pageId)
      if (has === reached) {
        return previous
      }
      const next = new Set(previous)
      if (reached) {
        next.add(pageId)
      } else {
        next.delete(pageId)
      }
      return next
    })
  }, [])

  // A Path jumps to a referenced page. The reference only resolves when the
  // shared policy reports the page as accessible; a locked page is ignored.
  //
  // The target can sit outside the virtualization window, where only a
  // height-preserving placeholder is mounted. Scrolling that placeholder now
  // would move the viewport to a stale box that the real scene replaces a moment
  // later, and the placeholder's (or a neighbour's) observer could win the
  // activation as the window re-centres. So the jump is staged instead: the
  // target is recorded and activated, React re-centres the window around it, and
  // only the freshly mounted scene is scrolled (see the layout effect below),
  // while observer activation stays suppressed until the jump has settled.
  const navigateToPageId = useCallback(
    (pageId: string) => {
      const index = pages.findIndex((page) => page.id === pageId)
      if (index < 0 || !accessible.has(pageId)) {
        return
      }
      pendingTargetRef.current = pageId
      setPendingTargetId(pageId)
      setActiveId(pageId)
    },
    [accessible, pages]
  )

  // Resume at the active page once, so a saved location opens where it was.
  const activeRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = activeRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start' })
    }
    // Only the initial active page matters; later activity is driven by scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A staged Path jump scrolls the target scene after the window has re-centred,
  // before paint. Querying `[data-scene-index]` (never `[data-scroll-page]`, which
  // a placeholder also carries) guarantees the mounted scene is the element moved,
  // so the jump lands on real content rather than the placeholder it replaced.
  useLayoutEffect(() => {
    if (pendingTargetId === null) {
      return
    }
    const index = pages.findIndex((page) => page.id === pendingTargetId)
    const element = document.querySelector(`[data-scene-index="${index}"]`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start' })
    }
  }, [pendingTargetId, pages])

  // Release the activation suppression only once the jump has settled, so any
  // observer callback racing the re-centre is ignored and the destination wins.
  useEffect(() => {
    if (pendingTargetId === null) {
      return
    }
    pendingTargetRef.current = null
    setPendingTargetId(null)
  }, [pendingTargetId])

  if (pages.length === 0) {
    return null
  }

  const lockedCount = pages.length - accessibleIndices.length

  return (
    <div data-scroll>
      {accessibleIndices.map((index) => {
        const page = pages[index]!
        const mounted =
          !observerSupported ||
          activeIndex < 0 ||
          Math.abs(index - activeIndex) <= VIRTUALIZATION_WINDOW

        if (!mounted) {
          return (
            <VirtualizedPlaceholder
              key={page.id}
              index={index}
              pageId={page.id}
              height={pageHeights[page.id]}
              onActivate={activate}
            />
          )
        }

        const pageState = pageStates[page.id]
        const complete =
          endedIds.has(page.id) &&
          areQuestionnairesSubmitted(
            collectQuestionnaireIds(page.content),
            pageState?.submittedQuestionnaires ?? []
          )

        return (
          <PageScene
            key={page.id}
            ref={page.id === activeId ? activeRef : undefined}
            page={page}
            index={index}
            pathPages={pages}
            pageStates={pageStates}
            onNavigatePathPage={navigateToPageId}
            pageState={pageState}
            onActivate={activate}
            onMeasure={handlePageHeight}
            onEndChange={handleEndChange}
            onAnswer={onAnswer}
            onQuestionnaireSubmitted={onQuestionnaireSubmitted}
            onVideoPosition={onVideoPosition}
            complete={complete}
            onPageCompleted={onPageCompleted}
          />
        )
      })}

      <PageSeenReporter pageId={activeId} onPageSeen={onPageSeen} />

      {lockedCount > 0 ? <LockedBoundary /> : null}
    </div>
  )
}

/**
 * Stores the active page as the current location and marks it visited, once per
 * activation. The ref holds the *last reported* id, not a set of every id ever
 * seen, so a genuine change reports again — including revisiting A after B,
 * which moves the location back to A — while StrictMode's doubled effect for the
 * same id is a no-op. Re-reporting the id already stored is also harmless: the
 * session layer's `markSeen` is idempotent, so it would not write twice.
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
 * Watches an element against the scroll viewport (`root: null`, the document the
 * player scrolls) and reports changes. Returns the disconnect cleanup; when
 * `IntersectionObserver` is unavailable this is an inert cleanup. Repeated
 * callbacks with an unchanged visibility are dropped, so a page region and an
 * end boundary each report at most one change per crossing and never loop.
 */
function observeVisibility(
  element: Element,
  rootMargin: string,
  onVisibilityChange: (visible: boolean) => void
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    return () => {}
  }

  let lastVisible: boolean | null = null
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      if (lastVisible === visible) {
        return
      }
      lastVisible = visible
      onVisibilityChange(visible)
    },
    { root: null, rootMargin, threshold: 0 }
  )

  observer.observe(element)
  return () => observer.disconnect()
}

/**
 * A height-preserving placeholder for an accessible page outside the window.
 * Its whole region is observed with the same activation margin as a mounted
 * page, so scrolling or an instant jump (e.g. restoring a saved location, End or
 * PageDown) that lands anywhere inside the placeholder—not only across its start
 * boundary—activates that page, which mounts its content and synchronizes the
 * reported location. Unmounting disconnects the observer, so no stale watcher is
 * left behind.
 *
 * Once the page has mounted at least once its measured height is applied, so
 * replacing the scene with this placeholder keeps the document's height and the
 * surrounding pages' offsets unchanged instead of collapsing to one viewport.
 */
function VirtualizedPlaceholder({
  index,
  pageId,
  height,
  onActivate
}: {
  index: number
  pageId: string
  height?: number
  onActivate: (pageId: string) => void
}) {
  const regionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = regionRef.current
    if (!element) {
      return
    }
    return observeVisibility(element, PAGE_ACTIVE_MARGIN, (visible) => {
      if (visible) {
        onActivate(pageId)
      }
    })
  }, [onActivate, pageId])

  return (
    <div
      ref={regionRef}
      data-scroll-page={index}
      data-scroll-virtualized={pageId}
      aria-hidden="true"
      style={height === undefined ? undefined : { minHeight: height }}
      className="mx-auto min-h-dvh w-full max-w-3xl px-6"
    />
  )
}

interface PageSceneProps {
  page: PageNode
  index: number
  ref?: Ref<HTMLDivElement>
  /** Root pages, so a Path on this page can resolve its references. */
  pathPages: readonly PageNode[]
  /** Persisted state per root page id, for Path visited status. */
  pageStates: Record<string, PlayerPageState>
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
  pageState?: PlayerPageState
  onActivate: (pageId: string) => void
  /** Reports the scene's rendered outer height so a placeholder can match it. */
  onMeasure: (pageId: string, height: number) => void
  onEndChange: (pageId: string, reached: boolean) => void
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void
  onVideoPosition?: (pageId: string, videoId: string, seconds: number) => void
  /** Whether the page has met its completion rule under the question gate. */
  complete: boolean
  /** Reports the page completion exactly once. */
  onPageCompleted: (id: string) => void
}

/**
 * One page in the continuous document. Its whole region reports when the page
 * becomes active and an end sentinel reports when its end is reached. It remounts
 * per page id, which resets both observers for the next page.
 */
function PageScene({
  page,
  index,
  ref,
  pathPages,
  pageStates,
  onNavigatePathPage,
  pageState,
  onActivate,
  onMeasure,
  onEndChange,
  onAnswer,
  onQuestionnaireSubmitted,
  onVideoPosition,
  complete,
  onPageCompleted
}: PageSceneProps) {
  const regionRef = useRef<HTMLDivElement>(null)

  // The scene's own region drives activation; the parent's ref is only set on the
  // active page for resume scrolling, so both must share the same element.
  const assignRegionRef = useCallback(
    (node: HTMLDivElement | null) => {
      regionRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  useEffect(() => {
    const element = regionRef.current
    if (!element) {
      return
    }
    return observeVisibility(element, PAGE_ACTIVE_MARGIN, (visible) => {
      if (visible) {
        onActivate(page.id)
      }
    })
  }, [onActivate, page.id])

  // Report the scene's outer height as its content settles, so when the window
  // later swaps this scene for a placeholder the replacement is the same size
  // and the pages below do not shift. `ResizeObserver` is unavailable under SSR
  // and in some test environments, where the placeholder's viewport-tall default
  // is used instead.
  useEffect(() => {
    const element = regionRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height > 0) {
        onMeasure(page.id, height)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [onMeasure, page.id])

  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = endRef.current
    if (!element) {
      return
    }
    return observeVisibility(element, PAGE_END_MARGIN, (visible) => onEndChange(page.id, visible))
  }, [onEndChange, page.id])

  return (
    <div
      ref={assignRegionRef}
      data-scene-index={index}
      data-scroll-page={index}
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

      <div ref={endRef} data-scroll-end={index} aria-hidden="true" className="h-px w-full" />

      <PageCompletionReporter
        pageId={page.id}
        complete={complete}
        onPageCompleted={onPageCompleted}
      />
    </div>
  )
}

/** Marks that locked pages remain, without mounting or revealing their content. */
function LockedBoundary() {
  return (
    <div
      data-scroll-locked
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-2 px-6 text-muted-foreground"
    >
      <Lock aria-hidden="true" className="size-5" />
      <p className="text-sm">
        <FormattedMessage id="scroll.locked" />
      </p>
    </div>
  )
}
