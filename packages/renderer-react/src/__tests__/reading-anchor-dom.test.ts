// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasReadingPage,
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
  document.body.appendChild(element)
  return element
}

function page(pageId: string, top: number): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-reading-page', pageId)
  element.getBoundingClientRect = () => rect(top, 1000)
  document.body.appendChild(element)
  return element
}

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
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
})

describe('scrollToReadingPosition', () => {
  it('moves the actual scroller to the saved anchor and reports it', () => {
    page('page:a.mdx', 100)
    anchor('page:a.mdx', 'target01', 120)

    expect(scrollToReadingPosition('page:a.mdx', 'target01')).toBe('target01')
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 620, behavior: 'auto' })
  })

  it('falls back to the page beginning for a missing anchor', () => {
    page('page:a.mdx', 100)

    expect(scrollToReadingPosition('page:a.mdx', 'missing1')).toBeNull()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' })
  })

  it('reports whether the target page is mounted', () => {
    expect(hasReadingPage('page:a.mdx')).toBe(false)
    page('page:a.mdx', 0)
    expect(hasReadingPage('page:a.mdx')).toBe(true)
  })
})
