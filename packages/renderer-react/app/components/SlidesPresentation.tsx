import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ContentNode, PageNode } from '../types'
import { getSequentialAccess } from '../lib/content-helpers'
import { useContentLoader, type ContentProvider } from '../lib/content-loader'
import { PageProvider, usePlayerActions, usePlayerState } from '../lib/player-context'
import { arePageQuestionnairesComplete } from '../lib/questionnaire-finalization'
import { clampPageIndex } from '../lib/sequence'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { ContentLoadError } from './ContentLoadError'
import { ContentRenderer } from './ContentRenderer'

/**
 * The single shared column framing a slide's content: one responsive width and
 * horizontal padding, identical to the Scroll presentation's reading column, so
 * both presentations read with the same gutters.
 */
const PAGE_COLUMN = 'mx-auto w-full max-w-3xl px-4 sm:px-6'

/**
 * The vertical spacing around a slide's content, matching the Scroll
 * presentation's page slot so a slide keeps the same rhythm.
 */
const PAGE_ITEM = 'py-4 sm:py-6'

/**
 * The full-viewport slot framing a slide. It keeps the slide's shared column
 * centred on both axes; below `md` it reserves the fixed bottom nav's height
 * plus the device safe-area inset, and at `md` and up it narrows its content box
 * by the fixed edge rails' width (56px each side) so the centred column clears
 * them. Both clearances live here, never on the shared column, so the column's
 * own responsive padding stays exactly the Scroll column's.
 */
const SLIDE_SLOT =
  'flex min-h-dvh w-full flex-col justify-center md:px-14 max-md:pb-[calc(3rem_+_env(safe-area-inset-bottom))]'

/** The nodes whose own completion rule has been met, which advance the done prefix. */
function donePageIds(
  pages: readonly PageNode[],
  pageStates: Record<string, { completed?: boolean }>
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
export function SlidesPresentation({ pages, contentProvider }: SlidesPresentationProps) {
  const playerState = usePlayerState()
  const pageStates = playerState.pages
  const ids = pages.map((page) => page.id)
  const { accessible } = getSequentialAccess(ids, donePageIds(pages, pageStates))
  const { content, isLoaded, hasError, request, retry } = useContentLoader(contentProvider)

  const [currentIndex, setCurrentIndex] = useState(() => {
    const restoredIndex = pages.findIndex((page) => page.id === playerState.location)
    const requested = clampPageIndex(restoredIndex >= 0 ? restoredIndex : 0, pages.length)
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
  const pageComplete = arePageQuestionnairesComplete(currentPage.content, pageState)
  const hasNext = currentIndex < pages.length - 1
  const hasPrevious = currentIndex > 0
  const showNext = hasNext && pageComplete && loaded

  return (
    <>
      {/*
        Both controls share one responsive nav, so there is no second copy of
        the navigation. Below `md` it is a fixed, chrome-free bottom row —
        previous left, next right — that stays put while the document scrolls.
        Each control is a compact pill: its arrow plus a visible text label, so
        the two fit the row without a full-width bar. The row itself stays
        `pointer-events-none` (its own box adds nothing), so the space between
        and around the pills is inert and the page shows through; the pills stay
        `pointer-events-auto`. The row's bottom padding carries the device's
        safe-area inset. At `md` and up the box drops out of layout
        (`md:contents`) and each control becomes its own narrow, full-height
        edge rail.
      */}
      {hasPrevious || showNext ? (
        <nav
          data-slides-nav
          className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:contents"
        >
          {hasPrevious ? <PreviousControl onClick={() => goToPage(currentIndex - 1)} /> : null}
          {showNext ? <NextControl onClick={() => goToPage(currentIndex + 1)} /> : null}
        </nav>
      ) : null}

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
          onNavigatePathPage={navigateToPageId}
        />
      )}

      {/*
        The displayed page is only stored as the location (and reported complete)
        once its content exists, so a slide whose module is still resolving is
        never shown as seen and the location never lands on an unseen page.
      */}
      {loaded ? (
        <>
          <PageSeenReporter pageId={currentPage.id} />
          <PageCompletionReporter pageId={currentPage.id} complete={pageComplete} />
        </>
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
function PageSeenReporter({ pageId }: { pageId: string }) {
  const onPageSeen = usePlayerActions().markSeen
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

interface PageSceneProps {
  page: PageNode
  index: number
  /** The slide's resolved content nodes (lazily loaded). */
  nodes: ContentNode[]
  /** Root pages, so a Path on this page can resolve its references. */
  pathPages: readonly PageNode[]
  /** Opens a referenced page through the presentation's switching. */
  onNavigatePathPage: (pageId: string) => void
}

/** The single displayed slide, full-height so it fills the viewport. The slot
 * clears the fixed edge rails and the mobile bottom nav; the shared column then
 * applies the same responsive gutters and vertical spacing as Scroll. */
function PageScene({ page, index, nodes, pathPages, onNavigatePathPage }: PageSceneProps) {
  return (
    <PageProvider pageId={page.id}>
      <div data-scene-index={index} aria-label={page.metadata.title} className={SLIDE_SLOT}>
        <div className={`${PAGE_COLUMN} ${PAGE_ITEM}`}>
          <section className="prose prose-stone max-w-none! dark:prose-invert">
            <ContentRenderer
              nodes={nodes}
              pathPages={pathPages}
              onNavigatePathPage={onNavigatePathPage}
            />
          </section>
        </div>
      </div>
    </PageProvider>
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
    <div data-slide-loading aria-hidden="true" className={SLIDE_SLOT}>
      <div className={`${PAGE_COLUMN} ${PAGE_ITEM}`}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
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
    <div data-slide-error className={SLIDE_SLOT}>
      <div className={`${PAGE_COLUMN} ${PAGE_ITEM} flex flex-col items-start gap-3`}>
        <ContentLoadError onRetry={onRetry} />
      </div>
    </div>
  )
}

function PreviousControl({ onClick }: { onClick: () => void }) {
  const intl = useIntl()

  return (
    <div data-slides-previous className="pointer-events-none mr-auto md:contents">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={intl.formatMessage({ id: 'slides.previousPage' })}
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full md:fixed md:top-1/2 md:left-4 md:z-10"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
    </div>
  )
}

function NextControl({ onClick }: { onClick: () => void }) {
  const intl = useIntl()

  return (
    <div data-slides-next className="pointer-events-none ml-auto md:contents">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={intl.formatMessage({ id: 'slides.continueNextPage' })}
        onClick={onClick}
        className="pointer-events-auto cursor-pointer rounded-full md:fixed md:top-1/2 md:right-4 md:z-10"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}
