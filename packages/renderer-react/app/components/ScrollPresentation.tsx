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
import { cn } from '../lib/utils'
import { ContentRenderer } from './ContentRenderer'

/**
 * The reading anchor, as a fraction of the viewport height. The page the learner
 * is reading is the accessible page whose region contains this fixed line near
 * the top of the viewport — not the page that is merely most visible, whose
 * activation would flicker with the visibility ratio as pages of different
 * heights cross the viewport.
 *
 * A point test is stable for a tall page (the anchor stays inside it while the
 * learner reads) and for a short page (the anchor enters it the moment its start
 * crosses the line and leaves the moment its end does). Unlike a narrow
 * intersection band, a single point can only ever be inside one stacked region,
 * so a boundary can never hand activation to two neighbours at once.
 */
const PAGE_ANCHOR_RATIO = 0.35

/**
 * The boundary deadband, in pixels, either side of a shared page boundary within
 * which the page the learner is already on keeps the anchor. A plain containment
 * test is unique at any instant, but a learner resting a few pixels either side
 * of the exact boundary would still flip the current page on every scroll event;
 * the deadband turns that instant into a small band the current page survives
 * until the neighbour is clearly entered — in either direction. It is capped by
 * half the shorter of the two adjacent regions (see
 * {@link retainCurrentAcrossDeadband}) so a very short page can still become
 * current once the anchor is well inside it.
 */
const PAGE_HANDOFF_DEADBAND = 48

/**
 * How many accessible pages before and after the viewport stay mounted. The
 * mounted set is derived from the *viewport*, never from the active page, so
 * moving the active page alone cannot recycle a scene: only scrolling far enough
 * that a page leaves the retained window does. Two pages of overscan above keep
 * a recently read page real when scrolling back, and the single page below
 * preloads the next accessible (unlocked) page.
 */
const PREVIOUS_PAGES_KEPT = 2
const NEXT_PAGES_KEPT = 1

/**
 * A page's end boundary counts as reached once the end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so it fires just
 * before the very bottom. A non-negative margin keeps the signal reachable at
 * the maximum scroll offset, including for pages no taller than the viewport.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * The height a placeholder reserves before its page has ever mounted and been
 * measured. It is deliberately a bounded, non-viewport floor rather than the
 * old full-viewport default: the placeholder keeps the page's scroll position
 * real, but reserving a whole viewport made a short page's real content shrink
 * the document by most of a screen when it mounted again above the viewport. A
 * measured height always replaces this floor.
 */
const PLACEHOLDER_FALLBACK_HEIGHT = '10rem'

/**
 * How many animation frames the initial restore waits before ordinary
 * detection resumes. The restore positions the saved page with an instant,
 * synchronous `scrollIntoView`; its `scroll` event is delivered during the
 * rendering update, ahead of that frame's animation callbacks. Waiting a full
 * rendering cycle past the restore frame — two animation frames — consumes that
 * echo (and any geometry the freshly mounted neighbours settle into on it)
 * while detection is still off, so a short restored page cannot immediately
 * hand its location to a neighbour. This is a rendering-cycle boundary rather
 * than a duration, so it adapts to the display's frame rate and never depends
 * on an arbitrary timer.
 */
const RESTORE_SETTLE_FRAMES = 2

/**
 * How long the viewport must stay quiet after the last `scroll` event before a
 * smooth jump is treated as settled on browsers that do not report `scrollend`.
 */
const SCROLL_SETTLE_MS = 150

/**
 * The longest a smooth jump keeps activation suppressed. `scrollend` never fires
 * when the scroll position did not change, and a no-op `scrollIntoView` — an
 * already-positioned target or a test stub — reports neither `scroll` nor
 * `scrollend`, so this bound is what keeps the pending state from hanging.
 */
const SCROLL_JUMP_TIMEOUT_MS = 1200

/**
 * Whether the learner has asked the platform to reduce motion. A deliberate Path
 * jump honours it by scrolling instantly (`behavior: 'auto'`) instead of
 * animating; the initial restore is always instant regardless of the preference
 * (see the restore effect), so a resume never animates in from the top. Guarded
 * for a host without `matchMedia` — SSR and jsdom — so the check is inert rather
 * than throwing.
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

/** A page's rendered region, measured against the current scroll viewport. */
interface PageRegion {
  index: number
  id: string
  top: number
  bottom: number
}

/** The contiguous run of accessible page indices the viewport currently shows. */
interface ViewportRange {
  first: number
  last: number
}

/**
 * Measures the rendered region of every accessible page, in document order.
 * Scenes and placeholders both carry `data-scroll-page`, so an accessible page
 * that is currently a placeholder still contributes a real box — which is what
 * lets an instant jump into an unmounted page be detected from geometry alone.
 */
function measurePageRegions(root: HTMLElement, pages: readonly PageNode[]): PageRegion[] {
  const regions: PageRegion[] = []
  for (const element of root.querySelectorAll<HTMLElement>('[data-scroll-page]')) {
    const index = Number(element.getAttribute('data-scroll-page'))
    const page = pages[index]
    if (page === undefined || Number.isNaN(index)) {
      continue
    }
    const rect = element.getBoundingClientRect()
    regions.push({ index, id: page.id, top: rect.top, bottom: rect.bottom })
  }
  regions.sort((a, b) => a.index - b.index)
  return regions
}

/**
 * Whether the anchor is still close enough to the boundary shared with the
 * current page that the current page should keep it. Returns the current page to
 * retain, or `null` when the neighbour has clearly won: the anchor is past the
 * deadband, or the boundary is not between two adjacent pages (so a jump to a
 * distant region is never held back). The deadband is capped by half the shorter
 * of the two regions, so a page no taller than the base deadband can still be
 * reached once the anchor is clearly inside it.
 */
function retainCurrentAcrossDeadband(
  target: PageRegion,
  current: PageRegion | null,
  anchor: number
): PageRegion | null {
  if (current === null || Math.abs(current.index - target.index) !== 1) {
    return null
  }
  const boundary = target.index > current.index ? target.top : target.bottom
  const shorter = Math.min(current.bottom - current.top, target.bottom - target.top)
  const deadband = Math.min(PAGE_HANDOFF_DEADBAND, shorter / 2)
  return Math.abs(anchor - boundary) < deadband ? current : null
}

/**
 * The page at the reading anchor. The region that contains the anchor wins, but
 * a hand-off to an adjacent page is softened by a small deadband (see
 * {@link PAGE_HANDOFF_DEADBAND}): while the anchor is within it the page the
 * learner is already on is retained, so a few pixels of scroll around the exact
 * boundary cannot oscillate the current page. A non-adjacent page — a jump
 * landing deep inside another region — still wins immediately, and once the
 * anchor clearly crosses the deadband the neighbour takes over in either
 * direction.
 *
 * When no region contains the anchor (the anchor sits above the first page or
 * below a document shorter than the viewport) the nearest region that is
 * actually within the viewport is chosen, and only then the nearest overall, so
 * an instant jump still resolves to a sensible accessible page.
 */
function pickAnchorPage(
  regions: readonly PageRegion[],
  anchor: number,
  viewportHeight: number,
  current: PageRegion | null
): PageRegion | null {
  for (const region of regions) {
    if (region.top <= anchor && anchor < region.bottom) {
      return retainCurrentAcrossDeadband(region, current, anchor) ?? region
    }
  }

  let nearest: PageRegion | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const region of regions) {
    if (region.bottom <= 0 || region.top >= viewportHeight) {
      continue
    }
    const distance = anchor < region.top ? region.top - anchor : anchor - region.bottom
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = region
    }
  }
  if (nearest !== null) {
    return nearest
  }

  for (const region of regions) {
    const distance = anchor < region.top ? region.top - anchor : Math.max(0, anchor - region.bottom)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = region
    }
  }
  return nearest
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
 * preceding page completes.
 *
 * The current page is the one under a fixed viewport anchor (see
 * {@link PAGE_ANCHOR_RATIO}), resolved from page geometry on scroll. A plain
 * containment test is unique at any instant, so a hand-off to an adjacent page is
 * held until the anchor clearly crosses a small boundary deadband (see
 * {@link PAGE_HANDOFF_DEADBAND}): a few pixels of scroll around the exact
 * boundary cannot oscillate the current page, while a clear crossing still moves
 * it in either direction. Locked pages never render, so they cannot participate.
 * The semantic current page stays `activeId`; no parallel index is tracked.
 *
 * Only the pages around the viewport mount their content. The mounted window is
 * derived from the viewport range — two pages of overscan above and the next
 * page below — rather than from the active page, so changing the current page
 * never immediately recycles a scene; a page becomes a placeholder only once it
 * has scrolled far enough out of the retained window. A page that has mounted
 * keeps its measured outer height, so the swap never shifts the document. Each
 * accessible page completes once its end boundary is reached and every
 * questionnaire on it is submitted, which in turn unlocks the next page.
 *
 * Each accessible page reserves at least one small viewport (`min-h-svh`) and
 * grows naturally beyond it, top-aligned with no inner scroll viewport, so the
 * document is the single, browser-native scroll container. The current page is
 * marked with a subtle opacity/translate emphasis only; a page is never hidden
 * by its activity state, so the scroll stays continuous. Under
 * `prefers-reduced-motion` the emphasis transition is dropped and an explicit
 * Path jump scrolls instantly instead of animating.
 *
 * A saved location is restored in an explicit phase: the location resolves
 * synchronously into `activeId`, its overscan window is committed, and the
 * restored scene is positioned instantly before detection is allowed to run. So
 * a refresh opens exactly where the learner left off and stays there — the
 * restore's own scroll echo and the freshly mounted neighbours' settling
 * geometry cannot hand the location to a neighbour before the learner scrolls.
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

  // The synchronous mirror of `activeId`, so the scroll handler closes over a
  // stable callback yet always compares against the current page.
  const activeIdRef = useRef(activeId)
  const setActive = useCallback((pageId: string) => {
    activeIdRef.current = pageId
    setActiveId(pageId)
  }, [])

  // Restoration is an explicit phase, not an instant. The saved location is
  // already resolved synchronously into `activeId` above and the mounted window
  // is committed around it, so the restored scene is positioned before the
  // browser can run a scroll handler. Detection stays *off* — no `scroll` or
  // `resize` listener is attached and {@link detect} is inert — until that
  // positioning has been committed and one full rendering cycle has passed.
  //
  // This is what makes a refresh stable. A resume jumps the document to the
  // saved page with an instant, synchronous `scrollIntoView`, whose asynchronous
  // `scroll` echo then arrives while the freshly mounted neighbours are still
  // settling their geometry. Running ordinary detection on that echo would hand
  // the current page to whichever neighbour happens to contain the fixed anchor
  // — most visibly when the restored page is short enough that the anchor falls
  // past its end — and persist that neighbour as the location before the learner
  // has scrolled at all. Holding detection until the restore has settled keeps
  // the restored page as the current page, and the first *genuine* scroll or
  // resize afterwards reconciles the window normally.
  const [restoring, setRestoring] = useState(true)
  const restoringRef = useRef(true)
  const finishRestoring = useCallback(() => {
    if (!restoringRef.current) {
      return
    }
    restoringRef.current = false
    setRestoring(false)
  }, [])

  // The viewport range the mounted window follows. It starts as the single
  // resume page, so the mounted window around it is exactly the overscan set —
  // the two pages above the restored page, the restored page, and the single
  // accessible page below it (a locked next page never renders). Geometry is not
  // available until the first real measurement, so this committed window is what
  // the instant restore positions against; the first scroll or resize after the
  // restore refines it from the rendered regions.
  const [viewportRange, setViewportRange] = useState<ViewportRange>(() => {
    const index = Math.max(
      0,
      pages.findIndex((page) => page.id === activeId)
    )
    return { first: index, last: index }
  })

  // Scroll detection normally drives `activeId` directly. A Path jump suppresses
  // it until the jump settles (see `navigateToPageId`), so the intended
  // destination cannot be stolen by a neighbour crossing the anchor as the
  // virtualization window re-centres.
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null)
  const pendingTargetRef = useRef<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)

  // Reads the rendered page regions and moves both the semantic current page and
  // the mounted window to match the scroll position. It runs on `scroll` and
  // `resize`, and once more when a staged jump releases its suppression, so a
  // change is only ever driven by where the viewport actually is. Returns whether
  // the viewport geometry was actually read and applied: a suppressed call
  // (during the initial restore or a staged jump), or a layout with nothing to
  // measure (SSR, jsdom, an eventless no-op jump), reports `false` so a caller can
  // fall back to a known page instead.
  const detect = useCallback((): boolean => {
    if (restoringRef.current || pendingTargetRef.current !== null) {
      return false
    }
    const root = rootRef.current
    if (root === null) {
      return false
    }
    const regions = measurePageRegions(root, pages)
    // SSR and jsdom report a zero-size box for every region; with no geometry to
    // read, the semantic state is kept and the caller-driven test/restore state
    // stands in until a real layout exists.
    if (regions.length === 0 || !regions.some((region) => region.bottom > region.top)) {
      return false
    }

    const viewportHeight = window.innerHeight
    const anchor = viewportHeight * PAGE_ANCHOR_RATIO
    const current = regions.find((region) => region.id === activeIdRef.current) ?? null
    const target = pickAnchorPage(regions, anchor, viewportHeight, current)

    if (target !== null && target.id !== activeIdRef.current) {
      setActive(target.id)
    }

    const visible = regions.filter((region) => region.bottom > 0 && region.top < viewportHeight)
    let first = visible.length > 0 ? visible[0]!.index : -1
    let last = visible.length > 0 ? visible[visible.length - 1]!.index : -1
    if (target !== null) {
      if (first === -1 || target.index < first) {
        first = target.index
      }
      if (last === -1 || target.index > last) {
        last = target.index
      }
    }
    if (first !== -1 && last !== -1) {
      setViewportRange((previous) =>
        previous.first === first && previous.last === last ? previous : { first, last }
      )
    }
    return true
  }, [pages, setActive])

  // Ordinary detection is only wired up once the restore has settled. No initial
  // detection runs on mount: the restored location and its committed window
  // already stand, and the only thing a mount-time measurement could do is hand
  // the location to a neighbour whose geometry settled after the restore — so the
  // first genuine `scroll` or `resize` is what refines the window.
  useEffect(() => {
    if (typeof window === 'undefined' || restoring) {
      return
    }
    window.addEventListener('scroll', detect, { passive: true })
    window.addEventListener('resize', detect)
    return () => {
      window.removeEventListener('scroll', detect)
      window.removeEventListener('resize', detect)
    }
  }, [detect, restoring])

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
  // Only the pending target is recorded here: React mounts the target scene
  // (the mounted window always includes the pending page) and the layout effect
  // below scrolls it. The semantic current page is *not* moved ahead of the
  // physical scroll — `activeId` follows the viewport, so once the smooth scroll
  // settles the target is stored as current only if the viewport actually came to
  // rest on it (see the settle handler below).
  const navigateToPageId = useCallback(
    (pageId: string) => {
      const index = pages.findIndex((page) => page.id === pageId)
      if (index < 0 || !accessible.has(pageId)) {
        return
      }
      pendingTargetRef.current = pageId
      setPendingTargetId(pageId)
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

  // Ends the restore phase once the instant positioning has settled. Detection
  // (the scroll/resize listeners and every {@link detect} call) stays off until
  // then, so the restore's `scroll` echo cannot be read as the learner scrolling
  // (see `restoring` above). The wait is a rendering-cycle boundary, not a
  // timer: two animation frames past the restore frame, the first draining that
  // frame's scroll steps and the second confirming layout has settled. A host
  // without animation frames — SSR, or a reduced test environment — has no
  // scroll echo to absorb, so the phase completes immediately rather than
  // hanging. The pending frames are cancelled on unmount (and on StrictMode's
  // remount), so a torn-down restore never leaves detection permanently off.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      finishRestoring()
      return
    }

    let frames = 0
    let handle = 0
    const advance = () => {
      frames += 1
      if (frames >= RESTORE_SETTLE_FRAMES) {
        finishRestoring()
        return
      }
      handle = window.requestAnimationFrame(advance)
    }
    handle = window.requestAnimationFrame(advance)

    return () => {
      if (handle !== 0) {
        window.cancelAnimationFrame(handle)
      }
    }
  }, [finishRestoring])

  // A staged Path jump scrolls the target scene after the window has mounted it,
  // before paint. Querying `[data-scene-index]` (never `[data-scroll-page]`,
  // which a placeholder also carries) guarantees the mounted scene is the element
  // moved, so the jump lands on real content rather than the placeholder it
  // replaced.
  //
  // Unlike the initial restore, a deliberate Path navigation scrolls smoothly, so
  // the suppression it raised is held until that scroll actually settles — see
  // `holdActivationUntilScrollSettles` — rather than released the moment the
  // animation starts, which a mid-flight detection could otherwise exploit. Under
  // `prefers-reduced-motion` the jump is instant instead, so there is no
  // animation to wait for and the suppression is released as soon as the
  // synchronous positioning returns.
  useLayoutEffect(() => {
    if (pendingTargetId === null) {
      return
    }
    const index = pages.findIndex((page) => page.id === pendingTargetId)
    const element = document.querySelector(`[data-scene-index="${index}"]`)
    const reducedMotion = prefersReducedMotion()
    if (element && typeof element.scrollIntoView === 'function') {
      // A deliberate Path jump is smooth, so the learner sees the document move
      // to the target; under `prefers-reduced-motion` it is instant instead.
      element.scrollIntoView({
        block: 'start',
        behavior: reducedMotion ? 'auto' : 'smooth'
      })
    }

    // Reconciles the semantic state with the settled viewport once the physical
    // scroll has come to rest. The physical scroll is the source of truth: the
    // same geometry detection that drives ordinary scrolling decides the current
    // page and the mounted window, rather than blindly forcing the staged
    // destination. If the learner interrupted the jump, or the destination is
    // short enough that neighbours share the screen, the viewport wins; with no
    // layout geometry to read (SSR/jsdom, or an eventless no-op scroll) the
    // intended target is recorded instead.
    const release = () => {
      const target = pendingTargetRef.current
      pendingTargetRef.current = null
      setPendingTargetId(null)
      if (target === null) {
        return
      }
      if (detect()) {
        return
      }
      setActive(target)
      const targetIndex = pages.findIndex((page) => page.id === target)
      if (targetIndex >= 0) {
        setViewportRange({ first: targetIndex, last: targetIndex })
      }
    }

    // `behavior: 'auto'` positions the document synchronously: by the time
    // `scrollIntoView` returns, the scroll is already at rest, so there is no
    // animation to hold suppression for and no `scrollend` to observe. Releasing
    // now reconciles in the same commit rather than waiting for a settle that a
    // no-op jump would never report. With motion allowed the smooth scroll is
    // held until it actually settles, exactly as before.
    if (reducedMotion) {
      release()
      return
    }

    return holdActivationUntilScrollSettles(release)
  }, [pendingTargetId, pages, setActive, detect])

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

  const mountedFirst = viewportRange.first - PREVIOUS_PAGES_KEPT
  const mountedLast = viewportRange.last + NEXT_PAGES_KEPT
  const pendingIndex =
    pendingTargetId === null ? -1 : pages.findIndex((page) => page.id === pendingTargetId)

  return (
    <div data-scroll ref={rootRef}>
      {accessibleIndices.map((index) => {
        const page = pages[index]!
        const mounted =
          !observerSupported ||
          index === pendingIndex ||
          (index >= mountedFirst && index <= mountedLast)

        if (!mounted) {
          return (
            <VirtualizedPlaceholder
              key={page.id}
              index={index}
              pageId={page.id}
              height={pageHeights[page.id]}
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
            active={page.id === activeId}
            pathPages={pages}
            pageStates={pageStates}
            onNavigatePathPage={navigateToPageId}
            pageState={pageState}
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
 * Their detection callbacks would otherwise activate an intermediate page —
 * moving the stored location and re-centring the window again — before the
 * intended target lands. The suppression is released on the first of:
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
 *   position did not change and a no-op scroll (an already-positioned target or
 *   a test stub) reports nothing at all.
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
 * callbacks with an unchanged visibility are dropped, so a boundary reports at
 * most one change per crossing and never loops.
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
 * A height-preserving placeholder for an accessible page outside the mounted
 * window. Once the page has mounted at least once its measured height is
 * applied, so replacing the scene with this placeholder keeps the document's
 * height and the surrounding pages' offsets unchanged — including when the page
 * is recycled above the viewport. Before the first mount nothing is known, so a
 * bounded, non-viewport floor keeps the region a real, measurable box that an
 * instant jump can land in and activate.
 */
function VirtualizedPlaceholder({
  index,
  pageId,
  height
}: {
  index: number
  pageId: string
  height?: number
}) {
  return (
    <div
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
  /**
   * Whether this is the page under the reading anchor. It only drives a subtle
   * emphasis transition — never whether the content is present — so the scene
   * stays in the continuous flow as the current page moves.
   */
  active: boolean
  /** Root pages, so a Path on this page can resolve its references. */
  pathPages: readonly PageNode[]
  /** Persisted state per root page id, for Path visited status. */
  pageStates: Record<string, PlayerPageState>
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
  pageState?: PlayerPageState
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
 * One page in the continuous document. It keeps its natural content height — a
 * minimum of one small viewport (`min-h-svh`) with no forced fixed height and no
 * vertical centering — with responsive block padding, so a page shorter than the
 * viewport still fills it while any longer page simply grows; pages flow into
 * one another with no inner scroll container, and the document is the single
 * scroll container. Its region is measured for the window, and an end sentinel
 * reports when its end is reached. It remounts per page id, which resets both
 * observers for the next page.
 *
 * The active page carries only a subtle emphasis: a small opacity and translate
 * on its content, settling over `duration-200` when the reading anchor moves to
 * it. The translate is applied to an inner content wrapper, never to the measured
 * region, so it cannot shift the geometry anchor detection reads. The emphasis
 * never changes whether the content is present — inactive pages stay fully in
 * the flow, top-aligned and readable — so it reads as the current page settling
 * rather than a page being shown or hidden. Under `prefers-reduced-motion` the
 * emphasis is neutralized entirely: the transition is dropped *and* the inactive
 * offset and opacity are reset, so activity never produces motion or a state
 * fade for a learner who asked for reduced motion.
 */
function PageScene({
  page,
  index,
  ref,
  active,
  pathPages,
  pageStates,
  onNavigatePathPage,
  pageState,
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

  // The parent's ref is only set on the active page for resume scrolling, so it
  // and the scene's own region share the same element.
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

  // Report the scene's outer height so when the window later swaps this scene
  // for a placeholder the replacement is the same size and the pages below do
  // not shift. The initial measurement is taken even where `ResizeObserver` is
  // unavailable — and before it can be swapped out — so a page that mounted
  // always leaves its exact height behind; the observer then tracks any later
  // content or reflow change.
  useEffect(() => {
    const element = regionRef.current
    if (!element) {
      return
    }
    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height > 0) {
        onMeasure(page.id, height)
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
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
      data-active={active ? 'true' : 'false'}
      aria-label={page.metadata.title}
      className="mx-auto w-full max-w-3xl min-h-svh px-4 py-12"
    >
      {/*
        The active emphasis lives on an inner wrapper, never on the measured
        region above. A transform on the region would shift its
        `getBoundingClientRect` by the translate amount, breaking the exact
        tiling that anchor detection and the end sentinel read their geometry
        from. Keeping the region transform-free means the subtle translate only
        moves the content visually.
      */}
      <div
        data-scroll-page-content
        className={cn(
          // The reduced-motion variant neutralizes the emphasis itself, not just
          // its transition: it restores the offset and opacity the active state
          // would otherwise apply, so toggling activity under `prefers-reduced-
          // motion` is a genuine no-op rather than a transition-less jump.
          'transition duration-200 ease-out motion-reduce:transition-none',
          'motion-reduce:translate-y-0 motion-reduce:opacity-100',
          active ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-90'
        )}
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
