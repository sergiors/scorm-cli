import { describe, expect, it } from 'vitest'
import { clampPageIndex } from '../../app/lib/sequence'

describe('clampPageIndex', () => {
  it('keeps an in-range index unchanged', () => {
    expect(clampPageIndex(0, 3)).toBe(0)
    expect(clampPageIndex(2, 3)).toBe(2)
  })

  it('clamps a negative or overflowing index into range', () => {
    expect(clampPageIndex(-1, 3)).toBe(0)
    expect(clampPageIndex(9, 3)).toBe(2)
  })

  it('falls back to the first page when there are no pages', () => {
    expect(clampPageIndex(4, 0)).toBe(0)
  })
})
