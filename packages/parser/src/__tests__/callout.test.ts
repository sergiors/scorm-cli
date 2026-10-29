import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CalloutNode } from '@scorm-cli/core'
import type { AstNode } from '../ast'
import { parseContentNodes } from '../content'
import { parseMdx } from '../mdx'
import { parsePackage } from '../index'

const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Parses one top-level block of an MDX fragment exactly as a lesson body would. */
function parseBlock(source: string): ReturnType<typeof parseContentNodes> {
  const block: AstNode | undefined = parseMdx(source, 'lesson.mdx').children[0]
  if (!block) throw new Error(`Expected a parsed block for: ${source}`)
  return parseContentNodes(block, 'lesson.mdx', '/pkg')
}

/** Parses a single-callout fragment and narrows the result to the callout node. */
async function parseCallout(source: string): Promise<CalloutNode> {
  const [node] = await parseBlock(source)
  if (!node || node.type !== 'callout') throw new Error(`Expected one callout for: ${source}`)
  return node
}

/** Parses every top-level block of an MDX fragment, in document order. */
async function parseAllBlocks(
  source: string
): Promise<Awaited<ReturnType<typeof parseContentNodes>>> {
  const blocks = parseMdx(source, 'lesson.mdx').children
  const nodes: Awaited<ReturnType<typeof parseContentNodes>> = []
  for (const block of blocks) nodes.push(...(await parseContentNodes(block, 'lesson.mdx', '/pkg')))
  return nodes
}

const calloutVariants = ['note', 'info', 'tip', 'warning', 'danger'] as const

async function scrollPackage(lesson: string, assets: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'callout-package-'))
  temps.push(root)
  await writeFile(
    path.join(root, 'index.mdx'),
    `---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>`
  )
  await writeFile(path.join(root, 'lesson.mdx'), `---\ntitle: Lesson\n---\n${lesson}`)
  for (const asset of assets) {
    await mkdir(path.dirname(path.join(root, asset)), { recursive: true })
    await writeFile(path.join(root, asset), 'asset')
  }
  return root
}

async function firstPageContent(root: string) {
  const contentPackage = await parsePackage(root)
  if (contentPackage.presentation.type !== 'scroll')
    throw new Error('Expected a scroll presentation')
  const page = contentPackage.presentation.pages[0]
  if (!page) throw new Error('Expected a page')
  return page.content
}

describe('callout parsing', () => {
  it('parses a bare Callout as a note with the converted flow children and no title', async () => {
    const parsed = await parseCallout('<Callout>Body text</Callout>')
    expect(parsed).toEqual({
      type: 'callout',
      variant: 'note',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Body text' }] }]
    })
  })

  it('parses every variant explicitly', async () => {
    for (const variant of calloutVariants) {
      const parsed = await parseCallout(`<Callout variant="${variant}">Body</Callout>`)
      expect(parsed).toMatchObject({ type: 'callout', variant })
    }
  })

  it('trims the optional title and normalizes surrounding whitespace', async () => {
    const titled = await parseCallout('<Callout title="Heads up">Body</Callout>')
    expect(titled).toMatchObject({ variant: 'note', title: 'Heads up' })

    // Whitespace around a nonempty title is trimmed the way other authored
    // string props are.
    const padded = await parseCallout('<Callout title="  Heads up  ">Body</Callout>')
    expect(padded).toMatchObject({ title: 'Heads up' })

    // The default form omits the title field entirely rather than storing an
    // empty title.
    const untitled = await parseCallout('<Callout variant="tip">Body</Callout>')
    expect(untitled).not.toHaveProperty('title')
  })

  it('converts Markdown inline runs inside the callout body', async () => {
    const parsed = await parseCallout(
      '<Callout>See [docs](https://example.test), `run()` and **bold** text.</Callout>'
    )
    expect(parsed.children).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          {
            type: 'link',
            href: 'https://example.test',
            children: [{ type: 'text', value: 'docs' }]
          },
          { type: 'text', value: ', ' },
          { type: 'inlineCode', value: 'run()' },
          { type: 'text', value: ' and ' },
          { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          { type: 'text', value: ' text.' }
        ]
      }
    ])
  })

  it('parses supported Markdown blocks inside the callout body', async () => {
    const parsed = await parseCallout(
      [
        '<Callout variant="warning">',
        '  ## Watch out',
        '',
        '  - one',
        '  - two',
        '',
        '  ```ts',
        '  const x = 1;',
        '  ```',
        '</Callout>'
      ].join('\n')
    )
    expect(parsed.variant).toBe('warning')
    expect(parsed.children).toEqual([
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Watch out' }]
      },
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          { children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'one' }] }] },
          { children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'two' }] }] }
        ]
      },
      { type: 'code', value: 'const x = 1;', language: 'ts' }
    ])
  })

  it('parses a nested Callout inside another Callout body', async () => {
    const parsed = await parseCallout(
      [
        '<Callout variant="tip">',
        '  <Callout variant="danger">Inner body</Callout>',
        '</Callout>'
      ].join('\n')
    )
    expect(parsed.variant).toBe('tip')
    expect(parsed.children).toEqual([
      {
        type: 'callout',
        variant: 'danger',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Inner body' }] }]
      }
    ])
  })

  it('rejects an unknown variant with its source location', async () => {
    await expect(parseCallout('<Callout variant="urgent">Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: Callout "variant" must be "note", "info", "tip", "warning", or "danger"$/
    )
    // A bare attribute is the boolean `true`, never a valid variant.
    await expect(parseCallout('<Callout variant>Body</Callout>')).rejects.toThrow(
      /Callout "variant" must be "note", "info", "tip", "warning", or "danger"$/
    )
  })

  it('rejects empty, whitespace-only, and non-string titles with their source location', async () => {
    await expect(parseCallout('<Callout title="">Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: "title" must be a non-empty string$/
    )
    await expect(parseCallout('<Callout title="   ">Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: "title" must be a non-empty string$/
    )
    // A bare attribute is the boolean `true`, never a valid title.
    await expect(parseCallout('<Callout title>Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: "title" must be a non-empty string$/
    )
    await expect(parseCallout('<Callout title={123}>Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: "title" must be a non-empty string$/
    )
  })

  it('rejects unknown attributes, wherever the callout sits in the document', async () => {
    await expect(parseCallout('<Callout foo="x">Body</Callout>')).rejects.toThrow(
      /^lesson\.mdx:1:1: unknown attribute "foo"$/
    )
    await expect(
      parseAllBlocks(['First block', '', '  <Callout foo="x">Body</Callout>'].join('\n'))
    ).rejects.toThrow(/^lesson\.mdx:3:3: unknown attribute "foo"$/)
  })

  it('rejects invalid Callout usage only, accepting its owned structure', async () => {
    // Variant and title errors come from the Callout grammar itself; they are
    // not confused with generic component errors.
    await expect(
      parseCallout('<Callout variant="info" title={false}>Body</Callout>')
    ).rejects.toThrow(/^lesson\.mdx:1:1: "title" must be a non-empty string$/)
  })
})

describe('callout packages', () => {
  it('parses aliased Callout markers with resolved nested assets', async () => {
    const root = await scrollPackage(
      [
        `import { Callout as Note } from 'scorm-cli/authoring'`,
        '',
        '<Note variant="info" title="Media">',
        '  See ![the diagram](assets/diagram.svg).',
        '',
        '  <Image src="assets/diagram.svg" alt="Standalone" />',
        '</Note>'
      ].join('\n'),
      ['assets/diagram.svg']
    )
    expect(await firstPageContent(root)).toEqual([
      {
        type: 'callout',
        variant: 'info',
        title: 'Media',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'See ' },
              { type: 'image', src: 'assets/diagram.svg', alt: 'the diagram' },
              { type: 'text', value: '.' }
            ]
          },
          { type: 'image', src: 'assets/diagram.svg', alt: 'Standalone' }
        ]
      }
    ])
  })

  it('assigns stable source ids to videos nested inside callout bodies', async () => {
    const root = await scrollPackage(
      [
        '<Callout variant="note">',
        '  <Video src="https://youtu.be/M7lc1UVf-VE" />',
        '</Callout>'
      ].join('\n')
    )
    expect(await firstPageContent(root)).toMatchObject([
      {
        type: 'callout',
        children: [{ type: 'video', id: expect.stringMatching(/^video:lesson\.mdx:\d+:\d+$/) }]
      }
    ])
  })
})
