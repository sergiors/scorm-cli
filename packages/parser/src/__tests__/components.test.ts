import { describe, expect, it } from 'vitest'
import type { AstNode, MdxJsxTextElementAstNode } from '../ast'
import {
  authoringComponentNames,
  hasComponentContext,
  isAuthoringComponent,
  isFlowComponent
} from '../components'
import { parseContentNodes } from '../content'
import { parsePath } from '../path'

const flow = (name: string): AstNode => ({ type: 'mdxJsxFlowElement', name })
const inline = (name: string): MdxJsxTextElementAstNode => ({ type: 'mdxJsxTextElement', name })
const text = (value: string): AstNode => ({ type: 'text', value })
const paragraph = (...children: AstNode[]): AstNode => ({ type: 'paragraph', children })

function parse(node: AstNode) {
  return parseContentNodes(node, 'lesson.mdx', '/package')
}

describe('authoring component registry', () => {
  it('recognizes exactly the canonical component names', () => {
    for (const name of authoringComponentNames) expect(isAuthoringComponent(name)).toBe(true)
    for (const name of ['Widget', 'div', 'span', 'scroll', '', 'Grid', 'Tile']) {
      expect(isAuthoringComponent(name)).toBe(false)
    }
  })

  it('declares placement per component from the single registry', () => {
    expect(hasComponentContext('Scroll', 'root')).toBe(true)
    expect(hasComponentContext('Scroll', 'flow')).toBe(false)
    expect(hasComponentContext('Image', 'inline')).toBe(true)
    expect(hasComponentContext('Image', 'flow')).toBe(true)
    expect(hasComponentContext('Video', 'inline')).toBe(false)
    expect(hasComponentContext('Page', 'presentation')).toBe(true)
    expect(hasComponentContext('Page', 'path')).toBe(true)
    expect(hasComponentContext('Item', 'path')).toBe(false)
    expect(hasComponentContext('Question', 'questionnaire')).toBe(true)
    expect(hasComponentContext('Question', 'flow')).toBe(false)
    expect(hasComponentContext('Prompt', 'question')).toBe(true)
    expect(hasComponentContext('Option', 'question')).toBe(true)
    expect(hasComponentContext('Video', 'root')).toBe(false)
  })

  it('derives flow components from the registry without a second name list', () => {
    expect(authoringComponentNames.filter((name) => hasComponentContext(name, 'flow'))).toEqual([
      'Path',
      'Image',
      'Video',
      'Questionnaire'
    ])
    for (const name of ['Image', 'Video', 'Questionnaire', 'Path'])
      expect(isFlowComponent(name)).toBe(true)
    for (const name of [
      'Scroll',
      'Slides',
      'Tiles',
      'Page',
      'Item',
      'Question',
      'Prompt',
      'Option'
    ])
      expect(isFlowComponent(name)).toBe(false)
  })
})

describe('content component dispatch', () => {
  it('parses an inline-capable component through its inline handler', async () => {
    // `<Image>` inline reaches the media handler (no src) rather than erroring
    // as a block-only inline component.
    await expect(parse(paragraph(text('a '), inline('Image')))).rejects.toThrow(
      /"src" must be a non-empty string/
    )
  })

  it('reports unknown block and inline components explicitly', async () => {
    await expect(parse(flow('Widget'))).rejects.toThrow(/unknown MDX component <Widget>/)
    await expect(parse(paragraph(inline('Example')))).rejects.toThrow(
      /unknown MDX component <Example>/
    )
    await expect(parse(flow('Page'))).rejects.toThrow(/unknown MDX component <Page>/)
  })

  it('treats a block-only component adjacent to inline text as inline misuse', async () => {
    await expect(parse(paragraph(text('before '), inline('Questionnaire')))).rejects.toThrow(
      /component <Questionnaire> is block-only and cannot be used inline/
    )
    await expect(parse(paragraph(text('before '), inline('Video')))).rejects.toThrow(
      /component <Video> is block-only and cannot be used inline/
    )
  })

  it('hoists a block-only component surrounded by whitespace instead of reporting inline misuse', async () => {
    const node = paragraph(text(' '), { ...inline('Video'), attributes: [] }, text(' '))
    await expect(parse(node)).rejects.toThrow(/"src" must be a non-empty string/)
  })
})

describe('nested grammar ownership', () => {
  it('rejects standalone Question with a wrapper hint', async () => {
    await expect(parse(flow('Question'))).rejects.toThrow(
      /<Question> must be inside <Questionnaire>/
    )
    await expect(parse(paragraph(text('x '), inline('Question')))).rejects.toThrow(
      /<Question> must be inside <Questionnaire>/
    )
  })

  it('keeps Prompt and Option owned by the Question grammar, not content dispatch', async () => {
    for (const name of ['Prompt', 'Option']) {
      await expect(parse(flow(name))).rejects.toThrow(new RegExp(`unknown MDX component <${name}>`))
    }
  })

  it('requires a Questionnaire to own exactly its direct Questions', async () => {
    await expect(parse(flow('Questionnaire'))).rejects.toThrow(
      /Questionnaire must contain at least one direct <Question>/
    )
    const withVideo: AstNode = { ...flow('Questionnaire'), children: [flow('Video')] }
    await expect(parse(withVideo)).rejects.toThrow(
      /Questionnaire may contain only direct <Question> children; found <Video>/
    )
  })
})

describe('Path child normalization', () => {
  it('accepts a Page text element when flattening a whitespace-only paragraph', () => {
    const path: AstNode = {
      type: 'mdxJsxFlowElement',
      name: 'Path',
      children: [
        paragraph(
          text('\n  '),
          {
            type: 'mdxJsxTextElement',
            name: 'Page',
            attributes: [{ type: 'mdxJsxAttribute', name: 'ref', value: 'lessons/next.mdx' }]
          },
          text('\n')
        )
      ]
    }

    expect(
      parsePath(path, {
        sourceFile: '/package/lessons/start.mdx',
        root: '/package',
        rootPageSources: new Set(['lessons/next.mdx'])
      })
    ).toEqual({ type: 'path', pageIds: ['page:lessons/next.mdx'] })
  })
})
