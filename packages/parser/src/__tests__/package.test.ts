import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePackage } from '../index'

let temp: string
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true })
})

async function makePackage(entry: string): Promise<string> {
  temp = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
  await writeFile(path.join(temp, 'index.mdx'), entry)
  return temp
}

async function makeLesson(content: string): Promise<string> {
  const root = await makePackage(
    `---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>`
  )
  await writeFile(path.join(root, 'lesson.mdx'), `---\ntitle: Lesson\n---\n${content}`)
  return root
}

async function asset(root: string, name: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true })
  await writeFile(path.join(root, name), 'asset')
}

async function lessonContent(root: string) {
  const contentPackage = await parsePackage(root)
  if (contentPackage.presentation.type !== 'scroll')
    throw new Error('Expected a scroll presentation')
  const page = contentPackage.presentation.pages[0]
  if (!page) throw new Error('Expected a page')
  return page.content
}

describe('parsePackage', () => {
  it('defaults package language to English and canonicalizes valid BCP-47 tags', async () => {
    for (const [frontmatter, expected] of [
      ['', 'en'],
      ['lang: en\n', 'en'],
      ['lang: pt-br\n', 'pt-BR']
    ] as const) {
      const root = await makePackage(
        `---\ntitle: Package\n${frontmatter}---\n<Scroll><Page src="lesson.mdx" /></Scroll>`
      )
      await writeFile(path.join(root, 'lesson.mdx'), '---\ntitle: Lesson\n---')
      const parsed = await parsePackage(root)
      expect(parsed.metadata.lang).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('rejects invalid or empty package language tags with a useful error', async () => {
    for (const [language, error] of [
      ['not_a_tag', /"lang" must be a valid BCP-47 language tag/],
      ['', /"lang" must be a non-empty string/]
    ] as const) {
      const root = await makePackage(
        `---\ntitle: Package\nlang: "${language}"\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>`
      )
      await writeFile(path.join(root, 'lesson.mdx'), '---\ntitle: Lesson\n---')
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('preserves Markdown inline semantics and nested formatting', async () => {
    const root = await makeLesson(
      '# Hello **bold *nested*** and [a *rich* link](https://example.test) with `code`\n\n' +
        'First  \nsecond, plus ![diagram](assets/diagram.svg).'
    )
    await asset(root, 'assets/diagram.svg')
    expect(await lessonContent(root)).toEqual([
      {
        type: 'heading',
        depth: 1,
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'strong',
            children: [
              { type: 'text', value: 'bold ' },
              {
                type: 'emphasis',
                children: [{ type: 'text', value: 'nested' }]
              }
            ]
          },
          { type: 'text', value: ' and ' },
          {
            type: 'link',
            href: 'https://example.test',
            children: [
              { type: 'text', value: 'a ' },
              { type: 'emphasis', children: [{ type: 'text', value: 'rich' }] },
              { type: 'text', value: ' link' }
            ]
          },
          { type: 'text', value: ' with ' },
          { type: 'inlineCode', value: 'code' }
        ]
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'First' },
          { type: 'break' },
          { type: 'text', value: 'second, plus ' },
          { type: 'image', src: 'assets/diagram.svg', alt: 'diagram' },
          { type: 'text', value: '.' }
        ]
      }
    ])
  })

  it('parses a thematic break as a canonical block between other blocks', async () => {
    const root = await makeLesson('Before\n\n---\n\nAfter')
    expect(await lessonContent(root)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'Before' }] },
      { type: 'thematicBreak' },
      { type: 'paragraph', children: [{ type: 'text', value: 'After' }] }
    ])
  })

  it('preserves nested lists, blockquotes, ordered starts, and fenced code languages', async () => {
    const root = await makeLesson(
      '3. First\n   - nested **item**\n4. Second\n\n> A quote\n>\n> - quoted list\n\n```ts\nconst answer: number = 42;\n```'
    )
    expect(await lessonContent(root)).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 3,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'First' }]
              },
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
                          { type: 'text', value: 'nested ' },
                          {
                            type: 'strong',
                            children: [{ type: 'text', value: 'item' }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Second' }]
              }
            ]
          }
        ]
      },
      {
        type: 'quote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'A quote' }] },
          {
            type: 'list',
            ordered: false,
            spread: false,
            items: [
              {
                children: [
                  {
                    type: 'inlineContent',
                    children: [{ type: 'text', value: 'quoted list' }]
                  }
                ]
              }
            ]
          }
        ]
      },
      { type: 'code', value: 'const answer: number = 42;', language: 'ts' }
    ])
  })

  it('normalizes tight list items into inlineContent runs, not paragraphs', async () => {
    const root = await makeLesson('- one\n- two\n- three')
    expect(await lessonContent(root)).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'one' }]
              }
            ]
          },
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'two' }]
              }
            ]
          },
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'three' }]
              }
            ]
          }
        ]
      }
    ])
  })

  it('keeps authored inline formatting and nested blocks in tight items', async () => {
    const root = await makeLesson('- Use `code` and *emphasis*\n  - nested block')
    expect(await lessonContent(root)).toEqual([
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
                  { type: 'text', value: 'Use ' },
                  { type: 'inlineCode', value: 'code' },
                  { type: 'text', value: ' and ' },
                  {
                    type: 'emphasis',
                    children: [{ type: 'text', value: 'emphasis' }]
                  }
                ]
              },
              {
                type: 'list',
                ordered: false,
                spread: false,
                items: [
                  {
                    children: [
                      {
                        type: 'inlineContent',
                        children: [{ type: 'text', value: 'nested block' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ])
  })

  it('copies remark list tightness (spread: true) for loose lists', async () => {
    const root = await makeLesson('1. one\n\n2. two')
    expect(await lessonContent(root)).toEqual([
      {
        type: 'list',
        ordered: true,
        spread: true,
        items: [
          {
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }]
          },
          {
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'two' }] }]
          }
        ]
      }
    ])
  })

  it('marks a loose list whose item spans multiple blocks', async () => {
    const root = await makeLesson('- one\n\n  continued\n\n- two')
    const content = await lessonContent(root)
    expect(content).toMatchObject([
      {
        type: 'list',
        ordered: false,
        spread: true,
        items: [
          {
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'one' }] },
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'continued' }]
              }
            ]
          },
          {
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'two' }] }]
          }
        ]
      }
    ])
  })

  it('resolves standard reference-style Markdown links and images', async () => {
    const root = await makeLesson(
      '[Read *the guide*][guide] and ![reference image][diagram].\n\n' +
        '[guide]: https://example.test/guide\n' +
        '[diagram]: assets/diagram.svg'
    )
    await asset(root, 'assets/diagram.svg')
    expect(await lessonContent(root)).toEqual([
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            href: 'https://example.test/guide',
            children: [
              { type: 'text', value: 'Read ' },
              {
                type: 'emphasis',
                children: [{ type: 'text', value: 'the guide' }]
              }
            ]
          },
          { type: 'text', value: ' and ' },
          { type: 'image', src: 'assets/diagram.svg', alt: 'reference image' },
          { type: 'text', value: '.' }
        ]
      }
    ])
  })

  it('resolves nested local Markdown file links and preserves query strings and fragments', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await mkdir(path.join(root, 'lessons'), { recursive: true })
    await mkdir(path.join(root, 'files'))
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lessons/page.mdx" /></Scroll>'
    )
    await writeFile(path.join(root, 'files/guide.pdf'), 'pdf')
    await writeFile(
      path.join(root, 'lessons/page.mdx'),
      '---\ntitle: Lesson\n---\n[Guide](../files/guide.pdf?download=1#page-2) [Mail](mailto:help@example.test) [Section](#details)'
    )

    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'paragraph',
        children: [
          { type: 'link', href: 'files/guide.pdf?download=1#page-2' },
          { type: 'text', value: ' ' },
          { type: 'link', href: 'mailto:help@example.test' },
          { type: 'text', value: ' ' },
          { type: 'link', href: '#details' }
        ]
      }
    ])
  })

  it('validates local Markdown links and rejects missing or escaping targets', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = parent
    const root = path.join(parent, 'package')
    await mkdir(path.join(root, 'assets'), { recursive: true })
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>'
    )
    await writeFile(
      path.join(root, 'lesson.mdx'),
      '---\ntitle: Lesson\n---\n[Missing](assets/missing.pdf)'
    )
    await expect(parsePackage(root)).rejects.toThrow(/asset "assets\/missing\.pdf" does not exist/)
    const outside = path.join(parent, 'outside.pdf')
    await writeFile(outside, 'outside')
    await symlink(outside, path.join(root, 'assets/outside.pdf'))
    await writeFile(
      path.join(root, 'lesson.mdx'),
      '---\ntitle: Lesson\n---\n[Outside](assets/outside.pdf)'
    )
    await expect(parsePackage(root)).rejects.toThrow(
      /resolves outside the content package directory/
    )
  })

  it('rejects Page and Item sources symlinked outside the content package', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = parent

    for (const kind of ['Page', 'Item'] as const) {
      const root = path.join(parent, kind.toLowerCase())
      const outside = path.join(parent, `${kind.toLowerCase()}-outside.mdx`)
      await mkdir(root)
      await writeFile(outside, '---\ntitle: Outside\n---')
      await symlink(outside, path.join(root, 'linked.mdx'))
      await writeFile(
        path.join(root, 'index.mdx'),
        kind === 'Page'
          ? '---\ntitle: Package\n---\n<Scroll><Page src="linked.mdx" /></Scroll>'
          : '---\ntitle: Package\n---\n<Tiles><Item src="linked.mdx" /></Tiles>'
      )

      await expect(parsePackage(root)).rejects.toThrow(
        new RegExp(`${kind} source "linked\\.mdx" resolves outside the content package directory`)
      )
    }
  })

  it('parses standard and semantic images in flow and inline contexts', async () => {
    const root = await makeLesson(
      '![Markdown](assets/pic.svg)\n\nBefore <Image src="assets/pic.svg" alt="" caption="A caption" /> after.\n\n<Image src="assets/pic.svg" alt="Semantic" />'
    )
    await asset(root, 'assets/pic.svg')
    expect(await lessonContent(root)).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'image', src: 'assets/pic.svg', alt: 'Markdown' }]
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Before ' },
          {
            type: 'image',
            src: 'assets/pic.svg',
            alt: '',
            caption: 'A caption'
          },
          { type: 'text', value: ' after.' }
        ]
      },
      { type: 'image', src: 'assets/pic.svg', alt: 'Semantic' }
    ])
  })

  it('parses semantic video with poster and captions', async () => {
    const root = await makeLesson(
      `<Video src="https://cdn.example.test/lesson.mp4" title="Lesson" poster="assets/poster.svg" captions="assets/captions.vtt" />\n\n` +
        `## Next steps\n\nUse **types** to model your data.\n\n- Describe each value\n- Let the editor check usage\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\``
    )
    await asset(root, 'assets/poster.svg')
    await asset(root, 'assets/captions.vtt')
    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'video',
        id: 'video:lesson.mdx:4:1',
        provider: 'native',
        src: 'https://cdn.example.test/lesson.mp4',
        title: 'Lesson',
        poster: 'assets/poster.svg',
        captions: 'assets/captions.vtt'
      },
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Next steps' }]
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Use ' },
          { type: 'strong', children: [{ type: 'text', value: 'types' }] },
          { type: 'text', value: ' to model your data.' }
        ]
      },
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Describe each value' }]
              }
            ]
          },
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Let the editor check usage' }]
              }
            ]
          }
        ]
      },
      { type: 'code', value: 'const x: number = 1;', language: 'ts' }
    ])
  })

  it('infers video providers, preserves provider URLs, and includes frontmatter in stable IDs', async () => {
    const root = await makeLesson(
      '<Video src="assets/local.mp4" />\n\n' +
        '<Video src="https://youtu.be/abc123" />\n\n' +
        '<Video src="https://www.youtube.com/watch?v=xyz" />\n\n' +
        '<Video src="https://www.youtube-nocookie.com/embed/xyz" />\n\n' +
        '<Video src="https://player.vimeo.com/video/42" />\n\n' +
        '<Video src="https://vimeo.com/99" />'
    )
    await asset(root, 'assets/local.mp4')
    const videos = await lessonContent(root)
    expect(videos).toEqual([
      {
        type: 'video',
        id: 'video:lesson.mdx:4:1',
        provider: 'native',
        src: 'assets/local.mp4'
      },
      {
        type: 'video',
        id: 'video:lesson.mdx:6:1',
        provider: 'youtube',
        src: 'https://youtu.be/abc123'
      },
      {
        type: 'video',
        id: 'video:lesson.mdx:8:1',
        provider: 'youtube',
        src: 'https://www.youtube.com/watch?v=xyz'
      },
      {
        type: 'video',
        id: 'video:lesson.mdx:10:1',
        provider: 'youtube',
        src: 'https://www.youtube-nocookie.com/embed/xyz'
      },
      {
        type: 'video',
        id: 'video:lesson.mdx:12:1',
        provider: 'vimeo',
        src: 'https://player.vimeo.com/video/42'
      },
      {
        type: 'video',
        id: 'video:lesson.mdx:14:1',
        provider: 'vimeo',
        src: 'https://vimeo.com/99'
      }
    ])
    expect(await lessonContent(root)).toEqual(videos)
  })

  it('does not accept an authored provider attribute', async () => {
    const root = await makeLesson('<Video src="https://youtu.be/abc123" provider="youtube" />')
    await expect(lessonContent(root)).rejects.toThrow(/unknown attribute "provider"/)
  })

  it('preserves question Markdown and normalizes multiline whitespace', async () => {
    const root = await makeLesson(
      `<Questionnaire>\n<Question type="single-choice">\n` +
        `  <Prompt>\nWhat does \`string\` represent?\n\nChoose **one**.\n</Prompt>\n` +
        `  <Option value="number" correct={false}>\nA *numeric* value\n\n\`\`\`\n42\n\`\`\`\n</Option>\n` +
        `  <Option value="text" correct={true}>\nText\n\n\`\`\`\n"hello"\n\`\`\`\n</Option>\n` +
        `</Question>\n</Questionnaire>`
    )
    expect(await lessonContent(root)).toEqual([
      {
        type: 'questionnaire',
        id: 'questionnaire:lesson.mdx:4:1',
        contributesToScore: true,
        revealCorrectAnswers: true,
        // An omitted `maxAttempts` normalizes to the single-attempt default,
        // so every parsed questionnaire carries an explicit cap.
        maxAttempts: 1,
        expanded: false,
        // An omitted `shuffleOptions` normalizes to authored (unshuffled) order.
        shuffleOptions: false,
        questions: [
          {
            type: 'question',
            id: 'question:lesson.mdx:5:1',
            questionType: 'single-choice',
            prompt: 'What does `string` represent? Choose **one**.',
            options: [
              {
                value: 'number',
                correct: false,
                content: 'A *numeric* value ``` 42 ```'
              },
              {
                value: 'text',
                correct: true,
                content: 'Text ``` "hello" ```'
              }
            ]
          }
        ]
      }
    ])
  })

  it('extracts prompt and option text across bare-CR line breaks', async () => {
    const root = await makeLesson(
      '<Questionnaire>\r' +
        '<Question type="single-choice">\r' +
        '<Prompt>Which value is `text`?\rChoose **one**.</Prompt>\r' +
        '<Option value="number" correct={false}>A *number*\rvalue</Option>\r' +
        '<Option value="text" correct={true}>A `text` value</Option>\r' +
        '</Question>\r</Questionnaire>'
    )

    const content = await lessonContent(root)
    expect(content).toMatchObject([
      {
        type: 'questionnaire',
        questions: [
          {
            prompt: 'Which value is `text`? Choose **one**.',
            options: [
              { value: 'number', content: 'A *number* value' },
              { value: 'text', content: 'A `text` value' }
            ]
          }
        ]
      }
    ])
  })

  it('extracts raw prompt and option text for a questionnaire nested in a list item', async () => {
    const root = await makeLesson(
      '- Check your setup\n\n  <Questionnaire>\n' +
        '    <Question type="single-choice">\n' +
        '      <Prompt>Does `nesting` work in\n      **lists**?</Prompt>\n' +
        '      <Option value="yes" correct>Yes, after **checks**.</Option>\n' +
        '      <Option value="no">No</Option>\n' +
        '    </Question>\n  </Questionnaire>'
    )
    const content = await lessonContent(root)
    // The questionnaire sits inside a Markdown list item, yet its prompt and
    // option strings are extracted from the page source with the same
    // whitespace normalization as a top-level questionnaire.
    expect(content).toMatchObject([
      {
        type: 'list',
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Check your setup' }]
              },
              {
                type: 'questionnaire',
                questions: [
                  {
                    prompt: 'Does `nesting` work in **lists**?',
                    options: [
                      { value: 'yes', correct: true, content: 'Yes, after **checks**.' },
                      { value: 'no', correct: false, content: 'No' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ])
  })

  it('preserves authored Question option order and types for manifest index mapping', async () => {
    const root = await makeLesson(
      `<Questionnaire>\n` +
        `<Question type="multiple-choice">\n<Prompt>Pick all</Prompt>\n` +
        `<Option value="zebra" correct={true}>Zebra</Option>\n` +
        `<Option value="mango" correct={false}>Mango</Option>\n` +
        `<Option value="apple" correct={true}>Apple</Option>\n` +
        `</Question>\n` +
        `<Question type="single-choice">\n<Prompt>Pick one</Prompt>\n` +
        `<Option value="beta" correct={false}>Beta</Option>\n` +
        `<Option value="alpha" correct={true}>Alpha</Option>\n` +
        `</Question>\n</Questionnaire>`
    )
    const content = await lessonContent(root)
    const questionnaire = content[0]
    if (questionnaire?.type !== 'questionnaire') throw new Error('Expected a questionnaire')
    expect(questionnaire.questions.map((question) => question.questionType)).toEqual([
      'multiple-choice',
      'single-choice'
    ])
    const authored = questionnaire.questions.map((question) =>
      question.options.map((option) => option.value)
    )
    // Authored order is deliberately not alphabetical so the manifest cannot
    // reindex by sorting values; option indexes must follow the source order.
    expect(authored).toEqual([
      ['zebra', 'mango', 'apple'],
      ['beta', 'alpha']
    ])
    expect([...authored[0]!].sort()).not.toEqual(authored[0])
  })

  it('validates Prompt counts with a source line and count', async () => {
    for (const [inside, count] of [
      ['<Option value="a"/><Option value="b"/>', 0],
      ['<Prompt>One</Prompt><Prompt>Two</Prompt><Option value="a"/><Option value="b"/>', 2]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire><Question type="single-choice">${inside}</Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(
        new RegExp(
          `lesson\\.mdx:\\d+(?::\\d+)?: Question must contain exactly 1 Prompt; found ${count}`
        )
      )
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('validates unique required option values and answer rules for all question types', async () => {
    const cases = [
      [
        `<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question></Questionnaire>`,
        /single-choice Question must have exactly one correct Option/
      ],
      [
        `<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="x" correct/><Option value="x"/></Question></Questionnaire>`,
        /Option value "x" must be unique/
      ],
      [
        `<Questionnaire><Question type="multiple-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question></Questionnaire>`,
        /multiple-choice Question must have at least one correct Option/
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f"/><Option value="m"/></Question></Questionnaire>`,
        /true-false Question must have exactly 2 Options/
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t"/><Option value="f"/></Question></Questionnaire>`,
        /true-false Question must have exactly one correct Option/
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f" correct/></Question></Questionnaire>`,
        /true-false Question must have exactly one correct Option/
      ],
      [
        `<Questionnaire><Question type="multiple-choice"><Prompt>Q</Prompt><Option/><Option value="y" correct/></Question></Questionnaire>`,
        /"value" must be a non-empty string/
      ]
    ] as const
    for (const [content, error] of cases) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('accepts valid multiple-choice and true-false questions', async () => {
    const root = await makeLesson(
      `<Questionnaire>\n<Question type="multiple-choice"><Prompt>Choose all</Prompt><Option value="a" correct={true}>A</Option><Option value="b" correct={false}>B</Option><Option value="c" correct={true}>C</Option></Question>\n` +
        `<Question type="true-false"><Prompt>It is true</Prompt><Option value="true" correct={true}>True</Option><Option value="false" correct={false}>False</Option></Question>\n</Questionnaire>`
    )
    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'questionnaire',
        questions: [
          {
            type: 'question',
            questionType: 'multiple-choice',
            options: [{ correct: true }, { correct: false }, { correct: true }]
          },
          {
            type: 'question',
            questionType: 'true-false',
            options: [{ correct: true }, { correct: false }]
          }
        ]
      }
    ])
  })

  it('requires a non-empty questionnaire containing only direct Questions', async () => {
    for (const [content, error] of [
      ['<Questionnaire />', /Questionnaire must contain at least one direct <Question>/],
      ['<Questionnaire title="Quiz"><Question /></Questionnaire>', /unknown attribute "title"/],
      [
        '<Questionnaire><Video src="missing.mp4" /></Questionnaire>',
        /Questionnaire may contain only direct <Question> children; found <Video>/
      ],
      [
        '<Questionnaire>stray text</Questionnaire>',
        /Questionnaire may contain only direct <Question> children/
      ]
    ] as const) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('defaults score contribution to true and accepts only static boolean overrides', async () => {
    for (const [attribute, expected] of [
      ['', true],
      [' contributesToScore', true],
      [' contributesToScore={true}', true],
      [' contributesToScore={false}', false]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      const content = await lessonContent(root)
      expect(content[0]?.type === 'questionnaire' && content[0].contributesToScore).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    for (const [attribute, error] of [
      [' contributesToScore="false"', /Questionnaire "contributesToScore" must be a boolean/],
      [
        ' contributesToScore={dynamic}',
        /dynamic value for attribute "contributesToScore" is not supported/
      ],
      [' extra={true}', /unknown attribute "extra"/]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('normalizes omitted expanded to false and accepts only static booleans', async () => {
    for (const [attribute, expected] of [
      ['', false],
      [' expanded', true],
      [' expanded={true}', true],
      [' expanded={false}', false]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      const content = await lessonContent(root)
      expect(content[0]?.type === 'questionnaire' && content[0].expanded).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    for (const [attribute, error] of [
      [' expanded="true"', /Questionnaire "expanded" must be a boolean/],
      [' expanded={dynamic}', /dynamic value for attribute "expanded" is not supported/]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('normalizes omitted shuffleOptions to false and accepts only boolean literals', async () => {
    for (const [attribute, expected] of [
      ['', false],
      [' shuffleOptions', true],
      [' shuffleOptions={true}', true],
      [' shuffleOptions={false}', false]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      const content = await lessonContent(root)
      expect(content[0]?.type === 'questionnaire' && content[0].shuffleOptions).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    for (const [attribute, error] of [
      [' shuffleOptions="true"', /Questionnaire "shuffleOptions" must be a boolean/],
      [
        ' shuffleOptions={dynamic}',
        /dynamic value for attribute "shuffleOptions" is not supported/
      ],
      [' shuffleOptions={1.5}', /dynamic value for attribute "shuffleOptions" is not supported/]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('defaults maxAttempts to 1 when not authored and accepts only positive integer literals', async () => {
    for (const [attribute, expected] of [
      ['', 1],
      [' maxAttempts={1}', 1],
      [' maxAttempts={3}', 3]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      const content = await lessonContent(root)
      const authored = content[0]?.type === 'questionnaire' ? content[0].maxAttempts : false
      expect(authored).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    for (const [attribute, error] of [
      [' maxAttempts', /Questionnaire "maxAttempts" must be a positive integer/],
      // A string value keeps the attribute unusable as an attempt cap.
      [' maxAttempts="3"', /Questionnaire "maxAttempts" must be a positive integer/],
      [' maxAttempts={true}', /Questionnaire "maxAttempts" must be a positive integer/],
      // Zero is a parsed numeric literal, but an attempt cap must be at least 1.
      [' maxAttempts={0}', /Questionnaire "maxAttempts" must be a positive integer/],
      [' maxAttempts={dynamic}', /dynamic value for attribute "maxAttempts" is not supported/],
      // Non-integer numeric literals are never treated as a supported dynamic value.
      [' maxAttempts={1.5}', /dynamic value for attribute "maxAttempts" is not supported/],
      [' maxAttempts={-2}', /dynamic value for attribute "maxAttempts" is not supported/]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('parses maxAttempts together with a score-contribution override and expanded', async () => {
    const root = await makeLesson(
      '<Questionnaire maxAttempts={3} expanded contributesToScore={false}>' +
        '<Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>'
    )
    const content = await lessonContent(root)
    expect(
      content[0]?.type === 'questionnaire' &&
        content[0].maxAttempts === 3 &&
        content[0].expanded === true &&
        content[0].contributesToScore === false
    ).toBe(true)
  })

  it('defaults revealCorrectAnswers to true and accepts only boolean literals', async () => {
    for (const [attribute, expected] of [
      ['', true],
      [' revealCorrectAnswers', true],
      [' revealCorrectAnswers={true}', true],
      [' revealCorrectAnswers={false}', false]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      const content = await lessonContent(root)
      expect(content[0]?.type === 'questionnaire' && content[0].revealCorrectAnswers).toBe(expected)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    for (const [attribute, error] of [
      [' revealCorrectAnswers="true"', /Questionnaire "revealCorrectAnswers" must be a boolean/],
      [
        ' revealCorrectAnswers={dynamic}',
        /dynamic value for attribute "revealCorrectAnswers" is not supported/
      ]
    ] as const) {
      const root = await makeLesson(
        `<Questionnaire${attribute}><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>`
      )
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('parses expanded together with a score-contribution override', async () => {
    const root = await makeLesson(
      '<Questionnaire contributesToScore={false} expanded>' +
        '<Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>'
    )
    const content = await lessonContent(root)
    expect(
      content[0]?.type === 'questionnaire' &&
        content[0].contributesToScore === false &&
        content[0].expanded === true
    ).toBe(true)
  })

  it('rejects standalone Questions with a source-located wrapper hint', async () => {
    for (const content of [
      '<Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question>',
      'Inline <Question type="single-choice" /> is not supported.'
    ]) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(
        /lesson\.mdx:\d+(?::\d+)?: <Question> must be inside <Questionnaire>/
      )
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('keeps questionnaire and question ids stable across package directories', async () => {
    const source =
      '<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>'
    const firstRoot = await makeLesson(source)
    const firstContent = await lessonContent(firstRoot)
    const firstId = firstContent[0]?.type === 'questionnaire' ? firstContent[0].id : ''
    const firstQuestionId =
      firstContent[0]?.type === 'questionnaire' ? firstContent[0].questions[0]?.id : ''
    await rm(firstRoot, { recursive: true, force: true })

    const secondRoot = await makeLesson(source)
    const secondContent = await lessonContent(secondRoot)
    const secondId = secondContent[0]?.type === 'questionnaire' ? secondContent[0].id : ''
    const secondQuestionId =
      secondContent[0]?.type === 'questionnaire' ? secondContent[0].questions[0]?.id : ''

    expect(firstId).toBe('questionnaire:lesson.mdx:4:1')
    expect(secondId).toBe(firstId)
    expect(firstQuestionId).toBe('question:lesson.mdx:4:16')
    expect(secondQuestionId).toBe(firstQuestionId)
  })

  it('assigns stable frontmatter-adjusted IDs to multiple questions in nested documents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await mkdir(path.join(root, 'lessons'), { recursive: true })
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lessons/nested.mdx" /></Scroll>'
    )
    await writeFile(
      path.join(root, 'lessons/nested.mdx'),
      [
        '---',
        'title: Nested lesson',
        'description: Has frontmatter',
        '---',
        '',
        '<Questionnaire>',
        '  <Question type="single-choice">',
        '    <Prompt>First?</Prompt>',
        '    <Option value="yes" correct>Yes</Option>',
        '    <Option value="no">No</Option>',
        '  </Question>',
        '  <Question type="single-choice">',
        '    <Prompt>Second?</Prompt>',
        '    <Option value="yes" correct>Yes</Option>',
        '    <Option value="no">No</Option>',
        '  </Question>',
        '</Questionnaire>'
      ].join('\n')
    )

    const content = await lessonContent(root)
    const questionnaire = content[0]
    if (questionnaire?.type !== 'questionnaire') throw new Error('Expected a questionnaire')
    expect(questionnaire.id).toBe('questionnaire:lessons/nested.mdx:6:1')
    expect(questionnaire.questions.map(({ id }) => id)).toEqual([
      'question:lessons/nested.mdx:7:3',
      'question:lessons/nested.mdx:12:3'
    ])
    expect((await lessonContent(root))[0]).toEqual(questionnaire)
  })

  it.each([
    ['Prompt', '<Video src="clip.mp4" />'],
    ['Prompt', '<Path><Page ref="next" /></Path>'],
    ['Prompt', '<Questionnaire><Question type="single-choice" /></Questionnaire>'],
    ['Option', '<Image src="diagram.svg" alt="diagram" />'],
    ['Option', '<b>HTML</b>'],
    ['Option', '{dynamicValue}']
  ] as const)('rejects nested markup in %s: %s', async (field, markup) => {
    const prompt = field === 'Prompt' ? markup : 'Question text'
    const option = field === 'Option' ? markup : 'Option text'
    const root = await makeLesson(
      `<Questionnaire><Question type="single-choice"><Prompt>${prompt}</Prompt><Option value="a" correct>${option}</Option><Option value="b">Other</Option></Question></Questionnaire>`
    )
    await expect(parsePackage(root)).rejects.toThrow(
      /Prompt and Option content cannot contain nested JSX, HTML, or MDX expressions/
    )
  })

  it('rejects standalone Prompt, Option, and removed or unknown components', async () => {
    for (const [content, error] of [
      ['<Prompt>Text</Prompt>', /unknown MDX component <Prompt>/],
      ['<Option value="x">Text</Option>', /unknown MDX component <Option>/],
      ['<Callout type="info">Text</Callout>', /unknown MDX component <Callout>/],
      ['<Example>Text</Example>', /unknown MDX component <Example>/],
      ['<Steps><Step>Text</Step></Steps>', /unknown MDX component <Steps>/],
      ['<Step>Text</Step>', /unknown MDX component <Step>/],
      ['<Mystery />', /unknown MDX component <Mystery>/],
      ['Before <Example>Nope</Example> after.', /unknown MDX component <Example>/]
    ] as const) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('rejects unknown attributes, dynamic values, and invalid semantic variants', async () => {
    for (const [content, error] of [
      ['<Image src="x" alt="" extra="no" />', /unknown attribute "extra"/],
      ['<Image src="x" />', /explicit string "alt" attribute/],
      ['<Video src="x" autoplay />', /unknown attribute "autoplay"/],
      ['<Video title="Missing source" />', /"src" must be a non-empty string/],
      [
        '<Image src="x" alt="" {...props} />',
        /spread\/dynamic component attributes are not supported/
      ],
      [
        '<Questionnaire><Question type="unsupported"><Prompt>Q</Prompt><Option value="a"/><Option value="b"/></Question></Questionnaire>',
        /Question "type" must be/
      ]
    ] as const) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('resolves all local assets relative to the declaring file and rejects missing assets', async () => {
    const root = await makeLesson(
      `![missing](assets/missing.svg)\n\n<Video src="media/video.mp4" poster="assets/poster.svg" captions="assets/captions.vtt" />`
    )
    await expect(parsePackage(root)).rejects.toThrow(/asset "assets\/missing\.svg" does not exist/)
    await asset(root, 'assets/missing.svg')
    await expect(parsePackage(root)).rejects.toThrow(/asset "media\/video\.mp4" does not exist/)
  })

  it('rejects unsupported Markdown nodes and MDX JavaScript with locations', async () => {
    const root = await makeLesson('<span>Unsupported raw HTML</span>')
    await expect(parsePackage(root)).rejects.toThrow(
      /lesson\.mdx:\d+(?::\d+)?: unknown MDX component <span>/
    )
    await writeFile(
      path.join(root, 'lesson.mdx'),
      "---\ntitle: Lesson\n---\nexport const runtime = 'edge';"
    )
    await expect(parsePackage(root)).rejects.toThrow(/MDX JavaScript is not supported/)
  })

  it('parses Scroll, Slides, and Tiles as distinct root modes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await mkdir(path.join(root, 'lessons'))
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: TypeScript\n---\n<Scroll>\n  <Page src="lessons/intro.mdx" />\n  <Page src="lessons/quiz.mdx" />\n</Scroll>`
    )
    await writeFile(path.join(root, 'lessons/intro.mdx'), '---\ntitle: Intro\n---\n# Hello')
    await writeFile(path.join(root, 'lessons/quiz.mdx'), '---\ntitle: Quiz\n---')
    const parsedScroll = await parsePackage(root)
    expect(parsedScroll.metadata).toEqual({ title: 'TypeScript', lang: 'en' })
    expect(parsedScroll.presentation).toMatchObject({
      type: 'scroll',
      pages: [
        {
          type: 'page',
          source: 'lessons/intro.mdx',
          id: 'page:lessons/intro.mdx',
          metadata: { title: 'Intro' }
        },
        {
          type: 'page',
          source: 'lessons/quiz.mdx',
          id: 'page:lessons/quiz.mdx',
          metadata: { title: 'Quiz' }
        }
      ]
    })

    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Deck\n---\n<Slides>\n  <Page src="lessons/intro.mdx" />\n  <Page src="lessons/quiz.mdx" />\n</Slides>`
    )
    expect((await parsePackage(root)).presentation).toMatchObject({
      type: 'slides',
      pages: [
        { type: 'page', id: 'page:lessons/intro.mdx' },
        { type: 'page', id: 'page:lessons/quiz.mdx' }
      ]
    })

    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Practice\n---\n<Tiles columns={2}><Item src="lessons/intro.mdx" /><Item src="lessons/quiz.mdx" /></Tiles>`
    )
    const parsedTiles = await parsePackage(root)
    expect(parsedTiles.presentation).toMatchObject({
      type: 'tiles',
      columns: 2,
      items: [
        {
          type: 'item',
          source: 'lessons/intro.mdx',
          id: 'item:lessons/intro.mdx'
        },
        {
          type: 'item',
          source: 'lessons/quiz.mdx',
          id: 'item:lessons/quiz.mdx'
        }
      ]
    })
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Practice\n---\n<Tiles><Item src="lessons/intro.mdx" /></Tiles>'
    )
    const defaultTiles = (await parsePackage(root)).presentation
    expect(defaultTiles.type).toBe('tiles')
    if (defaultTiles.type === 'tiles') expect(defaultTiles).not.toHaveProperty('columns')
  })

  it('requires exactly one supported root presentation and a root title', async () => {
    for (const [source, error] of [
      [
        '---\ntitle: Package\n---\n',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 0/
      ],
      [
        '---\ntitle: Package\n---\n<Tiles><Item src="a.mdx" /></Tiles><Scroll><Page src="a.mdx" /></Scroll>',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 2/
      ],
      [
        '---\ntitle: Package\n---\n<Item src="a.mdx" />',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 1 direct node \(<Item>\)/
      ],
      [
        '---\ntitle: Package\n---\n<Page src="a.mdx" />',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 1 direct node \(<Page>\)/
      ],
      [
        '---\ntitle: Package\n---\n<Grid><Item src="a.mdx" /></Grid>',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 1 direct node \(<Grid>\)/
      ],
      [
        '---\ntitle: Package\n---\nA root paragraph is not allowed.',
        /exactly one <Scroll>, <Slides> or <Tiles> presentation; found 1 direct node \(paragraph\)/
      ],
      ['---\n---\n<Scroll><Page src="a.mdx" /></Scroll>', /"title" must be a non-empty string/],
      [
        '---\ntitle: Package\ndescription: Not supported\n---\n<Scroll><Page src="a.mdx" /></Scroll>',
        /unknown frontmatter field "description"/
      ]
    ] as const) {
      const root = await makePackage(source)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('validates presentation children, nesting, attributes, and Tiles columns', async () => {
    for (const [rootContent, error] of [
      ['<Scroll><Item src="a.mdx" /></Scroll>', /Scroll> children may only contain direct <Page/],
      ['<Slides><Item src="a.mdx" /></Slides>', /Slides> children may only contain direct <Page/],
      ['<Tiles><Page src="a.mdx" /></Tiles>', /Tiles> children may only contain direct <Item/],
      [
        '<Tiles><Tile src="a.mdx" /></Tiles>',
        /Tiles> children may only contain direct <Item .*found <Tile>/
      ],
      ['<Scroll title="bad"><Page src="a.mdx" /></Scroll>', /unknown attribute "title"/],
      ['<Tiles rows={2}><Item src="a.mdx" /></Tiles>', /unknown attribute "rows"/],
      ['<Tiles columns={0}><Item src="a.mdx" /></Tiles>', /columns.*integer from 1 to 12/],
      ['<Tiles columns={13}><Item src="a.mdx" /></Tiles>', /columns.*integer from 1 to 12/],
      ['<Tiles columns="2"><Item src="a.mdx" /></Tiles>', /columns.*integer from 1 to 12/],
      [
        '<Scroll><Page src="a.mdx"><Item src="b.mdx" /></Page></Scroll>',
        /Page> must be self-closing/
      ],
      [
        '<Scroll><Scroll><Page src="a.mdx" /></Scroll></Scroll>',
        /Scroll> children may only contain direct <Page/
      ],
      ['<Scroll />', /Scroll> must contain at least one <Page>; found 0/],
      ['<Slides />', /Slides> must contain at least one <Page>; found 0/],
      ['<Tiles />', /Tiles> must contain at least one <Item>; found 0/]
    ] as const) {
      const root = await makePackage(`---\ntitle: Package\n---\n${rootContent}`)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('keeps the declaration look-ahead from masking earlier invalid Scroll children', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Scroll><Video src="missing.mp4" /><Page src={dynamic} /></Scroll>`
    )
    await expect(parsePackage(root)).rejects.toThrow(
      /<Scroll> children may only contain direct <Page .*found <Video>/
    )
  })

  it('keeps later valid declarations available past a malformed look-ahead declaration', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Scroll>\n  <Page src="first.mdx" />\n  <Page src={dynamic} />\n  <Page src="later.mdx" />\n</Scroll>`
    )
    await writeFile(
      path.join(root, 'first.mdx'),
      '---\ntitle: First\n---\n<Path><Page ref="later.mdx" /></Path>'
    )
    await writeFile(path.join(root, 'later.mdx'), '---\ntitle: Later\n---')

    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+(?::\d+)?: dynamic value for attribute "src" is not supported/
    )
  })

  it('resolves references and assets relative to each source file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await mkdir(path.join(root, 'lessons'), { recursive: true })
    await asset(root, 'assets/shared.svg')
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lessons/page.mdx" /></Scroll>'
    )
    await writeFile(
      path.join(root, 'lessons/page.mdx'),
      '---\ntitle: Page\n---\n![shared](../assets/shared.svg)'
    )
    const pagePackage = await parsePackage(root)
    expect(pagePackage.presentation).toMatchObject({
      type: 'scroll',
      pages: [
        {
          id: 'page:lessons/page.mdx',
          source: 'lessons/page.mdx',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'image', src: 'assets/shared.svg' }]
            }
          ]
        }
      ]
    })
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Tiles><Item src="lessons/page.mdx" /></Tiles>'
    )
    expect((await parsePackage(root)).presentation).toMatchObject({
      type: 'tiles',
      items: [{ id: 'item:lessons/page.mdx', source: 'lessons/page.mdx' }]
    })
  })

  it('rejects description, thumbnail, and id frontmatter on referenced docs', async () => {
    for (const kind of ['page', 'item'] as const) {
      for (const field of [
        ...(kind === 'item' ? ['description: Not supported'] : []),
        'lang: pt-BR',
        'thumbnail: cover.svg',
        'id: custom'
      ]) {
        const reference =
          kind === 'page'
            ? '<Scroll><Page src="lesson.mdx" /></Scroll>'
            : '<Tiles><Item src="lesson.mdx" /></Tiles>'
        const root = await makePackage(`---\ntitle: Package\n---\n${reference}`)
        await writeFile(path.join(root, 'lesson.mdx'), `---\ntitle: Lesson\n${field}\n---`)
        await expect(parsePackage(root)).rejects.toThrow(/unknown frontmatter field/)
        await rm(root, { recursive: true, force: true })
        temp = ''
      }
    }
  })

  it('parses Paths as ordered references to root Scroll page IDs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await mkdir(path.join(root, 'lessons'))
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lessons/start.mdx" /><Page src="lessons/types.mdx" /></Scroll>'
    )
    await writeFile(
      path.join(root, 'lessons/start.mdx'),
      '---\ntitle: Start\n---\n<Path><Page ref="lessons/types.mdx" /></Path>'
    )
    await writeFile(
      path.join(root, 'lessons/types.mdx'),
      '---\ntitle: Types\ndescription: Learn about types\n---\n# Types'
    )

    const parsed = await parsePackage(root)
    expect(parsed.presentation).toMatchObject({
      type: 'scroll',
      pages: [
        {
          id: 'page:lessons/start.mdx',
          content: [{ type: 'path', pageIds: ['page:lessons/types.mdx'] }]
        },
        {
          id: 'page:lessons/types.mdx',
          metadata: { title: 'Types', description: 'Learn about types' }
        }
      ]
    })
    const pages = parsed.presentation.type === 'scroll' ? parsed.presentation.pages : []
    expect(pages[0]?.content[0]).toEqual({
      type: 'path',
      pageIds: ['page:lessons/types.mdx']
    })
    expect(pages[0]?.content[0]).not.toHaveProperty('source')
  })

  it('rejects an empty Path with a useful child requirement', async () => {
    for (const content of ['<Path />', '<Path></Path>']) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(
        /Path requires at least one direct <Page ref="\.\.\." \/> child/
      )
      await rm(root, { recursive: true, force: true })
      temp = ''
    }
  })

  it('validates Path children, refs, attributes, uniqueness, and root Scroll context', async () => {
    for (const [content, error] of [
      ['<Path><Page /></Path>', /"ref" must be a non-empty string/],
      ['<Path title="Journey"><Page ref="lesson.mdx" /></Path>', /unknown attribute "title"/],
      [
        '<Path><Page ref="lesson.mdx"><Video src="x" /></Page></Path>',
        /Page> inside <Path> must be self-closing/
      ],
      [
        '<Path><Page ref="lesson.mdx" /><Page ref="./lesson.mdx" /></Path>',
        /duplicate Path Page ref/
      ],
      ['<Path><Page ref="missing.mdx" /></Path>', /does not match a root <Page src=/],
      ['<Path><Video src="x" /></Path>', /Path may contain only direct <Page ref=/]
    ] as const) {
      const root = await makeLesson(content)
      await expect(parsePackage(root)).rejects.toThrow(error)
      await rm(root, { recursive: true, force: true })
      temp = ''
    }

    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'))
    temp = root
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Tiles><Item src="lesson.mdx" /></Tiles>'
    )
    await writeFile(
      path.join(root, 'lesson.mdx'),
      '---\ntitle: Lesson\n---\n<Path><Page ref="lesson.mdx" /></Path>'
    )
    await expect(parsePackage(root)).rejects.toThrow(
      /only valid for pages declared directly in a root <Scroll> or <Slides>/
    )
    await writeFile(path.join(root, 'lesson.mdx'), '---\ntitle: Lesson\n---\n<Path><Page /></Path>')
    await expect(parsePackage(root)).rejects.toThrow(/"ref" must be a non-empty string/)
  })
})
