import { describe, expect, it } from 'vitest'
import { sourceLocation } from '../shared'

describe('sourceLocation', () => {
  it('includes the known line and column', () => {
    expect(
      sourceLocation('lesson.mdx', {
        type: 'text',
        position: { start: { line: 8, column: 12 } }
      })
    ).toBe('lesson.mdx:8:12')
  })

  it('keeps the line when no column is available', () => {
    expect(sourceLocation('lesson.mdx', { type: 'text', position: { start: { line: 8 } } })).toBe(
      'lesson.mdx:8'
    )
  })

  it('returns the file when no source position is available', () => {
    expect(sourceLocation('lesson.mdx')).toBe('lesson.mdx')
  })
})
