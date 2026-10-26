import type {
  ContentNode,
  QuestionNode,
  QuestionOption,
  QuestionType,
  QuestionnaireNode
} from '@scorm-cli/core'
import { sourceNodeId } from './io'
import { componentName } from './component-name'
import type { AstNode } from './ast'
import { isJsx, rawComponentName, whitespace } from './ast'
import { assertAttributes, attrs, requiredString, sourceLocation } from './shared'

export type ParseQuestionContentChildren = (nodes: AstNode[]) => Promise<ContentNode[]>

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

async function parseOptions(
  nodes: AstNode[],
  file: string,
  parseContentChildren: ParseQuestionContentChildren
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
      content: await parseContentChildren(node.children ?? [])
    })
  }
  return options
}

export async function parseQuestion(
  node: AstNode,
  file: string,
  root: string,
  parseContentChildren: ParseQuestionContentChildren,
  sourceLineOffset = 0
): Promise<QuestionNode> {
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
  const prompt = await parseContentChildren(promptNode.children ?? [])
  const options = await parseOptions(optionNodes, file, parseContentChildren)
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
  file: string,
  root: string,
  parseContentChildren: ParseQuestionContentChildren,
  sourceLineOffset = 0
): Promise<QuestionnaireNode> {
  const values = attrs(node, file)
  assertAttributes(values, ['contributesToScore', 'expanded'], file, node)
  if (values.contributesToScore !== undefined && typeof values.contributesToScore !== 'boolean') {
    throw new Error(
      `${sourceLocation(file, node)}: Questionnaire "contributesToScore" must be a boolean`
    )
  }
  if (values.expanded !== undefined && typeof values.expanded !== 'boolean') {
    throw new Error(`${sourceLocation(file, node)}: Questionnaire "expanded" must be a boolean`)
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
    questions.push(await parseQuestion(child, file, root, parseContentChildren, sourceLineOffset))
  }

  return {
    type: 'questionnaire',
    id: sourceNodeId('questionnaire', node, file, root, sourceLineOffset),
    contributesToScore: values.contributesToScore !== false,
    expanded: values.expanded === true,
    questions
  }
}
