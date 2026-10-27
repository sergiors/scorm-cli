import { describe, expect, it } from 'vitest'
import {
  readingAnchorAt,
  readingAnchorAttributes,
  readingAnchorId,
  readingAnchorsForPage
} from '../../app/lib/reading-anchors'
import type { ContentNode } from '../../app/types'

const heading: ContentNode = {
  type: 'heading',
  depth: 2,
  children: [{ type: 'text', value: 'Welcome' }]
}

const paragraph: ContentNode = {
  type: 'paragraph',
  children: [{ type: 'text', value: 'Welcome' }]
}

const image: ContentNode = {
  type: 'image',
  src: './diagram.png',
  alt: 'Diagram'
}

const video: ContentNode = {
  type: 'video',
  id: 'video:lesson.mdx:4:1',
  provider: 'native',
  src: './clip.mp4'
}

const code: ContentNode = {
  type: 'code',
  language: 'ts',
  value: 'const answer = 42'
}

const questionnaire: ContentNode = {
  type: 'questionnaire',
  id: 'questionnaire:lesson.mdx:8:1',
  contributesToScore: false,
  maxAttempts: 1,
  questions: [
    {
      type: 'question',
      id: 'question:lesson.mdx:9:1',
      questionType: 'single-choice',
      prompt: 'Pick one',
      options: [
        { value: 'a', correct: true, content: 'A' },
        { value: 'b', correct: false, content: 'B' }
      ]
    }
  ]
}

describe('reading anchor IDs', () => {
  it('is deterministic and compact', () => {
    const first = readingAnchorId('page:a.mdx', paragraph)
    expect(readingAnchorId('page:a.mdx', paragraph)).toBe(first)
    expect(first).toMatch(/^[0-9a-z]{6,8}$/)
  })

  it('includes the block type even when the text is identical', () => {
    expect(readingAnchorId('page:a.mdx', heading)).not.toBe(
      readingAnchorId('page:a.mdx', paragraph)
    )
  })

  it('anchors every requested static block', () => {
    const nodes = [heading, paragraph, image, video, code, questionnaire]
    const anchors = readingAnchorsForPage('page:a.mdx', nodes)
    expect([...anchors.values()]).toHaveLength(6)
    expect(new Set([...anchors.values()].map((anchor) => anchor.id)).size).toBe(6)
  })

  it('anchors blocks of the same type only when their content differs', () => {
    const altered: ContentNode = {
      type: 'heading',
      depth: 2,
      children: [{ type: 'text', value: 'Changed' }]
    }
    const first = readingAnchorId('page:a.mdx', heading)
    expect(readingAnchorId('page:a.mdx', altered)).not.toBe(first)
    expect(readingAnchorId('page:a.mdx', heading)).toBe(first)
  })

  it('hashes authoring line endings identically so republish never orphans a save', () => {
    const crlf: ContentNode = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'one\r\ntwo' }]
    }
    const lf: ContentNode = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'one\ntwo' }]
    }
    expect(readingAnchorId('page:a.mdx', crlf)).toBe(readingAnchorId('page:a.mdx', lf))
  })

  it('refuses to generate an anchor for blocks without a stable authored identity', () => {
    const unanchorable: ContentNode[] = [
      { type: 'list', ordered: false, items: [] },
      { type: 'quote', children: [] },
      { type: 'thematicBreak' },
      { type: 'path', pageIds: [] }
    ]
    for (const node of unanchorable) {
      expect(() => readingAnchorId('page:a.mdx', node)).toThrow(/cannot own a reading anchor/)
    }
  })

  it('gives duplicate authored blocks distinct, stable IDs', () => {
    const anchors = readingAnchorsForPage('page:a.mdx', [paragraph, paragraph])
    expect(anchors.get('0')?.id).not.toBe(anchors.get('1')?.id)
    expect(readingAnchorsForPage('page:a.mdx', [paragraph, paragraph])).toEqual(anchors)
  })

  it('resolves intra-page hash collisions with the same deterministic salt', () => {
    const hash = (seed: string) => {
      const salt = seed.split('\u0000')[3]
      return salt === undefined ? 'deadbeef' : `salt${salt.padStart(4, '0')}`
    }
    const nodes = [paragraph, heading]
    const anchors = readingAnchorsForPage('page:a.mdx', nodes, hash)

    expect([...anchors.values()].map((anchor) => anchor.id)).toEqual(['deadbeef', 'salt0001'])
    expect(readingAnchorsForPage('page:a.mdx', nodes, hash)).toEqual(anchors)
  })

  it('keeps identical content distinct across concurrently mounted pages', () => {
    const first = readingAnchorsForPage('page:a.mdx', [paragraph]).get('0')?.id
    const second = readingAnchorsForPage('page:b.mdx', [paragraph]).get('0')?.id
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
  })

  it('ignores list items but keeps blocks nested in a quote', () => {
    const nestedHeading: ContentNode = {
      type: 'heading',
      depth: 3,
      children: [{ type: 'text', value: 'Quoted' }]
    }
    const nodes: ContentNode[] = [
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Inside item' }] }]
          }
        ]
      },
      { type: 'quote', children: [nestedHeading] }
    ]
    const anchors = readingAnchorsForPage('page:a.mdx', nodes)
    expect(anchors.has('0')).toBe(false)
    expect(anchors.has('1')).toBe(false)
    expect(readingAnchorAt(anchors, [1, 0])?.pageId).toBe('page:a.mdx')
  })

  it('exposes the DOM attributes for a rendered block', () => {
    expect(readingAnchorAttributes({ id: 'abc12345', pageId: 'page:a.mdx' })).toEqual({
      id: 'reading-0070006100670065003a0061002e006d00640078-abc12345',
      'data-reading-anchor': 'abc12345',
      'data-reading-anchor-page': 'page:a.mdx'
    })
    expect(readingAnchorAttributes(undefined)).toEqual({})
  })
})
