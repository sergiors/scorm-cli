/**
 * Regression tests for JSX comment support (block comments wrapped in braces)
 * in the MDX content parser: `isJsxCommentExpression` classification,
 * comment-only expression normalization in `parseMdx`, raw Prompt/Option text
 * extraction in the question grammar, rejection of executable expressions, and
 * the literal wording of comment syntax inside code.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AstNode, AstPosition, ContentSource } from '../ast'
import { isJsx, isJsxCommentExpression } from '../ast'
import type { ContentNode } from '@scorm-cli/core'
import { parseContentNodes } from '../content'
import { parsePackage } from '../index'
import { parseMdx } from '../mdx'
import { parseQuestion, parseQuestionnaire } from '../question'
import type { QuestionNode, QuestionnaireNode } from '@scorm-cli/core'

const file = '/pkg/lessons/check.mdx'
const root = '/pkg'

function findJsx(nodes: AstNode[], name: string): AstNode | undefined {
  for (const node of nodes) {
    if (isJsx(node) && node.name === name) return node
    const found = findJsx(node.children ?? [], name)
    if (found) return found
  }
  return undefined
}

function commentExpression(
  type: 'mdxFlowExpression' | 'mdxTextExpression',
  body: Array<{ type?: string }> = [],
  comments?: Array<{ type?: string }>
): AstNode {
  return {
    type,
    value: '/* note */',
    data: { estree: { body, ...(comments ? { comments } : {}) } }
  }
}

function questionSource(prompt: string): string {
  return (
    `<Question type="true-false">\n` +
    `  <Prompt>${prompt}</Prompt>\n` +
    `  <Option value="yes" correct>Yes</Option>\n` +
    `  <Option value="no">No</Option>\n` +
    `</Question>`
  )
}

function context(sourceText: string): ContentSource {
  return { sourceFile: file, root, sourceText, sourceLineOffset: 0 }
}

async function parseQuestionSource(source: string): Promise<QuestionNode> {
  const question = findJsx(parseMdx(source, file).children, 'Question')
  if (!question) throw new Error('test fixture bug: no <Question> in source')
  return parseQuestion(question, context(source))
}

async function parseQuestionnaireSource(source: string): Promise<QuestionnaireNode> {
  const questionnaire = findJsx(parseMdx(source, file).children, 'Questionnaire')
  if (!questionnaire) throw new Error('test fixture bug: no <Questionnaire> in source')
  return parseQuestionnaire(questionnaire, context(source))
}

async function convertAll(source: string): Promise<ContentNode[]> {
  const output: ContentNode[] = []
  for (const child of parseMdx(source, file).children) {
    output.push(...(await parseContentNodes(child, file, root, undefined, 0, source)))
  }
  return output
}

describe('isJsxCommentExpression classification', () => {
  it('accepts flow and text expressions holding only Block comments', () => {
    const comment = [{ type: 'Block' }]
    expect(isJsxCommentExpression(commentExpression('mdxFlowExpression', [], comment))).toBe(true)
    expect(isJsxCommentExpression(commentExpression('mdxTextExpression', [], comment))).toBe(true)
  })

  it('rejects expressions that also contain executable code', () => {
    const comment = [{ type: 'Block' }]
    expect(
      isJsxCommentExpression(
        commentExpression('mdxTextExpression', [{ type: 'ExpressionStatement' }], comment)
      )
    ).toBe(false)
  })

  it('rejects line comments; only JSX block comments are ignored', () => {
    const line = [{ type: 'Line' }]
    expect(isJsxCommentExpression(commentExpression('mdxFlowExpression', [], line))).toBe(false)
    const mixed = [{ type: 'Block' }, { type: 'Line' }]
    expect(isJsxCommentExpression(commentExpression('mdxFlowExpression', [], mixed))).toBe(false)
  })

  it('requires at least one comment', () => {
    expect(isJsxCommentExpression(commentExpression('mdxFlowExpression'))).toBe(false)
    expect(isJsxCommentExpression({ type: 'mdxTextExpression', value: '/* x */' })).toBe(false)
  })

  it('rejects non-expression nodes', () => {
    expect(isJsxCommentExpression({ type: 'text', value: '/* x */' })).toBe(false)
    expect(isJsxCommentExpression({ type: 'paragraph' })).toBe(false)
  })
})

describe('comment-only MDX flow expressions between blocks', () => {
  it('removes flow comments without creating content or empty paragraphs', async () => {
    const source = 'First\n\n{/* a block comment */}\n\n{/* spanning\ncomment */}\n\nSecond'
    const { children } = parseMdx(source, file)
    expect(children).toHaveLength(2)
    expect(children.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
    expect(
      children.some(
        (node) => node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression'
      )
    ).toBe(false)

    // The comment does not join or drop the surrounding paragraphs.
    expect(await convertAll(source)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'First' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'Second' }] }
    ])
  })

  it('leaves a document with only comments empty', () => {
    expect(parseMdx('{/* just a comment */}', file).children).toEqual([])
    expect(parseMdx('Only\n\n{/* dropped */}\n\ntext', file).children).toHaveLength(2)
  })

  it('does not report a comment-only document as content', async () => {
    expect(await convertAll('{/* no content */}')).toEqual([])
    expect(await convertAll('Before\n\n{/* dropped */}')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'Before' }] }
    ])
  })
})

describe('comment-only MDX text expressions inside paragraphs', () => {
  it('drops the expression and keeps sibling text whitespace as authored', async () => {
    const source = 'Say {/* mid */} hi'
    const { children } = parseMdx(source, file)
    const paragraph = children[0]!
    expect(paragraph.type).toBe('paragraph')
    expect(
      paragraph.children?.map((child) => ({
        type: child.type,
        value: (child as { value?: unknown }).value
      }))
    ).toEqual([
      { type: 'text', value: 'Say ' },
      { type: 'text', value: ' hi' }
    ])
    expect(await convertAll(source)).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Say ' },
          { type: 'text', value: ' hi' }
        ]
      }
    ])
  })

  it('records the removed comment source range on the parent node', () => {
    const source = '<Option value="yes" correct>{/* keep me */}Real text</Option>'
    const option = findJsx(parseMdx(source, file).children, 'Option')!
    const spans: AstPosition[] = option.commentSpans ?? []
    expect(spans).toHaveLength(1)
    const start = spans[0]!.start?.offset
    const end = spans[0]!.end?.offset
    expect(source.slice(start, end)).toBe('{/* keep me */}')
    expect(option.children?.map((child) => child.type)).toEqual(['text'])
  })

  it('records one span per removed comment in document order', () => {
    const source = '<Option value="yes" correct>{/* a */}B{/* b */}</Option>'
    const option = findJsx(parseMdx(source, file).children, 'Option')!
    const spans = option.commentSpans ?? []
    expect(spans).toHaveLength(2)
    expect(source.slice(spans[0]!.start?.offset, spans[0]!.end?.offset)).toBe('{/* a */}')
    expect(source.slice(spans[1]!.start?.offset, spans[1]!.end?.offset)).toBe('{/* b */}')
  })

  it('collapses a paragraph holding only comments to no content', async () => {
    expect(await convertAll('Hi {/* gone */}')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'Hi ' }] }
    ])
  })
})

describe('comments inside Prompt and Option text', () => {
  it('strips a comment between Prompt words without inserting whitespace', async () => {
    const question = await parseQuestionSource(questionSource('Yes{/* mid */}No'))
    expect(question.prompt).toBe('YesNo')
  })

  it('keeps plain-text whitespace authored around a comment', async () => {
    const question = await parseQuestionSource(questionSource('Yes {/* mid */} No'))
    expect(question.prompt).toBe('Yes No')
  })

  it('strips multiline comments and collapses the surrounding indentation', async () => {
    const question = await parseQuestionSource(
      questionSource('Is {/* spanning\ncomment */} it real?')
    )
    expect(question.prompt).toBe('Is it real?')
  })

  it('strips lead and trailing comments around Option text', async () => {
    const source =
      '<Question type="true-false">\n' +
      '  <Prompt>Is it real?</Prompt>\n' +
      '  <Option value="yes" correct>\n' +
      '    {/* lead */}\n' +
      '    Yes indeed\n' +
      '    {/* tail */}\n' +
      '  </Option>\n' +
      '  <Option value="no">No</Option>\n' +
      '</Question>'
    const question = await parseQuestionSource(source)
    expect(question.prompt).toBe('Is it real?')
    expect(question.options.map((option) => option.content)).toEqual(['Yes indeed', 'No'])
  })

  it('extracts a comment-only Option as empty raw text rather than nested JSX', async () => {
    const source =
      '<Question type="true-false">\n' +
      '  <Prompt>Prompt</Prompt>\n' +
      '  <Option value="yes" correct>{/* only a comment */}</Option>\n' +
      '  <Option value="no">No</Option>\n' +
      '</Question>'
    const question = await parseQuestionSource(source)
    expect(question.prompt).toBe('Prompt')
    expect(question.options.map((option) => option.content)).toEqual(['', 'No'])
  })

  it('leaves a comment-only Prompt with empty prompt text', async () => {
    const source =
      '<Question type="true-false">\n' +
      '  <Prompt>{/* no text */}</Prompt>\n' +
      '  <Option value="yes" correct>Yes</Option>\n' +
      '  <Option value="no">No</Option>\n' +
      '</Question>'
    const question = await parseQuestionSource(source)
    expect(question.prompt).toBe('')
  })
})

describe('comments between Question and Questionnaire children', () => {
  const firstQuestion = questionSource('P1')
  const secondQuestion = questionSource('P2')
  const questionnaire = (comments: string[]): string =>
    `<Questionnaire>\n${comments[0]}\n${firstQuestion}\n${comments[1]}` +
    `\n${secondQuestion}\n${comments[2]}\n</Questionnaire>`

  it('counts only real Questions despite surrounding comments', async () => {
    const parsed = await parseQuestionnaireSource(
      questionnaire(['{/* q1 */}', '{/* q2 */}', '{/* tail */}'])
    )
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions.map((question) => question.prompt)).toEqual(['P1', 'P2'])
  })

  it('keeps a comment between Prompt and Option from adding a child', async () => {
    const source =
      '<Questionnaire>\n' +
      '  <Question type="true-false">\n' +
      '    {/* before prompt */}\n' +
      '    <Prompt>Pick one</Prompt>\n' +
      '    {/* between prompt and options */}\n' +
      '    <Option value="yes" correct>Yes</Option>\n' +
      '    {/* after options */}\n' +
      '    <Option value="no">No</Option>\n' +
      '  </Question>\n' +
      '</Questionnaire>'
    const parsed = await parseQuestionnaireSource(source)
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0]!.prompt).toBe('Pick one')
    expect(parsed.questions[0]!.options.map((option) => option.content)).toEqual(['Yes', 'No'])
  })

  it('rejects a questionnaire whose only children are comments', async () => {
    await expect(
      parseQuestionnaireSource('<Questionnaire>{/* none */}</Questionnaire>')
    ).rejects.toThrow(/Questionnaire must contain at least one direct <Question>/)
  })
})

describe('executable MDX expressions stay rejected alongside comment support', () => {
  it('rejects an ordinary text expression inside a paragraph', async () => {
    await expect(convertAll('Some {1 + 2} text')).rejects.toThrow(
      /unsupported inline node "mdxTextExpression"/
    )
  })

  it('rejects an ordinary flow expression between blocks', async () => {
    await expect(convertAll('Paragraph.\n\n{1 + 1}\n\nAnother.')).rejects.toThrow(
      /unsupported content node "mdxFlowExpression"/
    )
  })

  it('rejects a mixed comment and executable text expression', async () => {
    await expect(convertAll('Some {/* note */ 1 + 2} text')).rejects.toThrow(
      /unsupported inline node "mdxTextExpression"/
    )
  })

  it('rejects a mixed comment and executable flow expression', async () => {
    await expect(convertAll('{/* note */ 2 + 2}')).rejects.toThrow(
      /unsupported content node "mdxFlowExpression"/
    )
  })

  it('rejects a line-comment-only expression; block comments alone are ignored', async () => {
    await expect(convertAll('Some { // only a line comment\n} text')).rejects.toThrow(
      /unsupported inline node "mdxTextExpression"/
    )
  })

  it('rejects executable expressions inside Prompt and Option text', async () => {
    const inPrompt =
      '<Questionnaire>\n' +
      '  <Question type="true-false">\n' +
      '    <Prompt>A {1 + 2} B</Prompt>\n' +
      '    <Option value="yes" correct>Yes</Option>\n' +
      '    <Option value="no">No</Option>\n' +
      '  </Question>\n' +
      '</Questionnaire>'
    await expect(parseQuestionnaireSource(inPrompt)).rejects.toThrow(
      /Prompt and Option content cannot contain nested JSX, HTML, or MDX expressions/
    )

    const mixedInOption =
      '<Questionnaire>\n' +
      '  <Question type="true-false">\n' +
      '    <Prompt>P</Prompt>\n' +
      '    <Option value="yes" correct>{/* note */ 1 + 2}</Option>\n' +
      '    <Option value="no">No</Option>\n' +
      '  </Question>\n' +
      '</Questionnaire>'
    await expect(parseQuestionnaireSource(mixedInOption)).rejects.toThrow(
      /Prompt and Option content cannot contain nested JSX, HTML, or MDX expressions/
    )
  })
})

describe('comment syntax inside code stays literal', () => {
  it('keeps a JSX comment verbatim inside a fenced code block', async () => {
    expect(await convertAll('```\n{/* not a comment */}\n```')).toEqual([
      { type: 'code', value: '{/* not a comment */}' }
    ])
  })

  it('keeps a JSX comment verbatim inside inline code', async () => {
    expect(await convertAll('Use `a {/* x */} b` here')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Use ' },
          { type: 'inlineCode', value: 'a {/* x */} b' },
          { type: 'text', value: ' here' }
        ]
      }
    ])
  })
})

describe('lesson package with JSX comments end to end', () => {
  let temp: string

  afterEach(async () => {
    if (temp) await rm(temp, { recursive: true, force: true })
    temp = ''
  })

  async function makeLesson(content: string): Promise<string> {
    temp = await mkdtemp(path.join(os.tmpdir(), 'comment-package-'))
    await writeFile(
      path.join(temp, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>'
    )
    await writeFile(path.join(temp, 'lesson.mdx'), `---\ntitle: Lesson\n---\n${content}`)
    return temp
  }

  async function lessonContent(packageRoot: string): Promise<ContentNode[]> {
    const parsed = await parsePackage(packageRoot)
    if (parsed.presentation.type !== 'scroll') throw new Error('Expected a scroll presentation')
    const page = parsed.presentation.pages[0]
    if (!page) throw new Error('Expected a page')
    return page.content
  }

  const lesson = [
    '{/* intro comment */}',
    '',
    '# Check-in',
    '',
    'Before the lesson, {/* inline note */} confirm your setup.',
    '',
    '<Questionnaire>',
    '  {/* Question 1 */}',
    '  <Question type="true-false">',
    '    {/* before prompt */}',
    '    <Prompt>',
    '      TypeScript',
    '      {/* mid prompt */}',
    '      catches errors at build time.',
    '    </Prompt>',
    '    <Option value="yes" correct>',
    '      {/* lead */}',
    '      **Yes**, at *build* time',
    '      {/* tail */}',
    '    </Option>',
    '    <Option value="no">No</Option>',
    '  </Question>',
    '  {/* between questions */}',
    '  <Question type="single-choice">',
    '    <Prompt>Pick{/* a */} one</Prompt>',
    '    <Option value="a" correct>Answer{/* b */}A</Option>',
    '    <Option value="b">B</Option>',
    '  </Question>',
    '  {/* trailing comment */}',
    '</Questionnaire>'
  ].join('\n')

  it('parses comments without content, empty paragraphs, or extra questions', async () => {
    const content = await lessonContent(await makeLesson(lesson))

    expect(content).toHaveLength(3)
    const [heading, paragraph, questionnaire] = content
    expect(heading).toEqual({
      type: 'heading',
      depth: 1,
      children: [{ type: 'text', value: 'Check-in' }]
    })
    // Plain-text whitespace is preserved verbatim around the inline comment.
    expect(paragraph).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Before the lesson, ' },
        { type: 'text', value: ' confirm your setup.' }
      ]
    })
    if (questionnaire?.type !== 'questionnaire') throw new Error('Expected a questionnaire')
    expect(questionnaire.questions).toHaveLength(2)
    expect(questionnaire.questions).toMatchObject([
      {
        questionType: 'true-false',
        prompt: 'TypeScript catches errors at build time.',
        options: [
          { value: 'yes', correct: true, content: '**Yes**, at *build* time' },
          { value: 'no', correct: false, content: 'No' }
        ]
      },
      {
        questionType: 'single-choice',
        prompt: 'Pick one',
        options: [
          { value: 'a', correct: true, content: 'AnswerA' },
          { value: 'b', correct: false, content: 'B' }
        ]
      }
    ])
  })
})
