import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isOutsideRelativePath, sourceLocation } from '../shared'

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

describe('isOutsideRelativePath', () => {
  it('distinguishes descendants from sibling paths sharing a prefix', () => {
    expect(isOutsideRelativePath('lesson.mdx')).toBe(false)
    expect(isOutsideRelativePath('../course-extra/lesson.mdx')).toBe(true)
  })

  it('treats the directory itself as inside and its parent as outside', () => {
    expect(isOutsideRelativePath('.')).toBe(false)
    expect(isOutsideRelativePath('..')).toBe(true)
  })

  it('treats an absolute path as outside', () => {
    expect(isOutsideRelativePath(path.resolve('/outside.mdx'))).toBe(true)
  })
})
