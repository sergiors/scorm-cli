import { useEffect, useRef } from 'react'
import { resolveReadingAnchor, type PresentationScroller } from './reading-anchor-dom'

export interface ReadingAnchorTrackingOptions {
  pageId: string | undefined
  scroller: PresentationScroller
  enabled: boolean
  onChange: (anchor: string | null) => void
}

/**
 * Keeps the latest reading anchor available without React state: a passive
 * scroll listener updates a callback ref only, so scrolling never commits or
 * persists anything. The page and callback live in refs so the listener is
 * attached once per scroller rather than re-created on every page change.
 */
export function useReadingAnchorTracking({
  pageId,
  scroller,
  enabled,
  onChange
}: ReadingAnchorTrackingOptions): void {
  const pageIdRef = useRef(pageId)
  const enabledRef = useRef(enabled)
  const onChangeRef = useRef(onChange)
  pageIdRef.current = pageId
  enabledRef.current = enabled
  onChangeRef.current = onChange

  useEffect(() => {
    if (scroller === null || typeof scroller.addEventListener !== 'function') {
      return
    }
    const onScroll = () => {
      if (!enabledRef.current || pageIdRef.current === undefined) {
        return
      }
      onChangeRef.current(resolveReadingAnchor(pageIdRef.current, scroller))
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [scroller])
}
