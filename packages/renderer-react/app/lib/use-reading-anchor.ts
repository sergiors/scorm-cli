import { useEffect, useRef } from 'react'
import { resolveReadingAnchor, type PresentationScroller } from './reading-anchor-dom'

export interface ReadingAnchorTrackingOptions {
  pageId: string | undefined
  scroller: PresentationScroller
  enabled: boolean
  onChange: (anchor: string | null) => void
}

/**
 * Reports the anchor under the viewport through a passive scroll listener.
 * Page, enabled state and callback live in refs so the listener is attached
 * once per scroller; the session ignores unchanged anchors and persists only
 * actual transitions.
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
