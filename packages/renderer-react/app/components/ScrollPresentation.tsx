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
 * A page counts as active while its region crosses the upper band of the scroll
 * viewport, so the page the learner is reading — the one at the top of the
 * viewport — owns activation and the virtualization window follows them.
 *
 * Observing the region rather than only its start boundary line means an instant
 * jump that lands anywhere inside a page—End, PageDown, a scrollbar drag or a
 * restored location—still activates the page the viewport now shows. A jump into
 * the middle or lower portion of a distant placeholder leaves its start above the
 * viewport, so a start sentinel alone would never cross this band and the page
 * would stay a blank placeholder.
 *
 * Pages now keep their natural content height, so a page may be shorter than the
 * band and its neighbours may overlap it. Anchoring the band to the viewport top
 * (rather than its middle) keeps a page reachable the moment it appears, and
 * keeping it a narrow slice bounds how many page regions can intersect it at
 * once, so a boundary merely entering the viewport does not hand activation to a
 * neighbour on a tiny scroll. The window of one page each side keeps both regions
 * around a boundary mounted (a scene or its placeholder, both observed with this
 * margin), so the hand-off is deliberate.
 */
const PAGE_ACTIVE_MARGIN = '0px 0px -75% 0px'

/**
 * A page's end boundary counts as reached once the end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so it fires just
 * before the very bottom. A non-negative margin keeps the signal reachable at
 * the maximum scroll offset, including for pages no taller than the viewport.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * How many pages on each side of the active page keep their content mounted.
 * Pages outside the window render as placeholders: a page that has mounted keeps
 * its measured height, while one that never has reserves the bounded fallback
 * (see {@link PLACEHOLDER_FALLBACK_HEIGHT}) — so a long continuous scroll never
 * mounts the whole document at once, and an unmeasured page is still a real,
 * observable region rather than collapsing to nothing.
 */
const VIRTUALIZATION_WINDOW = 1

/**
 * The height a placeholder reserves before its page has ever mounted and been
 * measured. It is deliberately a bounded, non-viewport floor rather than the
 * old full-viewport default: the placeholder is observed for activation, so it
 * needs a real, non-zero box, but reserving a whole viewport made a short page's
 * real content shrink the document by most of a screen when it mounted again
 * above the viewport. A measured height always replaces this floor.
 */
const PLACEHOLDER_FALLBACK_HEIGHT = '10rem'

/**
 * How long the viewport must stay quiet after the last `scroll` event before a
 * smooth jump is treated as settled on browsers that do not report `scrollend`.
 */
const SCROLL_SETTLE_MS = 150

/**
 * The longest a smooth jump keeps observer activation suppressed. `scrollend`
 * never fires when the scroll position did not change, and a no-op
 * `scrollIntoView` — reduced motion, an already-positioned target or a test
 * stub — reports neither `scroll` nor `scrollend`, so this bound is what keeps
 * the pending state from hanging.
 */
const SCROLL_JUMP_TIMEOUT_MS = 1200

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
  // rest reserve the bounded placeholder fallback until they first mount.
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
  // The restore is deliberately instant (`behavior: 'auto'`): a resumed lesson
  // should already be where it left off, not animate a long smooth scroll in
  // from the top of the document.
  const activeRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = activeRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
    // Only the initial active page matters; later activity is driven by scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A staged Path jump scrolls the target scene after the window has re-centred,
  // before paint. Querying `[data-scene-index]` (never `[data-scroll-page]`, which
  // a placeholder also carries) guarantees the mounted scene is the element moved,
  // so the jump lands on real content rather than the placeholder it replaced.
  //
  // Unlike the initial restore, a deliberate Path navigation scrolls smoothly, so
  // the suppression it raised is held until that scroll actually settles — see
  // `holdActivationUntilScrollSettles` — rather than released the moment the
  // animation starts, which a mid-flight observer callback could otherwise exploit.
  useLayoutEffect(() => {
    if (pendingTargetId === null) {
      return
    }
    const index = pages.findIndex((page) => page.id === pendingTargetId)
    const element = document.querySelector(`[data-scene-index="${index}"]`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }

    return holdActivationUntilScrollSettles(() => {
      pendingTargetRef.current = null
      setPendingTargetId(null)
    })
  }, [pendingTargetId, pages])

  if (pages.length === 0) {
    return null
  }

  // The frontier of the sequential progression: the last page the learner can
  // currently reach. When its end is reached but the page after it is still
  // locked, the boundary notice belongs at the bottom of *this* page — the one
  // the learner is on — and disappears the moment completion unlocks the next.
  const finalAccessibleIndex =
    accessibleIndices.length > 0 ? accessibleIndices[accessibleIndices.length - 1]! : -1
  const afterFinalIndex = finalAccessibleIndex + 1
  const nextAfterFinalLocked =
    afterFinalIndex > 0 &&
    afterFinalIndex < pages.length &&
    !accessible.has(pages[afterFinalIndex]!.id)

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
            showLockedBoundary={
              index === finalAccessibleIndex &&
              nextAfterFinalLocked &&
              endedIds.has(page.id) &&
              !complete
            }
          />
        )
      })}

      <PageSeenReporter pageId={activeId} onPageSeen={onPageSeen} />
    </div>
  )
}

/**
 * Holds observer activation until a smooth jump has settled, then releases it.
 *
 * A smooth `scrollIntoView` animates for a few hundred milliseconds, during
 * which the re-centred virtualization window mounts and unmounts page regions.
 * Their `IntersectionObserver` callbacks would otherwise activate an
 * intermediate page — moving the stored location and re-centring the window
 * again — before the intended target lands. The suppression is released on the
 * first of:
 *
 * - `scrollend`, where the browser reports it for a document scroll (an engine
 *   without it simply never fires the listener, so no capability check is
 *   needed);
 * - a quiet period (`SCROLL_SETTLE_MS`) after the last `scroll` event, for
 *   browsers that do not report `scrollend`. The period starts only once a
 *   `scroll` event is observed and is extended by each further one, so an
 *   animation whose first frame is slow cannot have its suppression released
 *   before the scroll has even begun; or
 * - an overall timeout (`SCROLL_JUMP_TIMEOUT_MS`), which bounds the wait from
 *   the moment the jump is staged — because `scrollend` never fires when the
 *   position did not change and a no-op scroll (reduced motion, an
 *   already-positioned target or a test stub) reports nothing at all.
 *
 * The returned cleanup removes every listener and timer, so a further jump or an
 * unmount cannot leave a stale release behind.
 */
function holdActivationUntilScrollSettles(release: () => void): () => void {
  // A document scroll may be reported on the window or the document depending on
  // the engine, so both are watched; `settle` is idempotent either way.
  const targets: EventTarget[] = [window, document]
  let settled = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let hardTimer: ReturnType<typeof setTimeout> | undefined

  const cleanup = () => {
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer)
    }
    if (hardTimer !== undefined) {
      clearTimeout(hardTimer)
    }
    for (const target of targets) {
      target.removeEventListener('scrollend', settle)
      target.removeEventListener('scroll', onScroll)
    }
  }

  const settle = () => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    release()
  }

  // Each `scroll` event restarts the quiet period, so suppression is lifted
  // `SCROLL_SETTLE_MS` after the scroll actually stops. The period is *not*
  // started up front: a smooth animation may take longer than that to deliver
  // its first frame, and an eventless no-op jump is bounded by the overall
  // timeout below rather than by a quiet period that nothing would extend.
  const onScroll = () => {
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer)
    }
    settleTimer = setTimeout(settle, SCROLL_SETTLE_MS)
  }

  for (const target of targets) {
    target.addEventListener('scrollend', settle)
    target.addEventListener('scroll', onScroll, { passive: true })
  }
  hardTimer = setTimeout(settle, SCROLL_JUMP_TIMEOUT_MS)

  return cleanup
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
 * surrounding pages' offsets unchanged. Before the first mount nothing is known,
 * so a bounded, non-viewport floor keeps the region a real, observable box — a
 * page the learner has never opened still has to be reachable when scrolling
 * back to it — without reserving a whole viewport (see
 * {@link PLACEHOLDER_FALLBACK_HEIGHT}).
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
      style={{ minHeight: height ?? PLACEHOLDER_FALLBACK_HEIGHT }}
      className="mx-auto w-full max-w-3xl px-6"
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
  /**
   * Whether this is the final accessible page, its end has been reached and the
   * page after it is still locked, so the generic "complete this page to
   * continue" boundary belongs at the bottom of this page.
   */
  showLockedBoundary: boolean
}

/**
 * One page in the continuous document. It keeps its natural content height —
 * no forced viewport height and no vertical centering — with responsive block
 * padding, so pages flow into one another and the document is the single scroll
 * container. Its whole region reports when the page becomes active and an end
 * sentinel reports when its end is reached. It remounts per page id, which
 * resets both observers for the next page.
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
  onPageCompleted,
  showLockedBoundary
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
  // and in some test environments, where the placeholder's bounded fallback
  // height is used instead.
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
      className="mx-auto w-full max-w-3xl px-4 py-12"
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

      {showLockedBoundary ? <LockedBoundary /> : null}

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
