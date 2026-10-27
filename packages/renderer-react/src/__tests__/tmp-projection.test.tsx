// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
import {
  createPackageDataPlugin,
  RESOLVED_PACKAGE_DATA_ID
} from '../vite-app'
import type { ContentPackage, PlayerState } from '../../app/types'
import { questionnaireNode } from './fixtures'

const RETRY_PAGE = 'page:retry.mdx'
const NORMAL_PAGE = 'page:normal.mdx'

function authoredPackage(): ContentPackage {
  return {
    metadata: { title: 'Projection' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: RETRY_PAGE,
          source: 'retry.mdx',
          metadata: { title: 'Retry' },
          content: [
            {
              ...questionnaireNode,
              id: 'questionnaire:retry.mdx:1:1',
              maxAttempts: 3,
              expanded: true
            }
          ]
        },
        {
          type: 'page',
          id: NORMAL_PAGE,
          source: 'normal.mdx',
          metadata: { title: 'Normal' },
          content: [
            {
              ...questionnaireNode,
              id: 'questionnaire:normal.mdx:1:1',
              questions: questionnaireNode.questions.map((question, index) => ({
                ...question,
                id: `question:normal.mdx:1:${index + 1}`
              }))
            }
          ]
        }
      ]
    }
  }
}

function semanticPackage(): ContentPackage {
  const plugin = createPackageDataPlugin({ current: authoredPackage() })
  const load = plugin.load
  const code =
    typeof load === 'function'
      ? Reflect.apply(load, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
      : load
        ? Reflect.apply(load.handler, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
        : undefined
  if (typeof code !== 'string') throw new Error('missing package data')
  const start = code.indexOf('const contentPackage = ') + 'const contentPackage = '.length
  const end = code.indexOf(';\nexport default contentPackage', start)
  return JSON.parse(code.slice(start, end)) as ContentPackage
}

let container: HTMLDivElement
let root: Root
let session: PlayerSession | undefined

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  session = undefined
  delete window.scormBridge
})

function Harness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

describe('temporary semantic projection check', () => {
  it('preserves explicit attempt caps and normalizes the default to one', () => {
    const pkg = semanticPackage()
    if (pkg.presentation.type !== 'scroll') throw new Error('wrong presentation')
    const retry = pkg.presentation.pages[0]!.content[0]!
    const normal = pkg.presentation.pages[1]!.content[0]!
    if (retry.type !== 'questionnaire' || normal.type !== 'questionnaire') {
      throw new Error('missing questionnaire')
    }
    expect(retry.maxAttempts).toBe(3)
    expect(normal.maxAttempts).toBe(1)
    // Evaluator fields survive the projection.
    expect(retry.questions[0]!.id).toBe(questionnaireNode.questions[0]!.id)
    expect(retry.questions[0]!.options.map((option) => option.value)).toEqual(
      questionnaireNode.questions[0]!.options.map((option) => option.value)
    )
    expect(retry.questions[0]!.options.map((option) => option.correct)).toEqual(
      questionnaireNode.questions[0]!.options.map((option) => option.correct)
    )
  })

  it('auto-completes through the production semantic package', () => {
    const pkg = semanticPackage()
    const retryPage = pkg.presentation.type === 'scroll' ? pkg.presentation.pages[0]! : null
    const retry = retryPage?.content[0]
    if (!retry || retry.type !== 'questionnaire') throw new Error('missing questionnaire')
    window.scormBridge = { saveState: vi.fn() }
    act(() => root.render(<Harness contentPackage={pkg} />))

    act(() => {
      for (const question of questionnaireNode.questions) {
        const correct = question.options.find((option) => option.correct)!.value
        session?.setAnswer(
          RETRY_PAGE,
          question.id,
          question.questionType === 'multiple-choice' ? [correct] : correct
        )
      }
      session?.markQuestionnaireSubmitted(RETRY_PAGE, retry.id)
    })

    const page: PlayerState['pages'][string] | undefined = session?.state.pages[RETRY_PAGE]
    expect(page?.questionnaireAttempts).toEqual({
      [retry.id]: [questionnaireNode.questions.length]
    })
    expect(page?.completedQuestionnaires).toEqual([retry.id])
  })
})
