import { describe, expect, it } from 'vitest'
import type { AstNode } from '../ast'
import { parseContentNodes } from '../content'
import {
  isMarkdownBlock,
  isMarkdownInline,
  markdownBlockTypes,
  markdownInlineTypes
} from '../markdown'
import { parseMdx } from '../mdx'

const text = (value: string): AstNode => ({ type: 'text', value })
const paragraph = (...children: AstNode[]): AstNode => ({ type: 'paragraph', children })

function parse(node: AstNode) {
  return parseContentNodes(node, 'lesson.mdx', '/package')
}

describe('standard Markdown vocabulary', () => {
  it('recognizes exactly the supported inline and block node types', () => {
    expect([...markdownInlineTypes]).toEqual([
      'text',
      'emphasis',
      'strong',
      'inlineCode',
      'link',
      'image',
      'break'
    ])
    expect([...markdownBlockTypes]).toEqual([
      'heading',
      'paragraph',
      'thematicBreak',
      'list',
      'code',
      'blockquote',
      'table'
    ])
    for (const type of markdownInlineTypes) expect(isMarkdownInline({ type })).toBe(true)
    for (const type of markdownBlockTypes) expect(isMarkdownBlock({ type })).toBe(true)
    // A thematic break is a block, never inline syntax.
    expect(isMarkdownInline({ type: 'thematicBreak' })).toBe(false)
    expect(isMarkdownBlock({ type: 'thematicBreak' })).toBe(true)
    // Paragraphs are block vocabulary owned by the block dispatch.
    expect(isMarkdownBlock({ type: 'paragraph' })).toBe(true)
    expect(isMarkdownBlock({ type: 'image' })).toBe(false)
  })
})

describe('Markdown dispatch', () => {
  it('converts headings, links and nested formatting', async () => {
    const heading: AstNode = {
      type: 'heading',
      depth: 2,
      children: [
        text('See '),
        {
          type: 'link',
          url: 'https://example.test',
          children: [{ type: 'strong', children: [text('docs')] }]
        }
      ]
    }

    expect(await parse(heading)).toEqual([
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'text', value: 'See ' },
          {
            type: 'link',
            href: 'https://example.test',
            children: [{ type: 'strong', children: [{ type: 'text', value: 'docs' }] }]
          }
        ]
      }
    ])
  })

  it('wraps a lone inline node in a paragraph', async () => {
    expect(await parse({ type: 'inlineCode', value: 'x' })).toEqual([
      { type: 'paragraph', children: [{ type: 'inlineCode', value: 'x' }] }
    ])
  })

  it('converts fenced code with its language', async () => {
    expect(await parse({ type: 'code', value: 'const x = 1;', lang: 'ts' })).toEqual([
      { type: 'code', value: 'const x = 1;', language: 'ts' }
    ])
  })

  it('normalizes tight list items to inlineContent and keeps loose paragraphs', async () => {
    const tight: AstNode = {
      type: 'list',
      ordered: false,
      spread: false,
      children: [{ type: 'listItem', children: [paragraph(text('one'))] }]
    }
    const loose: AstNode = {
      type: 'list',
      ordered: false,
      spread: true,
      children: [{ type: 'listItem', children: [paragraph(text('one'))] }]
    }

    expect(await parse(tight)).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          { children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'one' }] }] }
        ]
      }
    ])
    expect(await parse(loose)).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: true,
        items: [{ children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }] }]
      }
    ])
  })

  it('converts blockquotes through the shared sibling converter', async () => {
    const quote: AstNode = {
      type: 'blockquote',
      children: [paragraph(text('A quote')), { type: 'code', value: 'x' }]
    }
    expect(await parse(quote)).toEqual([
      {
        type: 'quote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'A quote' }] },
          { type: 'code', value: 'x' }
        ]
      }
    ])
  })

  it('splits paragraphs around block components without an asset read', async () => {
    // A block-only component adjacent to text is reported as inline misuse
    // before any media handler runs.
    const node = paragraph(text('before '), { type: 'mdxJsxTextElement', name: 'Video' })
    await expect(parse(node)).rejects.toThrow(
      /component <Video> is block-only and cannot be used inline/
    )
  })
})

describe('standard Markdown thematic breaks', () => {
  it('converts a thematic break to a canonical node', async () => {
    const { children } = parseMdx('Before\n\n---\n\nAfter', 'lesson.mdx')
    const thematicBreak = children.find((node) => node.type === 'thematicBreak')
    expect(thematicBreak).toBeDefined()
    expect(await parseContentNodes(thematicBreak!, 'lesson.mdx', '/package')).toEqual([
      { type: 'thematicBreak' }
    ])
  })
})

describe('unknown Markdown syntax', () => {
  it('rejects unrecognized Markdown nodes instead of dropping them', async () => {
    const node: AstNode = { type: 'html', value: '<b>x</b>', position: { start: { line: 5 } } }
    await expect(parse(node)).rejects.toThrow(/lesson\.mdx:5: unsupported content node "html"/)
  })

  it('rejects inline nodes the Markdown dispatcher does not own', async () => {
    const node = paragraph({ type: 'mystery' })
    await expect(parse(node)).rejects.toThrow(/unsupported inline node "mystery"/)
  })

  it('rejects MDX JavaScript with a source-aware error', async () => {
    const node: AstNode = {
      type: 'blockquote',
      children: [{ type: 'mdxjsEsm', value: 'export const x = 1;' }]
    }
    await expect(parse(node)).rejects.toThrow(/MDX JavaScript is not supported/)
  })
})

describe('standard Markdown tables', () => {
  const cell = (...children: AstNode[]): AstNode => ({ type: 'tableCell', children })
  const row = (...cells: AstNode[]): AstNode => ({ type: 'tableRow', children: cells })

  it('converts a table into a required header with body rows in authored order', async () => {
    const table: AstNode = {
      type: 'table',
      children: [
        row(cell(text('Stage')), cell(text('Score'))),
        row(cell(text('read')), cell(text('10'))),
        row(cell(text('done')), cell(text('30')))
      ]
    }

    expect(await parse(table)).toEqual([
      {
        type: 'table',
        header: {
          cells: [
            { children: [{ type: 'text', value: 'Stage' }] },
            { children: [{ type: 'text', value: 'Score' }] }
          ]
        },
        rows: [
          {
            cells: [
              { children: [{ type: 'text', value: 'read' }] },
              { children: [{ type: 'text', value: '10' }] }
            ]
          },
          {
            cells: [
              { children: [{ type: 'text', value: 'done' }] },
              { children: [{ type: 'text', value: '30' }] }
            ]
          }
        ]
      }
    ])
  })

  it('keeps a header-only table with an empty body row list', async () => {
    const table: AstNode = { type: 'table', children: [row(cell(text('Only')))] }

    expect(await parse(table)).toEqual([
      {
        type: 'table',
        header: { cells: [{ children: [{ type: 'text', value: 'Only' }] }] },
        rows: []
      }
    ])
  })

  it('maps delimiter-row alignment positionally onto header and body cells', async () => {
    const table: AstNode = {
      type: 'table',
      align: ['left', 'center', 'right', null],
      children: [
        row(cell(text('A')), cell(text('B')), cell(text('C')), cell(text('D'))),
        row(cell(text('1')), cell(text('2')), cell(text('3')), cell(text('4')))
      ]
    }

    expect(await parse(table)).toEqual([
      {
        type: 'table',
        header: {
          cells: [
            { children: [{ type: 'text', value: 'A' }], align: 'left' },
            { children: [{ type: 'text', value: 'B' }], align: 'center' },
            { children: [{ type: 'text', value: 'C' }], align: 'right' },
            { children: [{ type: 'text', value: 'D' }] }
          ]
        },
        rows: [
          {
            cells: [
              { children: [{ type: 'text', value: '1' }], align: 'left' },
              { children: [{ type: 'text', value: '2' }], align: 'center' },
              { children: [{ type: 'text', value: '3' }], align: 'right' },
              { children: [{ type: 'text', value: '4' }] }
            ]
          }
        ]
      }
    ])
  })

  it('keeps an empty cell as an empty inline run', async () => {
    const table: AstNode = { type: 'table', children: [row(cell(text('x')), cell())] }

    expect(await parse(table)).toEqual([
      {
        type: 'table',
        header: { cells: [{ children: [{ type: 'text', value: 'x' }] }, { children: [] }] },
        rows: []
      }
    ])
  })

  it('shares the paragraph inline converter inside cells, including links', async () => {
    const table: AstNode = {
      type: 'table',
      children: [
        row(
          cell({ type: 'inlineCode', value: 'id' }),
          cell({ type: 'strong', children: [text('bold')] }),
          cell({ type: 'emphasis', children: [text('italic')] }),
          cell({ type: 'link', url: 'https://example.test', children: [text('docs')] })
        )
      ]
    }

    expect(await parse(table)).toEqual([
      {
        type: 'table',
        header: {
          cells: [
            { children: [{ type: 'inlineCode', value: 'id' }] },
            { children: [{ type: 'strong', children: [{ type: 'text', value: 'bold' }] }] },
            { children: [{ type: 'emphasis', children: [{ type: 'text', value: 'italic' }] }] },
            {
              children: [
                {
                  type: 'link',
                  href: 'https://example.test',
                  children: [{ type: 'text', value: 'docs' }]
                }
              ]
            }
          ]
        },
        rows: []
      }
    ])
  })

  it('parses GFM table source with delimiter alignment and rich cells', async () => {
    const { children } = parseMdx(
      [
        '| Color | Count | Notes |',
        '| :---- | :---: | ----: |',
        '| red   | 1     | `code` |',
        '| blue  |       | **bold** *italic* |'
      ].join('\n'),
      'lesson.mdx'
    )
    const table = children.find((node) => node.type === 'table')
    expect(table).toBeDefined()

    expect(await parseContentNodes(table!, 'lesson.mdx', '/package')).toEqual([
      {
        type: 'table',
        header: {
          cells: [
            { children: [{ type: 'text', value: 'Color' }], align: 'left' },
            { children: [{ type: 'text', value: 'Count' }], align: 'center' },
            { children: [{ type: 'text', value: 'Notes' }], align: 'right' }
          ]
        },
        rows: [
          {
            cells: [
              { children: [{ type: 'text', value: 'red' }], align: 'left' },
              { children: [{ type: 'text', value: '1' }], align: 'center' },
              { children: [{ type: 'inlineCode', value: 'code' }], align: 'right' }
            ]
          },
          {
            cells: [
              { children: [{ type: 'text', value: 'blue' }], align: 'left' },
              { children: [], align: 'center' },
              {
                children: [
                  { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
                  { type: 'text', value: ' ' },
                  { type: 'emphasis', children: [{ type: 'text', value: 'italic' }] }
                ],
                align: 'right'
              }
            ]
          }
        ]
      }
    ])
  })

  it('keeps non-table GFM syntax literal while parsing tables', async () => {
    const { children } = parseMdx(
      [
        '~~struck~~ and [^1]',
        '',
        'https://example.test',
        '',
        '- [ ] todo',
        '',
        '| Value |',
        '| --- |',
        '| **cell** |'
      ].join('\n'),
      'lesson.mdx'
    )

    expect(children.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'list', 'table'])
    expect(
      children[0]?.children
        ?.map((node) => ('value' in node ? String(node.value ?? '') : ''))
        .join('')
    ).toBe('~~struck~~ and [^1]')
    expect(children[1]?.children?.map((node) => node.type)).toEqual(['text'])
    expect(
      children[1]?.children
        ?.map((node) => ('value' in node ? String(node.value ?? '') : ''))
        .join('')
    ).toBe('https://example.test')

    const converted = await Promise.all(
      children.map((node) => parseContentNodes(node, 'lesson.mdx', '/package'))
    )
    expect(converted[0]).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: '~~struck~~' },
          { type: 'text', value: ' and [^1]' }
        ]
      }
    ])
    expect(converted[1]).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'https://example.test' }] }
    ])
    expect(converted[2]).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [
                  { type: 'text', value: '[ ] ' },
                  { type: 'text', value: 'todo' }
                ]
              }
            ]
          }
        ]
      }
    ])
    expect(converted[3]?.[0]?.type).toBe('table')
  })

  it('keeps a table between paragraphs in authored order with existing Markdown intact', async () => {
    // Regression: registering GFM table syntax must not disturb the surrounding
    // standard Markdown vocabulary or block separation.
    const { children } = parseMdx(
      'A **before** paragraph\n\n| Only |\n| --- |\n\nAn *after* paragraph',
      'lesson.mdx'
    )
    const table = children.findIndex((node) => node.type === 'table')
    expect(children.map((node) => node.type)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(table).toBe(1)

    const converted = await Promise.all(
      children.map((node) => parseContentNodes(node, 'lesson.mdx', '/package'))
    )
    expect(converted).toEqual([
      [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'A ' },
            { type: 'strong', children: [{ type: 'text', value: 'before' }] },
            { type: 'text', value: ' paragraph' }
          ]
        }
      ],
      [
        {
          type: 'table',
          header: { cells: [{ children: [{ type: 'text', value: 'Only' }] }] },
          rows: []
        }
      ],
      [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'An ' },
            { type: 'emphasis', children: [{ type: 'text', value: 'after' }] },
            { type: 'text', value: ' paragraph' }
          ]
        }
      ]
    ])
  })
})
