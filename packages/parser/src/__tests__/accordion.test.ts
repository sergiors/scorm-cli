import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

const oneSection = (flags = ''): string =>
  [
    '<Accordion' + flags + '>',
    '  <Item>',
    '    <Title>Only</Title>',
    '    <Content>Body</Content>',
    '  </Item>',
    '</Accordion>'
  ].join('\n')

async function scrollPackage(lesson: string, assets: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'accordion-package-'))
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

describe('accordion parsing', () => {
  it('parses two authored sections in order with their defaults', async () => {
    const [first, second] = (await parseBlock(
      [
        '<Accordion>',
        '  <Item>',
        '    <Title>**Basics** intro</Title>',
        '    <Content>',
        '',
        '    A first paragraph with **bold** text.',
        '',
        '    - one',
        '    - two',
        '    </Content>',
        '  </Item>',
        '',
        '  <Item>',
        '    <Title>Second</Title>',
        '    <Content>Second body</Content>',
        '  </Item>',
        '</Accordion>'
      ].join('\n')
    )) as Array<Extract<Awaited<ReturnType<typeof parseBlock>>[number], { type: 'accordion' }>>

    // The parser-generated paragraphs wrapping each flow child disappear; the
    // authored order, plain flags and per-section defaults stay.
    expect(first).toEqual({
      type: 'accordion',
      multiple: false,
      collapsible: false,
      items: [
        {
          type: 'accordionItem',
          defaultOpen: false,
          title: [
            { type: 'strong', children: [{ type: 'text', value: 'Basics' }] },
            { type: 'text', value: ' intro' }
          ],
          content: [
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: 'A first paragraph with ' },
                { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
                { type: 'text', value: ' text.' }
              ]
            },
            {
              type: 'list',
              ordered: false,
              spread: false,
              items: [
                {
                  children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'one' }] }]
                },
                {
                  children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'two' }] }]
                }
              ]
            }
          ]
        },
        {
          type: 'accordionItem',
          defaultOpen: false,
          title: [{ type: 'text', value: 'Second' }],
          content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Second body' }] }]
        }
      ]
    })
    expect(second).toBeUndefined()
  })

  it('aligns the multiple and collapsible props with the parsed flags', async () => {
    for (const [flags, multiple, collapsible] of [
      ['', false, false],
      [' collapsible', false, true],
      [' multiple', true, false],
      [' multiple={false}', false, false],
      [' collapsible={false}', false, false],
      [' multiple={false} collapsible', false, true]
    ] as const) {
      const parsed = (await parseBlock(oneSection(flags)))[0]
      expect(parsed).toMatchObject({ type: 'accordion', multiple, collapsible })
    }
  })

  it('opens a bare defaultOpen section and keeps the others closed', async () => {
    const parsed = (
      await parseBlock(
        [
          '<Accordion>',
          '  <Item defaultOpen>',
          '    <Title>Open</Title>',
          '    <Content>Open body</Content>',
          '  </Item>',
          '  <Item>',
          '    <Title>Closed</Title>',
          '    <Content>Closed body</Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    )[0]
    expect(parsed).toMatchObject({
      type: 'accordion',
      items: [{ defaultOpen: true }, { defaultOpen: false }]
    })
  })

  it('keeps several defaultOpen sections only in multiple mode', async () => {
    const twoDefaults = [
      '  <Item defaultOpen>',
      '    <Title>A</Title>',
      '    <Content>A</Content>',
      '  </Item>',
      '  <Item defaultOpen>',
      '    <Title>B</Title>',
      '    <Content>B</Content>',
      '  </Item>'
    ].join('\n')

    const multiple = (await parseBlock(`<Accordion multiple>\n${twoDefaults}\n</Accordion>`))[0]
    expect(multiple).toMatchObject({
      type: 'accordion',
      multiple: true,
      items: [{ defaultOpen: true }, { defaultOpen: true }]
    })

    await expect(parseBlock(`<Accordion>\n${twoDefaults}\n</Accordion>`)).rejects.toThrow(
      /^lesson\.mdx:1:1: a single-open Accordion may have at most one Item with "defaultOpen"$/
    )
  })

  it('rejects multiple and collapsible together', async () => {
    await expect(parseBlock(oneSection(' multiple collapsible'))).rejects.toThrow(
      /^lesson\.mdx:1:1: Accordion cannot set both "multiple" and "collapsible" to true$/
    )
  })

  it('requires boolean multiple, collapsible, and defaultOpen props', async () => {
    await expect(parseBlock(oneSection(' multiple="yes"'))).rejects.toThrow(
      /^lesson\.mdx:1:1: Accordion "multiple" must be a boolean$/
    )
    await expect(parseBlock(oneSection(' collapsible="yes"'))).rejects.toThrow(
      /^lesson\.mdx:1:1: Accordion "collapsible" must be a boolean$/
    )
    await expect(
      parseBlock(
        [
          '<Accordion>',
          '  <Item defaultOpen="yes">',
          '    <Title>T</Title>',
          '    <Content>C</Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    ).rejects.toThrow(/^lesson\.mdx:2:3: Item "defaultOpen" must be a boolean$/)
  })

  it('rejects unknown attributes on every accordion structure name', async () => {
    const item = [
      '  <Item extra>',
      '    <Title>T</Title>',
      '    <Content>C</Content>',
      '  </Item>'
    ].join('\n')
    await expect(parseBlock(oneSection(' foo'))).rejects.toThrow(
      /^lesson\.mdx:1:1: unknown attribute "foo"$/
    )
    await expect(parseBlock(`<Accordion>\n${item}\n</Accordion>`)).rejects.toThrow(
      /^lesson\.mdx:2:3: unknown attribute "extra"$/
    )
    await expect(
      parseBlock('<Accordion><Item><Title foo="x">T</Title><Content>C</Content></Item></Accordion>')
    ).rejects.toThrow(/^lesson\.mdx:1:18: unknown attribute "foo"$/)
    await expect(
      parseBlock('<Accordion><Item><Title>T</Title><Content bar>C</Content></Item></Accordion>')
    ).rejects.toThrow(/^lesson\.mdx:1:34: unknown attribute "bar"$/)
  })

  it('requires at least one direct Item', async () => {
    await expect(parseBlock('<Accordion></Accordion>')).rejects.toThrow(
      /^lesson\.mdx:1:1: Accordion must contain at least one direct <Item>$/
    )
  })

  it('reports stray Accordion children with their source location', async () => {
    await expect(
      parseBlock(
        [
          '<Accordion>',
          '  Intro text',
          '  <Item>',
          '    <Title>T</Title>',
          '    <Content>C</Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    ).rejects.toThrow(
      /^lesson\.mdx:2:3: <Accordion> may contain only direct <Item> children; found paragraph$/
    )
    await expect(
      parseBlock(['<Accordion>', '  <Video src="clip.mp4" />', '</Accordion>'].join('\n'))
    ).rejects.toThrow(
      /^lesson\.mdx:2:3: <Accordion> may contain only direct <Item> children; found <Video>$/
    )
  })

  it('reports stray Item children with their source location', async () => {
    await expect(
      parseBlock(
        [
          '<Accordion>',
          '  <Item>',
          '    Stray paragraph',
          '    <Title>T</Title>',
          '    <Content>C</Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    ).rejects.toThrow(
      /^lesson\.mdx:3:5: <Item> may contain only direct <Title> and <Content> children; found paragraph$/
    )
  })

  it('requires exactly one direct Title per Item', async () => {
    const missing = [
      '<Accordion>',
      '  <Item>',
      '    <Content>C</Content>',
      '  </Item>',
      '</Accordion>'
    ]
    const duplicated = [
      '<Accordion>',
      '  <Item>',
      '    <Title>First</Title>',
      '    <Title>Second</Title>',
      '    <Content>C</Content>',
      '  </Item>',
      '</Accordion>'
    ]
    await expect(parseBlock(missing.join('\n'))).rejects.toThrow(
      /^lesson\.mdx:2:3: Item must contain exactly 1 direct <Title>; found 0$/
    )
    await expect(parseBlock(duplicated.join('\n'))).rejects.toThrow(
      /^lesson\.mdx:2:3: Item must contain exactly 1 direct <Title>; found 2$/
    )
  })

  it('requires exactly one direct Content per Item', async () => {
    const missing = ['<Accordion>', '  <Item>', '    <Title>T</Title>', '  </Item>', '</Accordion>']
    const duplicated = [
      '<Accordion>',
      '  <Item>',
      '    <Title>T</Title>',
      '    <Content>First</Content>',
      '    <Content>Second</Content>',
      '  </Item>',
      '</Accordion>'
    ]
    await expect(parseBlock(missing.join('\n'))).rejects.toThrow(
      /^lesson\.mdx:2:3: Item must contain exactly 1 direct <Content>; found 0$/
    )
    await expect(parseBlock(duplicated.join('\n'))).rejects.toThrow(
      /^lesson\.mdx:2:3: Item must contain exactly 1 direct <Content>; found 2$/
    )
  })

  it('keeps Title, Content, and Item owned by their container grammars', async () => {
    await expect(parseBlock('<Title>Alone</Title>')).rejects.toThrow(
      /^lesson\.mdx:1:1: unknown MDX component <Title>$/
    )
    await expect(parseBlock('<Content>Alone</Content>')).rejects.toThrow(
      /^lesson\.mdx:1:1: unknown MDX component <Content>$/
    )
    await expect(parseBlock('<Item><Title>T</Title><Content>C</Content></Item>')).rejects.toThrow(
      /^lesson\.mdx:1:1: unknown MDX component <Item>$/
    )
    await expect(
      parseBlock(
        [
          '<Accordion>',
          '  <Item>',
          '    <Title>T</Title>',
          '    <Content>',
          '      <Item />',
          '    </Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    ).rejects.toThrow(/^lesson\.mdx:5:7: unknown MDX component <Item>$/)
  })

  it('converts Markdown inline runs inside a Title', async () => {
    const parsed = (
      await parseBlock(
        [
          '<Accordion>',
          '  <Item>',
          '    <Title>See [docs](https://example.test), `code` and **bold**</Title>',
          '    <Content>C</Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    )[0]
    expect(parsed).toMatchObject({
      items: [
        {
          title: [
            { type: 'text', value: 'See ' },
            {
              type: 'link',
              href: 'https://example.test',
              children: [{ type: 'text', value: 'docs' }]
            },
            { type: 'text', value: ', ' },
            { type: 'inlineCode', value: 'code' },
            { type: 'text', value: ' and ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] }
          ]
        }
      ]
    })
  })

  it('parses a nested Accordion inside a section body', async () => {
    const parsed = (
      await parseBlock(
        [
          '<Accordion>',
          '  <Item>',
          '    <Title>Outer</Title>',
          '    <Content>',
          '      <Accordion multiple>',
          '        <Item defaultOpen>',
          '          <Title>Inner</Title>',
          '          <Content>Deep body</Content>',
          '        </Item>',
          '      </Accordion>',
          '    </Content>',
          '  </Item>',
          '</Accordion>'
        ].join('\n')
      )
    )[0]
    expect(parsed).toMatchObject({
      items: [
        {
          content: [
            {
              type: 'accordion',
              multiple: true,
              items: [{ title: [{ type: 'text', value: 'Inner' }] }]
            }
          ]
        }
      ]
    })
  })
})

describe('accordion packages', () => {
  it('parses Accordion markers imported and aliased from scorm-cli/authoring', async () => {
    const root = await scrollPackage(
      [
        `import { Accordion as Info, Item as Section, Title as Heading, Content as Body } from 'scorm-cli/authoring'`,
        '',
        '<Info multiple>',
        '  <Section defaultOpen>',
        '    <Heading>First **bold**</Heading>',
        '    <Body>First body</Body>',
        '  </Section>',
        '  <Section>',
        '    <Heading>Second</Heading>',
        '    <Body>Second body</Body>',
        '  </Section>',
        '</Info>'
      ].join('\n')
    )
    expect(await firstPageContent(root)).toEqual([
      {
        type: 'accordion',
        multiple: true,
        collapsible: false,
        items: [
          {
            type: 'accordionItem',
            defaultOpen: true,
            title: [
              { type: 'text', value: 'First ' },
              { type: 'strong', children: [{ type: 'text', value: 'bold' }] }
            ],
            content: [{ type: 'paragraph', children: [{ type: 'text', value: 'First body' }] }]
          },
          {
            type: 'accordionItem',
            defaultOpen: false,
            title: [{ type: 'text', value: 'Second' }],
            content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Second body' }] }]
          }
        ]
      }
    ])
  })

  it('keeps Tile <Item src> markers unchanged while Accordion Items stay title-based', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'accordion-tiles-'))
    temps.push(root)
    await writeFile(
      path.join(root, 'index.mdx'),
      ['---', 'title: Package', '---', '<Tiles columns={3}><Item src="tile.mdx" /></Tiles>'].join(
        '\n'
      )
    )
    await writeFile(path.join(root, 'tile.mdx'), '---\ntitle: Tile\n---\nHello tile')
    const tilesPackage = await parsePackage(root)
    expect(tilesPackage.presentation).toEqual({
      type: 'tiles',
      columns: 3,
      items: [
        {
          type: 'item',
          id: expect.stringContaining('tile.mdx'),
          source: 'tile.mdx',
          metadata: { title: expect.stringContaining('Tile') },
          content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello tile' }] }]
        }
      ]
    })

    // The Tile grammar still only knows the `src` reference form.
    const invalidTiles = await mkdtemp(path.join(os.tmpdir(), 'accordion-tiles-'))
    temps.push(invalidTiles)
    await writeFile(
      path.join(invalidTiles, 'index.mdx'),
      ['---', 'title: Package', '---', '<Tiles><Item defaultOpen /></Tiles>'].join('\n')
    )
    await expect(parsePackage(invalidTiles)).rejects.toThrow(/unknown attribute "defaultOpen"/)

    // ...and the Accordion grammar only knows the Title/Content form.
    const accordionRoot = await scrollPackage(
      [
        '<Accordion>',
        '  <Item src="tile.mdx">',
        '    <Title>T</Title>',
        '    <Content>C</Content>',
        '  </Item>',
        '</Accordion>'
      ].join('\n')
    )
    await expect(parsePackage(accordionRoot)).rejects.toThrow(
      /^.*lesson\.mdx:\d+:\d+: unknown attribute "src"$/
    )
  })

  it('assigns stable source ids to questionnaires and videos inside Accordion bodies', async () => {
    const root = await scrollPackage(
      [
        '<Accordion>',
        '  <Item>',
        '    <Title>Quiz</Title>',
        '    <Content>',
        '      <Questionnaire>',
        '        <Question type="single-choice">',
        '          <Prompt>Pick one</Prompt>',
        '          <Option value="one" correct>One</Option>',
        '          <Option value="two">Two</Option>',
        '        </Question>',
        '      </Questionnaire>',
        '      <Video src="https://vimeo.com/42" />',
        '    </Content>',
        '  </Item>',
        '</Accordion>'
      ].join('\n')
    )
    const [accordion] = await firstPageContent(root)
    expect(accordion).toMatchObject({
      type: 'accordion',
      items: [
        {
          content: [
            {
              type: 'questionnaire',
              id: expect.stringMatching(/^questionnaire:lesson\.mdx:\d+:\d+$/)
            },
            { type: 'video', id: expect.stringMatching(/^video:lesson\.mdx:\d+:\d+$/) }
          ]
        }
      ]
    })
  })
})
