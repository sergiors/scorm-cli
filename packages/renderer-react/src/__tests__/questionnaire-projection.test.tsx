// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentPackage, PlayerState, QuestionnaireNode, QuestionNode } from '../../app/types'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
import { createPackageDataPlugin, RESOLVED_PACKAGE_DATA_ID } from '../vite-app'
import { multipleChoiceQuestion, singleChoiceQuestion } from './fixtures'

const PAGE_ID = 'page:projection.mdx'
const RETRY_ID = 'questionnaire:projection.mdx:1:1'
const PLAIN_ID = 'questionnaire:projection.mdx:1:2'

/** A true/false question so the projection keeps every question type. */
const trueFalseQuestion: QuestionNode = {
  type: 'question',
  id: 'question:projection.mdx:1:2',
  questionType: 'true-false',
  prompt: 'Is this true?',
  options: [
    { value: 'true', correct: true, content: 'True' },
    { value: 'false', correct: false, content: 'False' }
  ]
}

/** An exact-set multiple-choice question with two correct options. */
const exactSetQuestion: QuestionNode = {
  ...multipleChoiceQuestion,
  id: 'question:projection.mdx:1:3',
  options: [
    { value: 'a', correct: true, content: 'A' },
    { value: 'b', correct: true, content: 'B' },
    { value: 'c', correct: false, content: 'C' }
  ]
}

const retryQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: RETRY_ID,
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts: 3,
  questions: [singleChoiceQuestion, trueFalseQuestion, exactSetQuestion]
}

const plainQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: PLAIN_ID,
  contributesToScore: false,
  revealCorrectAnswers: true,
  maxAttempts: 1,
  questions: [{ ...singleChoiceQuestion, id: 'question:projection.mdx:1:4' }]
}

function pageWith(nodes: QuestionnaireNode[], includePlain: boolean): ContentPackage {
  return {
    metadata: { title: 'Projection check' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: PAGE_ID,
          source: 'projection.mdx',
          metadata: { title: 'Projection' },
          content: includePlain ? [retryQuestionnaire, plainQuestionnaire] : [retryQuestionnaire]
        }
      ]
    }
  }
}

/** Calls the plugin's load hook without needing a full Vite plugin context. */
function loadPackageDataModule(plugin: ReturnType<typeof createPackageDataPlugin>): unknown {
  const load = plugin.load
  if (typeof load === 'function') {
    return Reflect.apply(load, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
  }
  if (load !== undefined) {
    return Reflect.apply(load.handler, undefined, [RESOLVED_PACKAGE_DATA_ID, undefined])
  }
  throw new Error('Package data plugin has no load hook')
}

/** The package object the generated virtual module actually exposes. */
function semanticPackage(contentPackage: ContentPackage): ContentPackage {
  const plugin = createPackageDataPlugin({ current: contentPackage })
  const code = loadPackageDataModule(plugin)
  if (typeof code !== 'string') {
    throw new Error('Package data module was not generated')
  }
  const marker = 'const contentPackage = '
  const start = code.indexOf(marker)
  const end = code.indexOf(';\nexport default contentPackage', start)
  if (start < 0 || end < 0) {
    throw new Error('Package data module has an unexpected shape')
  }
  return JSON.parse(code.slice(start + marker.length, end)) as ContentPackage
}

function questionnaireOnPage(contentPackage: ContentPackage, index: number): QuestionnaireNode {
  if (contentPackage.presentation.type === 'tiles') {
    throw new Error('Expected a page presentation')
  }
  const node = contentPackage.presentation.pages[0]?.content[index]
  if (node?.type !== 'questionnaire') {
    throw new Error('Expected a questionnaire node')
  }
  return node
}

let restoredState: PlayerState | undefined
let container: HTMLDivElement
let root: Root
let session: PlayerSession | undefined

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoredState = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  session = undefined
  delete window.scormBridge
  vi.restoreAllMocks()
})

function SessionHarness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

function lastScore(setScore: { mock: { calls: unknown[][] } }): unknown {
  const calls = setScore.mock.calls
  return calls[calls.length - 1]?.[0]
}

describe('generated package questionnaire projection', () => {
  it('keeps the authored attempt cap and evaluator fields, normalized to the single-attempt default', () => {
    const projected = semanticPackage(pageWith([retryQuestionnaire], true))
    const retry = questionnaireOnPage(projected, 0)
    const plain = questionnaireOnPage(projected, 1)

    // The parser always normalizes an omitted cap to one, so the projected
    // summary records the authored cap unchanged — 3 for the retry package
    // and the single-attempt default for the questionnaire beside it.
    expect(retry.maxAttempts).toBe(3)
    expect(retry.contributesToScore).toBe(true)
    expect(plain.maxAttempts).toBe(1)
    expect('maxAttempts' in plain).toBe(true)
    expect(plain.contributesToScore).toBe(false)

    // The session layer evaluates the projected summary, so every authored
    // question type, option value and correctness flag must survive.
    expect(retry.questions.map((question) => question.questionType)).toEqual([
      'single-choice',
      'true-false',
      'multiple-choice'
    ])
    expect(retry.questions[2]?.options.map((option) => option.value)).toEqual(['a', 'b', 'c'])
    expect(retry.questions[2]?.options.map((option) => option.correct)).toEqual([true, true, false])
  })

  it('completes a perfect submission from the projected package and reports score and completion', () => {
    const saveState = vi.fn()
    const setScore = vi.fn()
    const markCompleted = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState ?? { pages: {} },
      saveState,
      setScore,
      markCompleted
    }

    const projected = semanticPackage(pageWith([retryQuestionnaire], false))
    act(() => root.render(<SessionHarness contentPackage={projected} />))

    // Answers and the submission are reported in one synchronous batch, so the
    // transition must evaluate the latest stored answers rather than a render.
    act(() => {
      session?.setAnswer(PAGE_ID, singleChoiceQuestion.id, 'first')
      session?.setAnswer(PAGE_ID, trueFalseQuestion.id, 'true')
      session?.setAnswer(PAGE_ID, exactSetQuestion.id, ['b', 'a'])
      session?.markQuestionnaireSubmitted(PAGE_ID, RETRY_ID)
    })

    const page = session?.state.pages[PAGE_ID]
    expect(page?.questionnaireAttempts).toEqual({ [RETRY_ID]: [3] })
    expect(page?.submittedQuestionnaires).toEqual([RETRY_ID])
    expect(page?.completedQuestionnaires).toEqual([RETRY_ID])
    expect(lastScore(setScore)).toEqual({ earned: 3, possible: 3 })

    // The page can now complete, which reports package completion once.
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
    expect(markCompleted).toHaveBeenCalledTimes(1)

    // The persisted state is enough to restore the completed best attempt and
    // its latest-summary review without re-deriving anything.
    const completedState = session?.state
    if (!completedState) {
      throw new Error('Session state was not available')
    }
    restoredState = completedState
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<SessionHarness contentPackage={projected} />))

    const restored = session?.state.pages[PAGE_ID]
    expect(restored?.completed).toBe(true)
    expect(restored?.questionnaireAttempts).toEqual({ [RETRY_ID]: [3] })
    expect(restored?.completedQuestionnaires).toEqual([RETRY_ID])
    expect(lastScore(setScore)).toEqual({ earned: 3, possible: 3 })
    expect(markCompleted).toHaveBeenCalledTimes(2)
  })

  it('restores a pending latest attempt of the projected questionnaire without a score', () => {
    const saveState = vi.fn()
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState ?? { pages: {} },
      saveState,
      setScore
    }

    const projected = semanticPackage(pageWith([retryQuestionnaire], false))
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [RETRY_ID],
          questionnaireAttempts: { [RETRY_ID]: [1, 0] }
        }
      }
    }
    act(() => root.render(<SessionHarness contentPackage={projected} />))

    // A restored imperfect result stays pending beside its recorded history,
    // so completion never materializes from the restored history alone.
    const page = session?.state.pages[PAGE_ID]
    expect(page?.submittedQuestionnaires).toEqual([RETRY_ID])
    expect(page?.questionnaireAttempts).toEqual({ [RETRY_ID]: [1, 0] })
    expect(page?.completedQuestionnaires).toBeUndefined()
    expect(lastScore(setScore)).toBeUndefined()

    // Completing adopts the best recorded attempt into the reported score.
    act(() => session?.completeQuestionnaire(PAGE_ID, RETRY_ID))
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 3 })
  })
})
