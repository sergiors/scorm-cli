import {
  READING_ANCHOR_ATTRIBUTE,
  READING_ANCHOR_PAGE_ATTRIBUTE,
  READING_PAGE_ATTRIBUTE
} from './reading-anchors'

/** The actual scroller a presentation reads and restores against. */
export type PresentationScroller = Window | HTMLElement | null

function isWindowScroller(scroller: PresentationScroller): boolean {
  return scroller === null || scroller === window
}

function readScrollTop(scroller: PresentationScroller): number {
  if (isWindowScroller(scroller)) {
    return window.scrollY ?? document.documentElement.scrollTop ?? 0
  }
  return (scroller as HTMLElement).scrollTop
}

function readViewportTop(scroller: PresentationScroller): number {
  if (isWindowScroller(scroller)) {
    return 0
  }
  return (scroller as HTMLElement).getBoundingClientRect().top
}

function writeScrollTop(scroller: PresentationScroller, top: number): void {
  const next = Math.max(0, top)
  if (isWindowScroller(scroller)) {
    window.scrollTo({ top: next, behavior: 'auto' })
    return
  }
  const element = scroller as HTMLElement
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top: next, behavior: 'auto' })
  } else {
    element.scrollTop = next
  }
}

function anchorElements(pageId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${READING_ANCHOR_ATTRIBUTE}]`)).filter(
    (element) => element.getAttribute(READING_ANCHOR_PAGE_ATTRIBUTE) === pageId
  )
}

function pageElement(pageId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${READING_PAGE_ATTRIBUTE}]`)).find(
    (element) => element.getAttribute(READING_PAGE_ATTRIBUTE) === pageId
  )
}

/** Whether the page/item wrapper is mounted, so restoration can wait for it. */
export function hasReadingPage(pageId: string): boolean {
  return typeof document !== 'undefined' && pageElement(pageId) !== undefined
}

/**
 * The closest anchor whose top has passed the scroller's top edge. Zero-height
 * elements are skipped so an unmeasured or hidden block cannot become a false
 * reading position. Returns `null` when the page is still at its beginning.
 */
export function resolveReadingAnchor(
  pageId: string,
  scroller: PresentationScroller = window
): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const viewportTop = readViewportTop(scroller)
  let resolved: { id: string; top: number } | null = null
  for (const element of anchorElements(pageId)) {
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0) {
      continue
    }
    const top = rect.top - viewportTop
    if (top > 1) {
      continue
    }
    const id = element.getAttribute(READING_ANCHOR_ATTRIBUTE)
    if (id === null) {
      continue
    }
    if (resolved === null || top > resolved.top) {
      resolved = { id, top }
    }
  }
  return resolved?.id ?? null
}

/**
 * Restores a saved anchor inside the page that has actually been mounted and
 * loaded. A missing element falls back to the page beginning. The return value
 * is the anchor that was genuinely used (or `null` for that fallback), never the
 * requested one, so a stale saved anchor cannot survive restoration.
 */
export function scrollToReadingPosition(
  pageId: string,
  anchor: string | undefined,
  scroller: PresentationScroller = window
): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const container = pageElement(pageId)
  const target =
    anchor === undefined
      ? undefined
      : anchorElements(pageId).find(
          (element) => element.getAttribute(READING_ANCHOR_ATTRIBUTE) === anchor
        )
  const element = target ?? container
  if (element === undefined) {
    return null
  }
  const scrollTop = readScrollTop(scroller)
  const top = element.getBoundingClientRect().top - readViewportTop(scroller) + scrollTop
  writeScrollTop(scroller, top)
  return target === undefined ? null : (anchor ?? null)
}
