import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * How far ahead of the viewport media is allowed to mount. Positive margins on
 * every side start a provider player just before it scrolls in, so the heavy
 * iframe/player work never lands on first paint but the media is already ready
 * by the time it is actually seen.
 */
const MEDIA_ROOT_MARGIN = '200px 0px'

export interface MediaInView<T extends Element> {
  /** Attach to the element whose approach should mount the media. */
  ref: RefObject<T | null>
  /** Latches true once the element has approached the viewport. */
  inView: boolean
}

/**
 * A deliberately small, media-only "load on approach" latch. It observes one
 * element against the viewport with a positive root margin and disconnects as
 * soon as the element is seen, so the observer is used purely to defer mounting
 * heavy media — it never positions, measures or scrolls anything. Virtualization
 * stays owned by the page presentation (Virtuoso), not by this hook.
 *
 * When `IntersectionObserver` is unavailable (server/static rendering, or a
 * non-browser test environment) the media is considered in view immediately, so
 * content is never withheld where approach cannot be observed.
 */
export function useMediaInView<T extends Element>(): MediaInView<T> {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (inView) {
      return
    }
    const element = ref.current
    if (element === null || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      // `root: null` observes against the viewport, which is the document's
      // scroller in every presentation; a positive margin starts the load just
      // before the media enters it.
      { root: null, rootMargin: MEDIA_ROOT_MARGIN, threshold: 0 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView])

  return { ref, inView }
}
