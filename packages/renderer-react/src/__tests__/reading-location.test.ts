import { describe, expect, it } from 'vitest'
import type { ContentPackage, PlayerState } from '../../app/types'
import {
  decodeReadingLocation,
  encodeReadingLocation,
  persistablePlayerState
} from '../../app/lib/reading-location'
import { sanitizePlayerState } from '../../app/lib/player-state'

const contentPackage: ContentPackage = {
  metadata: { title: 'Anchors' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:one.mdx',
        source: 'one.mdx',
        metadata: { title: 'One' },
        content: []
      },
      {
        type: 'page',
        id: 'page:two.mdx',
        source: 'two.mdx',
        metadata: { title: 'Two' },
        content: []
      }
    ]
  }
}

describe('reading location codec', () => {
  it('keeps a legacy page-only location unchanged', () => {
    expect(encodeReadingLocation('page:one.mdx')).toBe('page:one.mdx')
    expect(decodeReadingLocation('page:one.mdx')).toEqual({ location: 'page:one.mdx' })
  })

  it('encodes and decodes an anchor after the semantic page ID', () => {
    const value = encodeReadingLocation('page:one.mdx', 'abc12345')
    expect(value).toBe('page:one.mdx#abc12345')
    expect(decodeReadingLocation(value)).toEqual({
      location: 'page:one.mdx',
      anchor: 'abc12345'
    })
  })

  it('drops a malformed anchor but keeps the page ID', () => {
    expect(decodeReadingLocation('page:one.mdx#bad anchor')).toEqual({
      location: 'page:one.mdx'
    })
    expect(decodeReadingLocation('page:one.mdx#')).toEqual({ location: 'page:one.mdx' })
  })

  it('splits on the final separator so an authored page ID may contain #', () => {
    const value = encodeReadingLocation('page#one.mdx', 'abc12345')
    expect(value).toBe('page#one.mdx#abc12345')
    expect(decodeReadingLocation(value)).toEqual({
      location: 'page#one.mdx',
      anchor: 'abc12345'
    })
  })

  it('encodes and decodes anchors of exactly six to eight base-36 characters', () => {
    expect(decodeReadingLocation('page:a.mdx#abc123')).toEqual({
      location: 'page:a.mdx',
      anchor: 'abc123'
    })
    expect(decodeReadingLocation('page:a.mdx#0000000z')).toEqual({
      location: 'page:a.mdx',
      anchor: '0000000z'
    })
  })

  it('treats any other shape behind the separator as part of the page ID', () => {
    expect(decodeReadingLocation('page:a.mdx#abc12')).toEqual({ location: 'page:a.mdx' })
    expect(decodeReadingLocation('page:a.mdx#abc123456')).toEqual({ location: 'page:a.mdx' })
    expect(decodeReadingLocation('page:a.mdx#ABC12345')).toEqual({ location: 'page:a.mdx' })
    expect(decodeReadingLocation('page:a.mdx#abc-1234')).toEqual({ location: 'page:a.mdx' })
  })
})

describe('sanitizePlayerState reading location', () => {
  it('restores the semantic page and anchor from an encoded location', () => {
    const state = sanitizePlayerState(contentPackage, {
      location: 'page:two.mdx#abc12345',
      pages: {}
    })
    expect(state).toEqual({
      location: 'page:two.mdx',
      anchor: 'abc12345',
      pages: {}
    })
  })

  it('still accepts a page-only location', () => {
    expect(
      sanitizePlayerState(contentPackage, {
        location: 'page:two.mdx',
        pages: {}
      })
    ).toEqual({ location: 'page:two.mdx', pages: {} })
  })

  it('drops an encoded location whose page no longer exists', () => {
    expect(
      sanitizePlayerState(contentPackage, {
        location: 'page:gone.mdx#abc12345',
        pages: {}
      })
    ).toEqual({ pages: {} })
  })

  it('accepts a separate anchor field for forward compatibility', () => {
    expect(
      sanitizePlayerState(contentPackage, {
        location: 'page:two.mdx',
        anchor: 'abc12345',
        pages: {}
      })
    ).toEqual({ location: 'page:two.mdx', anchor: 'abc12345', pages: {} })
  })

  it('ignores a separate anchor field whose value is not an anchor ID', () => {
    expect(
      sanitizePlayerState(contentPackage, {
        location: 'page:two.mdx',
        anchor: 'not-an-anchor',
        pages: {}
      })
    ).toEqual({ location: 'page:two.mdx', pages: {} })
  })

  it('restores the page when an embedded anchor is malformed and drops it', () => {
    expect(
      sanitizePlayerState(contentPackage, {
        location: 'page:two.mdx#nope',
        pages: {}
      })
    ).toEqual({ location: 'page:two.mdx', pages: {} })
  })
})

describe('persistablePlayerState', () => {
  it('folds the latest matching anchor into the location', () => {
    const state: PlayerState = { location: 'page:one.mdx', pages: {} }
    const saved = persistablePlayerState(state, {
      pageId: 'page:one.mdx',
      anchor: 'abc12345'
    })
    expect(saved).toEqual({ location: 'page:one.mdx#abc12345', pages: {} })
    expect(Object.keys(saved).sort()).toEqual(['location', 'pages'])
    expect(state.location).toBe('page:one.mdx')
  })

  it('never carries a stale anchor from another page', () => {
    const state: PlayerState = {
      location: 'page:two.mdx',
      anchor: 'abc12345',
      pages: {}
    }
    expect(persistablePlayerState(state, { pageId: 'page:one.mdx', anchor: 'def67890' })).toEqual({
      location: 'page:two.mdx',
      pages: {}
    })
  })

  it('preserves the semantic location for a legacy page-only state', () => {
    const state: PlayerState = { location: 'page:one.mdx', pages: {} }
    expect(persistablePlayerState(state, { pageId: 'page:one.mdx' })).toBe(state)
  })
})
