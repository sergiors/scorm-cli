import type { QuestionNode, QuestionOption, QuestionType, QuestionnaireNode } from '@scorm-cli/core'
import { sourceNodeId } from './io'
import type { AstPosition, ContentSource } from './ast'
import { componentName } from './component-name'
import type { AstNode } from './ast'
import { isJsx, isJsxCommentExpression, rawComponentName, whitespace } from './ast'
import { assertAttributes, attrs, requiredString, sourceLocation } from './shared'

interface AnswerCountRule {
  count: 'options' | 'correct'
  exactly?: number
  atLeast?: number
  message: string
}

const answerCountRules: Record<QuestionType, AnswerCountRule[]> = {
  'single-choice': [
    {
      count: 'correct',
      exactly: 1,
      message: 'single-choice Question must have exactly one correct Option'
    }
  ],
  'multiple-choice': [
    {
      count: 'correct',
      atLeast: 1,
      message: 'multiple-choice Question must have at least one correct Option'
    }
  ],
  'true-false': [
    { count: 'options', exactly: 2, message: 'true-false Question must have exactly 2 Options' },
    {
      count: 'correct',
      exactly: 1,
      message: 'true-false Question must have exactly one correct Option'
    }
  ]
}

export function questionAnswerRuleError(
  type: QuestionType,
  optionCount: number,
  correctCount: number
): string | undefined {
  for (const rule of answerCountRules[type]) {
    const count = rule.count === 'options' ? optionCount : correctCount
    if (rule.exactly !== undefined && count !== rule.exactly) {
      return rule.message
    }
    if (rule.atLeast !== undefined && count < rule.atLeast) {
      return rule.message
    }
  }
  return undefined
}

/** Unwraps parser-generated paragraphs that contain only the allowed components. */
export function normalizeQuestionChildren(
  children: AstNode[],
  componentNames: readonly string[]
): AstNode[] {
  return children
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) =>
            whitespace(nested) || (isJsx(nested) && componentNames.includes(componentName(nested)))
        )
      ) {
        return child.children ?? []
      }
      return [child]
    })
    .filter((child) => !whitespace(child))
}

function questionParts(node: AstNode, file: string): { prompt: AstNode; options: AstNode[] } {
  const prompts: AstNode[] = []
  const options: AstNode[] = []
  for (const child of normalizeQuestionChildren(node.children ?? [], ['Prompt', 'Option'])) {
    if (!isJsx(child)) {
      throw new Error(
        `${sourceLocation(file, child)}: Question may contain only <Prompt> and <Option> components`
      )
    }
    if (componentName(child) === 'Prompt') {
      prompts.push(child)
    } else if (componentName(child) === 'Option') {
      options.push(child)
    } else {
      throw new Error(
        `${sourceLocation(file, child)}: unknown Question child <${rawComponentName(child)}>`
      )
    }
  }

  if (prompts.length !== 1) {
    throw new Error(
      `${sourceLocation(file, node)}: Question must contain exactly 1 Prompt; found ${prompts.length}`
    )
  }

  if (options.length < 2) {
    throw new Error(
      `${sourceLocation(file, node)}: Question must contain at least 2 Options; found ${options.length}`
    )
  }

  return { prompt: prompts[0]!, options }
}

function isQuestionType(value: unknown): value is QuestionType {
  return value === 'single-choice' || value === 'multiple-choice' || value === 'true-false'
}

function sourceOffset(
  source: string,
  position: { line?: number; column?: number; offset?: number } | undefined
): number | undefined {
  if (
    typeof position?.offset === 'number' &&
    Number.isInteger(position.offset) &&
    position.offset >= 0 &&
    position.offset <= source.length
  ) {
    return position.offset
  }
  if (!position?.line || !position.column) return undefined
  let offset = 0
  for (let line = 1; line < position.line; line += 1) {
    let newline = offset
    while (newline < source.length && source[newline] !== '\n' && source[newline] !== '\r') {
      newline += 1
    }
    if (newline === source.length) return undefined
    offset = newline + (source[newline] === '\r' && source[newline + 1] === '\n' ? 2 : 1)
  }
  return offset + position.column - 1
}

function rawFieldText(node: AstNode, context: ContentSource): string {
  const children = node.children ?? []
  const commentSpans: AstPosition[] = [...(node.commentSpans ?? [])]
  for (const child of children) {
    const stack = [child]
    while (stack.length) {
      const nested = stack.pop()!
      commentSpans.push(...(nested.commentSpans ?? []))
      if (isJsxCommentExpression(nested)) {
        if (nested.position) commentSpans.push(nested.position)
        continue
      }
      if (
        nested.type === 'html' ||
        nested.type === 'mdxjsEsm' ||
        nested.type.startsWith('mdxJsx') ||
        nested.type === 'mdxFlowExpression' ||
        nested.type === 'mdxTextExpression'
      ) {
        const name = rawComponentName(nested)
        const detail = name ? ` (<${name}>)` : ` (${nested.type})`
        throw new Error(
          `${sourceLocation(context.sourceFile, nested)}: Prompt and Option content cannot contain nested JSX, HTML, or MDX expressions${detail}`
        )
      }
      stack.push(...(nested.children ?? []))
    }
  }

  const spans = commentSpans.map((position) => ({
    start: sourceOffset(context.sourceText, position.start),
    end: sourceOffset(context.sourceText, position.end)
  }))
  if (
    spans.some(
      (span) =>
        span.start === undefined ||
        span.end === undefined ||
        span.start < 0 ||
        span.end > context.sourceText.length ||
        span.end < span.start
    )
  ) {
    throw new Error(
      `${sourceLocation(context.sourceFile, node)}: unable to extract raw Prompt or Option text from the MDX source`
    )
  }
  if (!children.length && !spans.length) return ''

  const childStart = sourceOffset(context.sourceText, children[0]?.position?.start)
  const childEnd = sourceOffset(context.sourceText, children.at(-1)?.position?.end)
  if (
    (children.length && (childStart === undefined || childEnd === undefined)) ||
    (spans.length === 0 && childStart === undefined)
  ) {
    throw new Error(
      `${sourceLocation(context.sourceFile, node)}: unable to extract raw Prompt or Option text from the MDX source`
    )
  }
  const validSpans = spans as Array<{ start: number; end: number }>
  const start = Math.min(
    childStart ?? Number.POSITIVE_INFINITY,
    ...validSpans.map((span) => span.start)
  )
  const end = Math.max(childEnd ?? Number.NEGATIVE_INFINITY, ...validSpans.map((span) => span.end))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(
      `${sourceLocation(context.sourceFile, node)}: unable to extract raw Prompt or Option text from the MDX source`
    )
  }

  let raw = context.sourceText.slice(start, end)
  for (const span of [...validSpans].sort((a, b) => b.start - a.start)) {
    raw = raw.slice(0, span.start - start) + raw.slice(span.end - start)
  }
  return raw.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
}

async function parseOptions(
  nodes: AstNode[],
  file: string,
  context: ContentSource
): Promise<QuestionOption[]> {
  const seenValues = new Set<string>()
  const options: QuestionOption[] = []
  for (const node of nodes) {
    const values = attrs(node, file)
    assertAttributes(values, ['value', 'correct'], file, node)
    const value = requiredString(values.value, 'value', file, node)
    if (seenValues.has(value)) {
      throw new Error(`${sourceLocation(file, node)}: Option value "${value}" must be unique`)
    }
    seenValues.add(value)
    if (values.correct !== undefined && typeof values.correct !== 'boolean') {
      throw new Error(`${sourceLocation(file, node)}: Option "correct" must be a boolean`)
    }
    options.push({
      value,
      correct: values.correct === true,
      content: rawFieldText(node, context)
    })
  }
  return options
}

export async function parseQuestion(node: AstNode, context: ContentSource): Promise<QuestionNode> {
  const { sourceFile: file, root, sourceLineOffset = 0 } = context
  const values = attrs(node, file)
  assertAttributes(values, ['type'], file, node)
  const type = values.type
  if (!isQuestionType(type)) {
    throw new Error(
      `${sourceLocation(file, node)}: Question "type" must be "single-choice", "multiple-choice", or "true-false"`
    )
  }

  const { prompt: promptNode, options: optionNodes } = questionParts(node, file)
  const promptAttrs = attrs(promptNode, file)
  assertAttributes(promptAttrs, [], file, promptNode)
  const prompt = rawFieldText(promptNode, context)
  const options = await parseOptions(optionNodes, file, context)
  const correctCount = options.filter((option) => option.correct).length
  const ruleError = questionAnswerRuleError(type, options.length, correctCount)
  if (ruleError) {
    throw new Error(`${sourceLocation(file, node)}: ${ruleError}`)
  }

  return {
    type: 'question',
    id: sourceNodeId('question', node, file, root, sourceLineOffset),
    questionType: type,
    prompt,
    options
  }
}

export async function parseQuestionnaire(
  node: AstNode,
  context: ContentSource
): Promise<QuestionnaireNode> {
  const { sourceFile: file, root, sourceLineOffset = 0 } = context
  const values = attrs(node, file)
  assertAttributes(
    values,
    ['contributesToScore', 'expanded', 'maxAttempts', 'revealCorrectAnswers', 'shuffleOptions'],
    file,
    node
  )
  if (values.contributesToScore !== undefined && typeof values.contributesToScore !== 'boolean') {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire "contributesToScore" must be a boolean`
    )
  }
  if (values.expanded !== undefined && typeof values.expanded !== 'boolean') {
    throw new Error(`${sourceLocation(file, node)}: Questionnaire "expanded" must be a boolean`)
  }
  if (values.shuffleOptions !== undefined && typeof values.shuffleOptions !== 'boolean') {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire "shuffleOptions" must be a boolean`
    )
  }
  if (
    values.revealCorrectAnswers !== undefined &&
    typeof values.revealCorrectAnswers !== 'boolean'
  ) {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire "revealCorrectAnswers" must be a boolean`
    )
  }
  if (
    values.maxAttempts !== undefined &&
    (typeof values.maxAttempts !== 'number' ||
      !Number.isSafeInteger(values.maxAttempts) ||
      (values.maxAttempts !== -1 && values.maxAttempts <= 0))
  ) {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire "maxAttempts" must be a positive integer or -1`
    )
  }

  const children = normalizeQuestionChildren(node.children ?? [], ['Question'])
  if (children.length === 0) {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire must contain at least one direct <Question>`
    )
  }

  const questions: QuestionNode[] = []
  for (const child of children) {
    if (!isJsx(child) || componentName(child) !== 'Question') {
      const name = rawComponentName(child)
      const found = name ? `<${name}>` : child.type
      throw new Error(
        `${sourceLocation(file, child)}: Questionnaire may contain only direct <Question> children; found ${found}`
      )
    }
    questions.push(await parseQuestion(child, context))
  }

  return {
    type: 'questionnaire',
    id: sourceNodeId('questionnaire', node, file, root, sourceLineOffset),
    contributesToScore: values.contributesToScore !== false,
    revealCorrectAnswers: values.revealCorrectAnswers !== false,
    maxAttempts: values.maxAttempts ?? 1,
    expanded: values.expanded === true,
    shuffleOptions: values.shuffleOptions === true,
    questions
  }
}
