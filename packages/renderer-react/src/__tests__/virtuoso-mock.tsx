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
 * - it renders exactly a window of items (`scrollToIndex` and the test helper
 *   move the window's anchor), so only "needed" pages mount;
 * - it reports the window through `rangeChanged`, so the semantic current page
 *   is driven by the virtualizer's visible range;
 * - `initialTopMostItemIndex` seeds the window's anchor, so the presentation's
 *   startup position is observable (the reading presentation seeds it from the
 *   saved lesson location, falling back to zero);
 * - `scrollToIndex` is recorded, so explicit navigation is observable.
 *
 * The double is installed for a suite with
 * `vi.mock('react-virtuoso', () => import('./virtuoso-mock'))`.
 */
export interface ListRange {
  startIndex: number
  endIndex: number
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
  useWindowScroll?: boolean
  itemContent?: (index: number, data: unknown, context: unknown) => ReactNode
  computeItemKey?: (index: number, data: unknown, context: unknown) => string | number
  rangeChanged?: (range: ListRange) => void
}

interface VirtuosoController {
  /** How many items the fake renders starting at the anchor. Defaults to one. */
  visibleCount: number
  /** Every `scrollToIndex` the presentation issued, in order. */
  scrollToIndexCalls: VirtuosoScrollToIndexLocation[]
  /** The most recent props the presentation rendered the list with. */
  lastProps: VirtuosoProps | undefined
  /** The accessible item count the presentation last handed the virtualizer. */
  lastTotalCount(): number | undefined
  /** The initial index the presentation last handed the virtualizer, if numeric. */
  lastInitialIndex(): number | undefined
  /** Moves the rendered window's anchor, modelling a learner scroll. */
  setAnchor: ((index: number) => void) | undefined
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
  scrollToIndexCalls: [],
  lastProps: undefined,
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
  setAnchor: undefined,
  scrollToIndex: undefined,
  reset() {
    this.visibleCount = 1
    this.scrollToIndexCalls = []
    this.lastProps = undefined
    this.setAnchor = undefined
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

export const Virtuoso = forwardRef<VirtuosoHandle, VirtuosoProps>(function Virtuoso(props, ref) {
  const totalCount = props.totalCount ?? 0
  const [anchor, setAnchor] = useState(() => toIndex(props.initialTopMostItemIndex))

  // The latest props, so the range-change effect calls the current handler
  // without re-running on every render.
  const propsRef = useRef(props)
  propsRef.current = props
  const rangeChangedRef = useRef(props.rangeChanged)
  rangeChangedRef.current = props.rangeChanged

  useEffect(() => {
    virtuosoMock.lastProps = propsRef.current
  })

  // Expose the imperative handle: an explicit navigation moves the window and is
  // recorded, exactly as the real library would move the scroller.
  const scrollToIndex = useRef((location: VirtuosoScrollToIndexLocation) => {
    virtuosoMock.scrollToIndexCalls.push(location)
    setAnchor(clamp(toIndex(location), propsRef.current.totalCount ?? 0))
  }).current

  useImperativeHandle(ref, () => ({
    scrollToIndex,
    scrollTo() {},
    scrollBy() {},
    scrollIntoView() {},
    autoscrollToBottom() {},
    getState() {}
  }))

  // Register the test control surface, keeping it in step with the current
  // total count so a clamped anchor never points past the end.
  useEffect(() => {
    virtuosoMock.setAnchor = (index: number) => setAnchor(clamp(index, totalCount))
    virtuosoMock.scrollToIndex = scrollToIndex
    return () => {
      virtuosoMock.setAnchor = undefined
      virtuosoMock.scrollToIndex = undefined
    }
  }, [totalCount, scrollToIndex])

  const start = clamp(anchor, totalCount)
  const end =
    totalCount === 0 ? -1 : Math.min(start + virtuosoMock.visibleCount - 1, totalCount - 1)

  // Report the rendered range whenever it changes, modelling `rangeChanged`.
  useEffect(() => {
    if (totalCount === 0) {
      return
    }
    rangeChangedRef.current?.({ startIndex: start, endIndex: end })
  }, [start, end, totalCount])

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
