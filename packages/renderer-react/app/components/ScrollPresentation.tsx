import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { Lock } from 'lucide-react'
import { Virtuoso, type ListItem, type VirtuosoHandle } from 'react-virtuoso'
import type { ContentNode, PageNode } from '../types'
import { getSequentialAccess } from '../lib/content-helpers'
import { useContentLoader, type ContentProvider, type ContentLoader } from '../lib/content-loader'
import { PageProvider, usePlayerActions, usePlayerState } from '../lib/player-context'
import { arePageQuestionnairesComplete } from '../lib/questionnaire-completion'
import { ContentRenderer } from './ContentRenderer'
import { ContentLoadError } from './ContentLoadError'
import { Skeleton } from './ui/skeleton'

/**
 * A page's end sentinel counts as reached once it enters the viewport, extended
 * by a small positive bottom margin so it fires just before the very bottom. It
 * is a completion signal only, never a positioning input.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px'

/**
 * The single shared column framing the reading list: one responsive width and
 * horizontal padding around the virtualizer, with no overflow, height or
 * vertical spacing, so the document stays the only scroller.
 */
const PAGE_COLUMN = 'mx-auto w-full max-w-3xl px-4 sm:px-6'

/**
 * The spacing wrapper around every page slot. The padding lives inside the
 * Virtuoso item content, so each item's measured height already includes it and
 * no `gap` prop (which would leave the reported item offsets non-contiguous) is
 * needed.
 */
const PAGE_ITEM = 'py-4 sm:py-6'

/** The nodes whose own completion rule has been met, which advance the done prefix. */
function donePageIds(
  pages: readonly PageNode[],
  pageStates: Record<string, { completed?: boolean }>
): Set<string> {
  return new Set(
    pages.filter((page) => pageStates[page.id]?.completed === true).map((page) => page.id)
  )
}

/**
 * The page under the viewport top, resolved from the rendered items and the
 * list-relative scroll offset: `itemsRendered` reports each item's `offset` and
 * `size` from the start of the list, and in window-scroll mode
 * `VirtuosoHandle.getState()` reports `scrollTop` against that same origin, so
 * the page under the top is the first item whose end is strictly past
 * `scrollTop`. The intervals are contiguous because the list sets no `gap` prop.
 *
 * Returns `null` when `scrollTop` falls outside the reported span (the rendered
 * window has not caught up with the scroll yet); the caller then leaves the
 * location unchanged and reconciles once the covering list arrives.
 */
function activePageIdAt(
  items: readonly ListItem<unknown>[],
  scrollTop: number,
  pages: readonly PageNode[]
): string | null {
  if (items.length === 0) {
    return null
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  if (scrollTop < first.offset || scrollTop >= last.offset + last.size) {
    return null
  }
  for (const item of items) {
    if (scrollTop < item.offset + item.size) {
      return pages[item.index]?.id ?? null
    }
  }
  return null
}

export interface ScrollPresentationProps {
  pages: PageNode[]
  /**
   * The single runtime source of each page's authored content. Every page is an
   * independent lazily loaded module; a locked page's module is never fetched.
   */
  contentProvider: ContentProvider
}

/**
 * The reading presentation: a single native document scroller owned by React
 * Virtuoso, which exclusively handles virtualization, page geometry and
 * positioning. Every page keeps its natural height, so the document is exactly
 * as tall as the authored content.
 *
 * The list holds exactly the accessible pages, in document order: the completed
 * prefix plus its immediate first not-done successor. A locked future page is not
 * a list item at all, so it can never be mounted, imported or prefetched. The
 * page after the reading anchor is requested once the shared policy reports it
 * accessible; the further tail is left to Virtuoso, which requests a page's
 * module when it mounts its slot.
 *
 * The semantic current page is the page under the viewport top, resolved by
 * `activePageIdAt` from the rendered item offsets and the list-relative
 * scrollTop. The location only moves on a real scroll: one passive `scroll`
 * listener reads the list-relative offset through `getState` and resolves it
 * against the latest rendered items. A scroll that arrives before the rendered
 * items have caught up is marked pending and reconciled on the next
 * `itemsRendered`, so a transient window never moves the location. Nothing here
 * is an input to scrolling — no measurement or scroll API is called to derive or
 * apply the location — so state updates can never feed back into scrolling.
 *
 * A reload resumes the saved reading position: the accessible page named by the
 * sanitized `PlayerState.location`, or the first accessible page when it is
 * absent, unknown or still locked. The index is computed once on first mount and
 * handed to Virtuoso as its initial item, so the list opens there with no
 * scripted scroll, and the semantic current page is initialized to the same page
 * so the first seen report matches it rather than overwriting the saved location
 * with page zero.
 */
export function ScrollPresentation({ pages, contentProvider }: ScrollPresentationProps) {
  const state = usePlayerState()
  const pageStates = state.pages
  const initialPageId = state.location
  const ids = pages.map((page) => page.id)
  const { accessible } = getSequentialAccess(ids, donePageIds(pages, pageStates))

  // The accessible pages, in document order: the completed prefix plus its
  // immediate first not-done successor. Filtering the ordered pages keeps list
  // positions aligned with the pages the learner can actually reach.
  const accessiblePages = pages.filter((page) => accessible.has(page.id))

  const loader = useContentLoader(contentProvider)
  const { isLoaded, request, ensure } = loader

  // The accessible pages of the *current* render, so an asynchronous Path jump
  // resolves its target index against the latest list without closing over a
  // stale array.
  const accessiblePagesRef = useRef(accessiblePages)
  accessiblePagesRef.current = accessiblePages

  // The reading position the list opens at, computed once on first mount and
  // handed to Virtuoso as its initial item: the accessible page named by the
  // saved lesson location, or the first accessible page when the location is
  // absent, unknown, or still locked. Captured before any later location change,
  // so a scroll or Path jump never repositions the list.
  const [initialIndex] = useState(() => {
    const index = accessiblePages.findIndex((page) => page.id === initialPageId)
    return index >= 0 ? index : 0
  })

  // The semantic current page starts at the restored item, so the first seen
  // report matches the restored location rather than overwriting it with page
  // zero.
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

  // The immediate next accessible page after the reading anchor, requested ahead
  // so it is already resolving before the learner reaches it. Only ever one page
  // ahead; the further tail is left to Virtuoso, which requests a page's module
  // when it mounts its slot. No scroll is issued here.
  const activeIndex = accessiblePages.findIndex((page) => page.id === activeId)
  const nextPage = activeIndex >= 0 ? accessiblePages[activeIndex + 1] : undefined
  const prefetchId = nextPage?.id ?? null
  useEffect(() => {
    if (prefetchId !== null) {
      request(prefetchId)
    }
  }, [prefetchId, request])

  // A Path jump to a referenced page. A locked page is ignored. The target's
  // module is ensured to be resolving first (a user-explicit load attempt that
  // also retries a failed prefetch), then the jump is an immediate
  // `scrollToIndex`, needing no mounted scene and no animation. A later jump
  // bumps the token, so a slower earlier target can never supersede a newer one.
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

  // The latest rendered window, with each item's measured offset and size from
  // the start of the list.
  const renderedItemsRef = useRef<readonly ListItem<unknown>[]>([])

  // The last list-relative scroll offset, or `null` before any scroll: only an
  // actual scroll establishes a position.
  const scrollTopRef = useRef<number | null>(null)

  // Whether a scroll arrived before the rendered items could resolve it, so the
  // next `itemsRendered` must reconcile it. It is set only when a scroll snapshot
  // cannot resolve against the currently rendered items, so a measurement-only
  // re-report (a lazy load changing offsets, with no scroll) never re-resolves a
  // stale scrollTop and moves the location.
  const pendingReconcileRef = useRef(false)

  // The actual window scroller handed over by Virtuoso's `scrollerRef`, held in
  // state so the passive listener is attached once it arrives.
  const [scroller, setScroller] = useState<EventTarget | null>(null)

  // Guards a snapshot that raced an unmount, or that a later scroll superseded.
  const mountedRef = useRef(true)
  const scrollTokenRef = useRef(0)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Resolve the semantic current page from a list-relative scroll offset. A
  // `null` resolution (the window has not caught up with this scroll yet) marks
  // one pending instead, leaving the location unchanged until the covering list
  // arrives. Kept in a ref so the single listener always calls the current
  // closure without being re-attached on every render.
  function applyScrollTop(scrollTop: number) {
    scrollTopRef.current = scrollTop
    const pageId = activePageIdAt(renderedItemsRef.current, scrollTop, accessiblePagesRef.current)
    if (pageId === null) {
      pendingReconcileRef.current = true
      return
    }
    pendingReconcileRef.current = false
    setActive(pageId)
  }
  const applyScrollTopRef = useRef(applyScrollTop)
  applyScrollTopRef.current = applyScrollTop

  // One passive listener on the real scroller. Each scroll reads the
  // list-relative scrollTop through Virtuoso's `getState` and resolves it against
  // the rendered items. No scrolling API is called here.
  useEffect(() => {
    if (scroller === null) {
      return
    }
    const onScroll = () => {
      const token = (scrollTokenRef.current += 1)
      virtuosoRef.current?.getState((snapshot) => {
        // A snapshot from a superseded scroll, or one delivered after unmount,
        // must not move the location.
        if (!mountedRef.current || token !== scrollTokenRef.current) {
          return
        }
        applyScrollTopRef.current(snapshot.scrollTop)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [scroller])

  // Refresh the rendered window. A render alone never moves the location: it is
  // reconciled only while a scroll is pending, so a page that merely mounts or a
  // lazy load that re-measures an offset cannot change it.
  function handleItemsRendered(items: ListItem<unknown>[]) {
    renderedItemsRef.current = items
    if (!pendingReconcileRef.current) {
      return
    }
    const scrollTop = scrollTopRef.current
    if (scrollTop === null) {
      return
    }
    const pageId = activePageIdAt(items, scrollTop, accessiblePagesRef.current)
    if (pageId === null) {
      return
    }
    pendingReconcileRef.current = false
    setActive(pageId)
  }

  if (pages.length === 0 || accessiblePages.length === 0) {
    return null
  }

  // The frontier of the sequential progression: the last accessible page. The
  // shared policy makes `accessiblePages` a prefix of `pages`, so the frontier's
  // document successor is locked exactly when the accessible run is shorter than
  // the document. The boundary notice then belongs at the bottom of the frontier
  // and disappears once completion unlocks the next page.
  const finalAccessibleIndex = accessiblePages.length - 1
  const nextAfterFinalLocked = accessiblePages.length < pages.length

  return (
    <div data-scroll-column className={PAGE_COLUMN}>
      <Virtuoso
        ref={virtuosoRef}
        useWindowScroll
        totalCount={accessiblePages.length}
        // The list opens at the restored reading position with no scripted
        // scroll; the index is a stable constant, so a later location change
        // never repositions the list.
        initialTopMostItemIndex={initialIndex}
        // Only a server-rendered shell (the app renders client-side) needs a
        // forced initial item; on the client Virtuoso opens at the initial index.
        initialItemCount={typeof window === 'undefined' ? 1 : undefined}
        // No overscan band and no increased viewport, so the rendered window is
        // not inflated; the exact page is resolved from the reported item offsets
        // and the list-relative scrollTop, not from the window's first item. No
        // custom height compensation is given, so pages keep their natural
        // measured heights and Virtuoso owns geometry.
        overscan={0}
        increaseViewportBy={0}
        computeItemKey={(index) => accessiblePages[index]?.id ?? index}
        // The exact semantic signal: every rendered item with its measured offset
        // and size from the start of the list.
        itemsRendered={handleItemsRendered}
        // The real window scroller, so the passive listener can read the
        // list-relative scrollTop from Virtuoso's own `getState`.
        scrollerRef={setScroller}
        itemContent={(index) => {
          const page = accessiblePages[index]
          if (page === undefined) {
            return null
          }
          return (
            <div data-scroll-item className={PAGE_ITEM}>
              <PageSlot
                page={page}
                index={index}
                contentLoader={loader}
                active={page.id === activeId}
                pathPages={pages}
                onNavigatePathPage={navigateToPageId}
                showLockedBoundary={index === finalAccessibleIndex && nextAfterFinalLocked}
              />
            </div>
          )
        }}
      />

      {/*
        The location only moves once the active page's content exists, so a page
        whose module is still resolving is never reported as seen — and the saved
        location is not transiently changed.
      */}
      <PageSeenReporter pageId={isLoaded(activeId) ? activeId : ''} />
    </div>
  )
}

/**
 * Stores the active page as the current location once per activation. The ref
 * holds the last reported id, so a genuine change reports again while
 * StrictMode's doubled effect for the same id is a no-op.
 */
function PageSeenReporter({ pageId }: { pageId: string }) {
  const onPageSeen = usePlayerActions().markSeen
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

/** Reports a page completion exactly once, guarding repeated callbacks and StrictMode. */
function PageCompletionReporter({ pageId, complete }: { pageId: string; complete: boolean }) {
  const onPageCompleted = usePlayerActions().markCompleted
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
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
  /** Whether the page after this one is still locked, so the boundary notice belongs here. */
  showLockedBoundary: boolean
}

/**
 * One mounted page in the virtualized document. Mounting requests the page's
 * module, so content loads exactly when Virtuoso needs it. The slot carries no
 * size of its own: its `PAGE_ITEM` padding is measured by Virtuoso as part of
 * the item height, so a loading or error slot spaces identically to loaded
 * content.
 */
function PageSlot({
  page,
  index,
  contentLoader,
  active,
  pathPages,
  onNavigatePathPage,
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
    <PageProvider pageId={page.id}>
      <PageScene
        page={page}
        index={index}
        nodes={contentLoader.content(page.id) ?? []}
        active={active}
        pathPages={pathPages}
        onNavigatePathPage={onNavigatePathPage}
        showLockedBoundary={showLockedBoundary}
      />
    </PageProvider>
  )
}

/**
 * The slot for an accessible page whose module is still loading: a small, static,
 * natural-height indication that never fakes a page's size. A visually hidden
 * status keeps the pending state available to assistive technology.
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
 * A page whose module failed to load: a small, natural-height slot offering a
 * single retry action rather than hiding the failure.
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
  /** Whether this is the page under the reading anchor; it never affects geometry. */
  active: boolean
  /** Root pages, so a Path on this page can resolve its references. */
  pathPages: readonly PageNode[]
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
  /** Whether the page after this one is still locked, so the boundary notice belongs here. */
  showLockedBoundary: boolean
}

/**
 * One page in the virtualized document. It keeps its natural content height, so
 * Virtuoso measures the rendered height and owns the surrounding geometry. Its
 * end sentinel is a completion signal only — the page completes once its end was
 * reached and every questionnaire it contains was submitted — and never
 * positions the list.
 */
function PageScene({
  page,
  index,
  nodes,
  active,
  pathPages,
  onNavigatePathPage,
  showLockedBoundary
}: PageSceneProps) {
  const state = usePlayerState()
  const pageState = state.pages[page.id]
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

  const complete = endReached && arePageQuestionnairesComplete(nodes, pageState)

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
            onNavigatePathPage={onNavigatePathPage}
          />
        </section>
      </div>

      <div ref={endRef} data-scroll-end={index} aria-hidden="true" className="h-px w-full" />

      {showLockedBoundary && endReached && !complete ? <LockedBoundary /> : null}

      <PageCompletionReporter pageId={page.id} complete={complete} />
    </div>
  )
}

/**
 * Marks that the page after the current one remains locked, without mounting or
 * revealing any locked content. A natural-height notice at the bottom of the
 * final accessible page.
 */
function LockedBoundary() {
  return (
    <div
      data-scroll-locked
      className="flex items-center justify-center gap-2 pt-6 text-muted-foreground"
    >
      <Lock aria-hidden="true" className="size-5" />
      <p className="text-sm">
        <FormattedMessage id="scroll.locked" />
      </p>
    </div>
  )
}
