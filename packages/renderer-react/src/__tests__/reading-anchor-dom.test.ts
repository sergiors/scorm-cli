// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasReadingPage,
  invalidateReadingAnchorCache,
  resolveReadingAnchor,
  scrollToReadingPosition
} from '../../app/lib/reading-anchor-dom'

function rect(top: number, height = 40): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function anchor(pageId: string, id: string, top: number, height = 40): HTMLElement {
  const element = document.createElement('h2')
  element.setAttribute('data-reading-anchor', id)
  element.setAttribute('data-reading-anchor-page', pageId)
  element.getBoundingClientRect = () => rect(top, height)
  element.scrollIntoView = vi.fn()
  document.body.appendChild(element)
  return element
}

function page(pageId: string, top: number): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-reading-page', pageId)
  element.getBoundingClientRect = () => rect(top, 1000)
  element.scrollIntoView = vi.fn()
  document.body.appendChild(element)
  return element
}

beforeEach(() => {
  document.body.innerHTML = ''
  invalidateReadingAnchorCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveReadingAnchor', () => {
  it('returns the closest anchor whose top has passed the scroller top', () => {
    page('page:a.mdx', 0)
    anchor('page:a.mdx', 'first001', -80)
    anchor('page:a.mdx', 'second02', -10)
    anchor('page:a.mdx', 'third003', 30)

    expect(resolveReadingAnchor('page:a.mdx')).toBe('second02')
  })

  it('returns null while the page is still at its beginning', () => {
    page('page:a.mdx', 0)
    anchor('page:a.mdx', 'first001', 20)
    expect(resolveReadingAnchor('page:a.mdx')).toBeNull()
  })

  it('skips zero-height anchors and anchors owned by another page', () => {
    page('page:a.mdx', 0)
    anchor('page:a.mdx', 'hidden01', -60, 0)
    anchor('page:b.mdx', 'other001', -50)
    expect(resolveReadingAnchor('page:a.mdx')).toBeNull()
  })

  it('reuses anchors while a page is mounted and refreshes on page change or remount', () => {
    page('page:a.mdx', 0)
    const oldAnchor = anchor('page:a.mdx', 'old00001', -10)
    const queryAll = vi.spyOn(document, 'querySelectorAll')
    const countAnchorQueries = () =>
      queryAll.mock.calls.filter(([selector]) => selector === '[data-reading-anchor]').length

    expect(resolveReadingAnchor('page:a.mdx')).toBe('old00001')
    expect(resolveReadingAnchor('page:a.mdx')).toBe('old00001')
    expect(countAnchorQueries()).toBe(1)

    page('page:b.mdx', 0)
    anchor('page:b.mdx', 'pageb001', -5)
    expect(resolveReadingAnchor('page:b.mdx')).toBe('pageb001')
    expect(countAnchorQueries()).toBe(2)

    oldAnchor.remove()
    anchor('page:a.mdx', 'new00001', -8)
    invalidateReadingAnchorCache('page:a.mdx')
    expect(resolveReadingAnchor('page:a.mdx')).toBe('new00001')
    expect(countAnchorQueries()).toBe(3)
  })
})

describe('scrollToReadingPosition', () => {
  it('scrolls the matching anchor into view and reports it', () => {
    page('page:a.mdx', 100)
    const target = anchor('page:a.mdx', 'target01', 120)

    expect(scrollToReadingPosition('page:a.mdx', 'target01')).toBe('target01')
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it('scrolls the page wrapper for a page-only location or missing anchor', () => {
    const wrapper = page('page:a.mdx', 100)

    expect(scrollToReadingPosition('page:a.mdx', undefined)).toBeNull()
    expect(wrapper.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    vi.mocked(wrapper.scrollIntoView).mockClear()
    expect(scrollToReadingPosition('page:a.mdx', 'missing1')).toBeNull()
    expect(wrapper.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it('only targets an anchor owned by the requested page', () => {
    anchor('page:a.mdx', 'shared01', 120)
    const target = anchor('page:b.mdx', 'shared01', 120)
    page('page:b.mdx', 100)

    expect(scrollToReadingPosition('page:b.mdx', 'shared01')).toBe('shared01')
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it('reports whether the target page is mounted', () => {
    expect(hasReadingPage('page:a.mdx')).toBe(false)
    page('page:a.mdx', 0)
    expect(hasReadingPage('page:a.mdx')).toBe(true)
  })
})
