import {
  createContext,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from 'react'

/**
 * A deterministic test double for the small slice of React Virtuoso the reading
 * presentation uses. The real library virtualizes against measured DOM geometry,
 * which jsdom cannot provide, so this double models the parts that matter to the
 * presentation's semantics:
 *
 * - it renders exactly a window of items and reports it through `itemsRendered`,
 *   each item carrying its `index`, `offset` and `size` — all in pixels from the
 *   start of the list, exactly as the real library reports them;
 * - it reports the list-relative scroll offset through `getState`, matching the
 *   real window-scroll mode where the offset is measured from the list's own
 *   document offset (see the installed source: `getState` computes `scrollTop =
 *   windowScrollContainerState.scrollTop - windowViewportRect.offsetTop`);
 * - it hands the window scroller to `scrollerRef`, so the presentation's single
 *   passive listener is attached to the same object a test dispatches `scroll`
 *   on;
 * - `rangeChanged` is reported as a *gated* signal whose first item can lag above
 *   the viewport top and jump over a short item, mirroring the real library's
 *   gated range. The presentation no longer consumes it, but recording it lets a
 *   test show the exact tracker does not depend on it;
 * - `initialTopMostItemIndex` seeds the window's scroll offset, so the
 *   presentation's startup position is observable (the reading presentation seeds
 *   it from the saved lesson location, falling back to zero);
 * - `scrollToIndex` is recorded and moves the scroll offset, so explicit
 *   navigation is observable;
 * - `measure` changes every item's measured size and re-reports `itemsRendered`
 *   with the new offsets *without* dispatching a scroll, so a measurement-only
 *   event — a lazy load changing item geometry — can be shown not to move the
 *   location.
 *
 * Item sizes default to `itemHeight` for every index and can be overridden per
 * index with `itemHeights`, so variable-height pages can be modelled. The
 * viewport is `visibleCount * itemHeight` tall.
 *
 * The double is installed for a suite with
 * `vi.mock('react-virtuoso', () => import('./virtuoso-mock'))`.
 */
export interface ListRange {
  startIndex: number
  endIndex: number
}

/** A rendered item, with its measured geometry from the start of the list. */
export interface ListItem {
  index: number
  offset: number
  size: number
}

export type VirtuosoScrollToIndexLocation =
  | number
  | {
      index: number | 'LAST'
      align?: 'start' | 'center' | 'end' | 'auto'
      behavior?: 'auto' | 'smooth'
      offset?: number
    }

export interface VirtuosoHandle {
  scrollToIndex(location: VirtuosoScrollToIndexLocation): void
  scrollTo(location: ScrollToOptions): void
  scrollBy(location: ScrollToOptions): void
  scrollIntoView(location: unknown): void
  autoscrollToBottom(): void
  getState(callback: (snapshot: unknown) => void): void
}

interface VirtuosoProps {
  totalCount?: number
  initialTopMostItemIndex?: number | { index: number | 'LAST' }
  initialItemCount?: number
  defaultItemHeight?: number
  heightEstimates?: number[]
  fixedItemHeight?: number
  overscan?: number | { main: number; reverse: number }
  increaseViewportBy?: number | { top: number; bottom: number }
  useWindowScroll?: boolean
  itemContent?: (index: number, data: unknown, context: unknown) => ReactNode
  computeItemKey?: (index: number, data: unknown, context: unknown) => string | number
  itemsRendered?: (items: ListItem[]) => void
  rangeChanged?: (range: ListRange) => void
  scrollerRef?: (ref: HTMLElement | null | Window) => unknown
}

interface VirtuosoController {
  /** How many items the viewport is tall. Defaults to one. */
  visibleCount: number
  /** Whether initialTopMostItemIndex is applied after Virtuoso's four-frame delay. */
  deferInitialPositioning: boolean
  /** Whether the deferred initial position has been applied. */
  initialPositionApplied: boolean
  /** Every `scrollToIndex` the presentation issued, in order. */
  scrollToIndexCalls: VirtuosoScrollToIndexLocation[]
  /** Every `rangeChanged` the double reported, in order (the gated signal). */
  rangeChangedCalls: ListRange[]
  /** The most recent props the presentation rendered the list with. */
  lastProps: VirtuosoProps | undefined
  /** Per-item pixel sizes; any index without an entry falls back to `itemHeight`. */
  itemHeights: number[] | undefined
  /** The default per-item pixel size. */
  itemHeight: number
  /** The current list-relative scroll offset (the top of the viewport). */
  scrollTop: number
  /** The accessible item count the presentation last handed the virtualizer. */
  lastTotalCount(): number | undefined
  /** The initial index the presentation last handed the virtualizer, if numeric. */
  lastInitialIndex(): number | undefined
  /** The pixel offset of an item from the start of the list. */
  offsetOfIndex(index: number): number
  /** Imperatively scrolls to a pixel offset, modelling a learner scroll. */
  scrollToOffset: ((offset: number) => void) | undefined
  /**
   * Re-measures every item with new pixel sizes and re-reports `itemsRendered`
   * with the changed offsets — with no scroll, modelling a lazy load or a
   * content change that only alters item geometry.
   */
  measure: ((heights: number[]) => void) | undefined
  /** Imperatively scrolls to an item, modelling an explicit navigation. */
  scrollToIndex: ((location: VirtuosoScrollToIndexLocation) => void) | undefined
  reset(): void
}

/**
 * The control surface tests use to drive and observe the double. It is reset by
 * the suite's `beforeEach` so no state leaks between tests.
 */
export const virtuosoMock: VirtuosoController = {
  visibleCount: 1,
  deferInitialPositioning: false,
  initialPositionApplied: false,
  scrollToIndexCalls: [],
  rangeChangedCalls: [],
  lastProps: undefined,
  itemHeights: undefined,
  itemHeight: 1000,
  scrollTop: 0,
  lastTotalCount() {
    return this.lastProps?.totalCount
  },
  lastInitialIndex() {
    const initial = this.lastProps?.initialTopMostItemIndex
    if (typeof initial === 'number') {
      return initial
    }
    if (initial && initial.index !== 'LAST') {
      return initial.index
    }
    return undefined
  },
  offsetOfIndex(index) {
    return offsetOfIndex(index)
  },
  scrollToOffset: undefined,
  measure: undefined,
  scrollToIndex: undefined,
  reset() {
    this.visibleCount = 1
    this.deferInitialPositioning = false
    this.initialPositionApplied = false
    this.scrollToIndexCalls = []
    this.rangeChangedCalls = []
    this.lastProps = undefined
    this.itemHeights = undefined
    this.itemHeight = 1000
    this.scrollTop = 0
    this.scrollToOffset = undefined
    this.measure = undefined
    this.scrollToIndex = undefined
  }
}

function toIndex(location: VirtuosoScrollToIndexLocation | undefined): number {
  if (location === undefined || location === null) {
    return 0
  }
  if (typeof location === 'number') {
    return location
  }
  return location.index === 'LAST' ? Number.MAX_SAFE_INTEGER : location.index
}

function clamp(index: number, totalCount: number): number {
  if (totalCount <= 0) {
    return 0
  }
  return Math.max(0, Math.min(totalCount - 1, index))
}

/** The pixel size of an item, falling back to the default item height. */
function sizeAt(index: number): number {
  return virtuosoMock.itemHeights?.[index] ?? virtuosoMock.itemHeight
}

/** The pixel offset of an item from the start of the list. */
function offsetOfIndex(index: number): number {
  let offset = 0
  for (let i = 0; i < index; i += 1) {
    offset += sizeAt(i)
  }
  return offset
}

/** The pixel height of the whole list. */
function totalHeight(count: number): number {
  let total = 0
  for (let i = 0; i < count; i += 1) {
    total += sizeAt(i)
  }
  return total
}

/** The pixel height of the viewport. */
function viewportHeight(): number {
  return virtuosoMock.visibleCount * virtuosoMock.itemHeight
}

/** The greatest list-relative scroll offset, so the last item stays reachable. */
function maxScrollOffset(count: number): number {
  return Math.max(0, totalHeight(count) - viewportHeight())
}

/** The items whose span intersects the viewport, in document order. */
function renderedWindow(scrollTop: number, count: number): { start: number; end: number } {
  if (count <= 0) {
    return { start: 0, end: -1 }
  }
  const bottom = scrollTop + viewportHeight()
  let start = -1
  let end = -1
  for (let i = 0; i < count; i += 1) {
    const offset = offsetOfIndex(i)
    const size = sizeAt(i)
    if (offset + size > scrollTop && offset < bottom) {
      if (start === -1) {
        start = i
      }
      end = i
    }
  }
  if (start === -1) {
    // Nothing overlaps the viewport (e.g. scrolled past the end): pin to the
    // nearest item so a window is always reported.
    const last = count - 1
    return { start: last, end: last }
  }
  return { start, end }
}

/**
 * The *gated* range's first item. It advances only once the viewport top has
 * passed the current first item's bottom, then jumps straight to the item that
 * now contains the viewport top — so an item shorter than the step is skipped as
 * the range's first item, exactly as the real library's gated range can. The
 * exact tracker does not read this; it exists so a test can show the difference.
 */
function gatedRangeStart(previous: number, scrollTop: number, count: number): number {
  if (count <= 0) {
    return 0
  }
  const first = clamp(previous, count)
  if (scrollTop > offsetOfIndex(first) + sizeAt(first)) {
    for (let i = 0; i < count; i += 1) {
      if (offsetOfIndex(i) + sizeAt(i) > scrollTop) {
        return i
      }
    }
    return count - 1
  }
  return first
}

export const Virtuoso = forwardRef<VirtuosoHandle, VirtuosoProps>(function Virtuoso(props, ref) {
  const totalCount = props.totalCount ?? 0

  // The latest props, so the imperative handle and effects call the current
  // values without being re-created on every render.
  const propsRef = useRef(props)
  propsRef.current = props

  // The object handed to `scrollerRef`, so an imperative scroll can dispatch the
  // `scroll` event a real scroller would fire.
  const scrollerRef = useRef<EventTarget | null>(null)

  // The list-relative scroll offset. Seeded from `initialTopMostItemIndex`, so
  // the presentation's startup position is observable, then moved by scrolls and
  // imperative navigation.
  const [scrollTop, setScrollTop] = useState(() => {
    const index = clamp(toIndex(props.initialTopMostItemIndex), totalCount)
    return virtuosoMock.deferInitialPositioning
      ? 0
      : Math.min(offsetOfIndex(index), maxScrollOffset(totalCount))
  })

  // A re-measurement re-report: it bumps this version so the `itemsRendered`
  // effect re-runs with the new offsets even when the window's bounds and the
  // scroll offset are unchanged. It never dispatches a scroll.
  const [measurementVersion, setMeasurementVersion] = useState(0)

  // Keep the observable scroll offset in step for `getState`.
  useEffect(() => {
    virtuosoMock.scrollTop = scrollTop
  }, [scrollTop])

  const scrollToOffsetRef = useRef((offset: number) => {
    const count = propsRef.current.totalCount ?? 0
    const clamped = Math.min(Math.max(offset, 0), maxScrollOffset(count))
    // The observable offset is set first, then the `scroll` event is dispatched:
    // the presentation's listener reads `getState` while the rendered items are
    // still the previous window, modelling the real async re-render and forcing
    // the safe reconcile path. The window then updates and reports the new items.
    virtuosoMock.scrollTop = clamped
    scrollerRef.current?.dispatchEvent(new Event('scroll'))
    setScrollTop(clamped)
  }).current

  const scrollToIndex = useRef((location: VirtuosoScrollToIndexLocation) => {
    virtuosoMock.scrollToIndexCalls.push(location)
    const count = propsRef.current.totalCount ?? 0
    const index = clamp(toIndex(location), count)
    scrollToOffsetRef(offsetOfIndex(index))
  }).current

  // Model Virtuoso v4.18.19's deferred initialTopMostItemIndex positioning, which
  // waits four animation frames before issuing its initial scrollToIndex.
  useEffect(() => {
    if (!virtuosoMock.deferInitialPositioning) {
      return
    }
    let frames = 0
    let frame = 0
    const applyInitialPosition = () => {
      frames += 1
      if (frames < 4) {
        frame = requestAnimationFrame(applyInitialPosition)
        return
      }
      virtuosoMock.initialPositionApplied = true
      const index = clamp(toIndex(propsRef.current.initialTopMostItemIndex), propsRef.current.totalCount ?? 0)
      scrollToOffsetRef(offsetOfIndex(index))
    }
    frame = requestAnimationFrame(applyInitialPosition)
    return () => cancelAnimationFrame(frame)
  }, [scrollToOffsetRef])

  // Change every item's measured size and force an `itemsRendered` re-report,
  // without dispatching a scroll: a measurement-only event, as a lazy load or a
  // content change would produce.
  const measureRef = useRef((heights: number[]) => {
    virtuosoMock.itemHeights = heights
    setMeasurementVersion((version) => version + 1)
  }).current

  useImperativeHandle(ref, () => ({
    scrollToIndex,
    scrollTo() {},
    scrollBy() {},
    scrollIntoView() {},
    autoscrollToBottom() {},
    getState(callback: (snapshot: unknown) => void) {
      callback({ ranges: [], scrollTop: virtuosoMock.scrollTop })
    }
  }))

  // Register the test control surface.
  useEffect(() => {
    virtuosoMock.scrollToOffset = scrollToOffsetRef
    virtuosoMock.measure = measureRef
    virtuosoMock.scrollToIndex = scrollToIndex
    return () => {
      virtuosoMock.scrollToOffset = undefined
      virtuosoMock.measure = undefined
      virtuosoMock.scrollToIndex = undefined
    }
  }, [scrollToOffsetRef, measureRef, scrollToIndex])

  // Hand the window scroller to the presentation, then clear it on unmount.
  useEffect(() => {
    const target: EventTarget = window
    scrollerRef.current = target
    props.scrollerRef?.(target as Window)
    return () => {
      scrollerRef.current = null
      props.scrollerRef?.(null)
    }
  }, [props.scrollerRef])

  const rendered = renderedWindow(scrollTop, totalCount)
  const start = rendered.start
  const end = rendered.end

  // The gated range's first item, computed idempotently (re-running after it has
  // advanced does not advance it further).
  const rangeStartRef = useRef(0)
  const rangeStart = gatedRangeStart(rangeStartRef.current, scrollTop, totalCount)
  rangeStartRef.current = rangeStart

  // Report the exact rendered items whenever the window or the offset changes,
  // and again on a measurement-only re-report.
  const itemsRenderedRef = useRef(props.itemsRendered)
  itemsRenderedRef.current = props.itemsRendered
  useEffect(() => {
    if (totalCount === 0) {
      return
    }
    const items: ListItem[] = []
    for (let index = start; index <= end; index += 1) {
      items.push({ index, offset: offsetOfIndex(index), size: sizeAt(index) })
    }
    itemsRenderedRef.current?.(items)
  }, [start, end, scrollTop, totalCount, measurementVersion])

  // Record the gated range the old first-item signal would have reported.
  const rangeChangedRef = useRef(props.rangeChanged)
  rangeChangedRef.current = props.rangeChanged
  useEffect(() => {
    if (totalCount === 0) {
      return
    }
    const range = { startIndex: rangeStart, endIndex: end }
    virtuosoMock.rangeChangedCalls.push(range)
    rangeChangedRef.current?.(range)
  }, [rangeStart, end, totalCount])

  // Keep the most recent props observable for assertions.
  useEffect(() => {
    virtuosoMock.lastProps = propsRef.current
  })

  const items: ReactNode[] = []
  for (let index = start; index <= end; index += 1) {
    items.push(
      <div
        key={props.computeItemKey?.(index, undefined, undefined) ?? index}
        data-item-index={index}
      >
        {props.itemContent?.(index, undefined, undefined)}
      </div>
    )
  }

  return <div data-virtuoso-mock>{items}</div>
})

/** Present for API compatibility; the presentation does not use it. */
export const VirtuosoMockContext = createContext<
  { viewportHeight: number; itemHeight: number } | undefined
>(undefined)
