// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AggregateScore,
  AnswerValue,
  ContentPackage,
  QuestionnaireNode
} from '../../app/types'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const PAGE_ID = 'page:quiz.mdx'
const SCORED_SINGLE = 'question:quiz.mdx:1:1'
const SCORED_MULTIPLE = 'question:quiz.mdx:1:2'
const OPT_OUT = 'question:quiz.mdx:2:1'

/** A questionnaire that opts out of scoring entirely. */
const optOutQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:quiz.mdx:2:1',
  contributesToScore: false,
  maxAttempts: 1,
  questions: [
    {
      type: 'question',
      id: OPT_OUT,
      questionType: 'single-choice',
      prompt: '',
      options: [
        { value: 'yes', correct: true, content: '' },
        { value: 'no', correct: false, content: '' }
      ]
    }
  ]
}

/**
 * A scroll package with one scored questionnaire (single- and multiple-choice)
 * and one opted-out questionnaire, so a test can show the scored questions and
 * the opt-out are counted differently.
 */
const scoredPackage: ContentPackage = {
  metadata: { title: 'Quiz' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'quiz.mdx',
        metadata: { title: 'Quiz' },
        content: [
          {
            type: 'questionnaire',
            id: 'questionnaire:quiz.mdx:1:1',
            contributesToScore: true,
            maxAttempts: 1,
            questions: [
              {
                type: 'question',
                id: SCORED_SINGLE,
                questionType: 'single-choice',
                prompt: '',
                options: [
                  { value: 'yes', correct: true, content: '' },
                  { value: 'no', correct: false, content: '' }
                ]
              },
              {
                type: 'question',
                id: SCORED_MULTIPLE,
                questionType: 'multiple-choice',
                prompt: '',
                options: [
                  { value: 'a', correct: true, content: '' },
                  { value: 'b', correct: true, content: '' },
                  { value: 'c', correct: false, content: '' }
                ]
              }
            ]
          },
          optOutQuestionnaire
        ]
      }
    ]
  }
}

/** A package whose only questionnaire opts out, so it never yields a score. */
const optOutOnlyPackage: ContentPackage = {
  metadata: { title: 'Opted out' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'quiz.mdx',
        metadata: { title: 'Quiz' },
        content: [optOutQuestionnaire]
      }
    ]
  }
}

const RETRY_QUIZ = 'questionnaire:quiz.mdx:1:1'
const LIVE_QUIZ = 'questionnaire:quiz.mdx:3:1'
const LIVE_SINGLE = 'question:quiz.mdx:3:1'

/** A scored page mixing the uncompleted quiz with a completed one. */
const mixedPackage: ContentPackage = {
  metadata: { title: 'Mixed quizzes' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'quiz.mdx',
        metadata: { title: 'Quiz' },
        content: [
          {
            type: 'questionnaire',
            id: RETRY_QUIZ,
            contributesToScore: true,
            maxAttempts: 3,
            questions: [
              {
                type: 'question',
                id: SCORED_SINGLE,
                questionType: 'single-choice',
                prompt: '',
                options: [
                  { value: 'yes', correct: true, content: '' },
                  { value: 'no', correct: false, content: '' }
                ]
              },
              {
                type: 'question',
                id: SCORED_MULTIPLE,
                questionType: 'multiple-choice',
                prompt: '',
                options: [
                  { value: 'a', correct: true, content: '' },
                  { value: 'b', correct: true, content: '' },
                  { value: 'c', correct: false, content: '' }
                ]
              }
            ]
          },
          {
            type: 'questionnaire',
            id: LIVE_QUIZ,
            contributesToScore: true,
            maxAttempts: 1,
            questions: [
              {
                type: 'question',
                id: LIVE_SINGLE,
                questionType: 'single-choice',
                prompt: '',
                options: [
                  { value: 'yes', correct: true, content: '' },
                  { value: 'no', correct: false, content: '' }
                ]
              }
            ]
          },
          optOutQuestionnaire
        ]
      }
    ]
  }
}

/**
 * The scored questionnaire with an authored cap of three attempts, so the
 * reported score can be checked against its recorded attempt history.
 */
const retryablePackage: ContentPackage = {
  metadata: { title: 'Quiz retries' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'quiz.mdx',
        metadata: { title: 'Quiz' },
        content: [
          {
            type: 'questionnaire',
            id: RETRY_QUIZ,
            contributesToScore: true,
            maxAttempts: 3,
            questions: [
              {
                type: 'question',
                id: SCORED_SINGLE,
                questionType: 'single-choice',
                prompt: '',
                options: [
                  { value: 'yes', correct: true, content: '' },
                  { value: 'no', correct: false, content: '' }
                ]
              },
              {
                type: 'question',
                id: SCORED_MULTIPLE,
                questionType: 'multiple-choice',
                prompt: '',
                options: [
                  { value: 'a', correct: true, content: '' },
                  { value: 'b', correct: true, content: '' },
                  { value: 'c', correct: false, content: '' }
                ]
              }
            ]
          },
          optOutQuestionnaire
        ]
      }
    ]
  }
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
  vi.restoreAllMocks()
})

/**
 * Renders the real session hook so its effects (score reporting, persistence)
 * run under a real React root without any presentation chrome.
 */
function Harness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

function render(contentPackage: ContentPackage): void {
  act(() => root.render(<Harness contentPackage={contentPackage} />))
}

function answer(questionId: string, value: AnswerValue): void {
  act(() => session?.setAnswer(PAGE_ID, questionId, value))
}

/** The score forwarded to the most recent `setScore` call. */
function lastScore(setScore: { mock: { calls: unknown[][] } }): AggregateScore | undefined {
  const calls = setScore.mock.calls
  return calls[calls.length - 1]?.[0] as AggregateScore | undefined
}

describe('usePlayerSession score reporting', () => {
  it('excludes saved answers entirely, so uncompleted questionnaires score nothing', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            answers: { [SCORED_SINGLE]: 'yes', [SCORED_MULTIPLE]: ['a', 'b'] }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)

    // Saved answers are never a score: without a completed result the
    // questionnaire contributes neither earned nor possible points, so no
    // aggregate exists at all.
    expect(lastScore(setScore)).toBeUndefined()
  })

  it('reports the best attempt restored for a completed questionnaire on mount', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            completedQuestionnaires: ['questionnaire:quiz.mdx:1:1'],
            questionnaireAttempts: { 'questionnaire:quiz.mdx:1:1': [2] }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)

    // Both scored questions were correct in the recorded attempt; the
    // opted-out questionnaire is ignored. No saved answers are needed.
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('answers never lower or raise the recorded best attempt of a completed questionnaire', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            completedQuestionnaires: ['questionnaire:quiz.mdx:1:1'],
            questionnaireAttempts: { 'questionnaire:quiz.mdx:1:1': [0] }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)

    // The completed result keeps its recorded zero even though correct saved
    // answers exist: live answers never override a completed attempt.
    expect(lastScore(setScore)).toEqual({ earned: 0, possible: 2 })
  })

  it('reports a score only through recorded attempts, never while answering', () => {
    const setScore = vi.fn()
    window.scormBridge = { setScore }

    render(retryablePackage)

    // Answering without a completed result reports no score: the bridge only
    // ever sees `undefined`, not a tally derived from live answers.
    act(() => session?.setAnswer(PAGE_ID, SCORED_SINGLE, 'yes'))
    expect(setScore.mock.calls.every((call) => call[0] === undefined)).toBe(true)

    // An imperfect submission keeps the result pending: the recorded attempt
    // is one correct answer, but neither point count exists yet.
    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, RETRY_QUIZ))
    expect(setScore.mock.calls.every((call) => call[0] === undefined)).toBe(true)
    const page = session?.state.pages[PAGE_ID]
    expect(page?.questionnaireAttempts).toEqual({ [RETRY_QUIZ]: [1] })
    expect(page?.completedQuestionnaires).toBeUndefined()

    // Starting a retry and re-answering both questions right records a perfect
    // second attempt, which auto-completes: only then does the aggregate reach
    // the bridge.
    act(() => session?.retryQuestionnaire(PAGE_ID, RETRY_QUIZ, [SCORED_SINGLE, SCORED_MULTIPLE]))
    act(() => session?.setAnswer(PAGE_ID, SCORED_SINGLE, 'yes'))
    act(() => session?.setAnswer(PAGE_ID, SCORED_MULTIPLE, ['a', 'b']))
    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, RETRY_QUIZ))
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('excludes opted-out answers but keeps unanswered scored questions', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            completedQuestionnaires: ['questionnaire:quiz.mdx:1:1'],
            questionnaireAttempts: { 'questionnaire:quiz.mdx:1:1': [1] },
            answers: { [SCORED_SINGLE]: 'yes', [OPT_OUT]: 'yes' }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)

    // The opted-out answer earns nothing and adds no possible point, while the
    // unanswered multiple-choice question still counts toward the recorded
    // attempt's denominator.
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 2 })
  })

  it('reports no score when no questionnaire contributes, never a zero', () => {
    const setScore = vi.fn()
    window.scormBridge = { setScore }

    render(optOutOnlyPackage)

    expect(lastScore(setScore)).toBeUndefined()
    expect(setScore).not.toHaveBeenCalledWith({ earned: 0, possible: 0 })
  })

  it('does not re-report when an answer change leaves the score unchanged', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            completedQuestionnaires: ['questionnaire:quiz.mdx:1:1'],
            questionnaireAttempts: { 'questionnaire:quiz.mdx:1:1': [1] }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)
    const reportsAfterMount = setScore.mock.calls.length

    // Answering cannot move a completed questionnaire's recorded attempt, so
    // the point counts stay { earned: 1, possible: 2 } and nothing re-reports.
    answer(SCORED_SINGLE, 'yes')
    answer(SCORED_MULTIPLE, ['a', 'b'])

    expect(setScore.mock.calls.length).toBe(reportsAfterMount)
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 2 })
  })

  it('does not throw and stays silent without a score bridge', () => {
    window.scormBridge = { saveState: () => true }

    expect(() => {
      render(scoredPackage)
      answer(SCORED_SINGLE, 'yes')
    }).not.toThrow()
  })

  it('reports the best attempt whether the history improves or worsens', () => {
    const setScore = vi.fn()

    for (const history of [
      [1, 0],
      [0, 1]
    ] as const) {
      act(() => root.unmount())
      root = createRoot(container)
      window.scormBridge = {
        restoreState: () => ({
          pages: {
            [PAGE_ID]: {
              completedQuestionnaires: [RETRY_QUIZ],
              questionnaireAttempts: { [RETRY_QUIZ]: [...history] }
            }
          }
        }),
        setScore
      }

      act(() => root.render(<Harness contentPackage={retryablePackage} />))

      // The score is the best recorded attempt in both directions, so a worse
      // later attempt [1, 0] and a better later one [0, 1] both report 1/2.
      expect(lastScore(setScore)).toEqual({ earned: 1, possible: 2 })
    }
  })

  it('excludes a pending questionnaire beside a completed one until completed', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            submittedQuestionnaires: [RETRY_QUIZ],
            questionnaireAttempts: { [RETRY_QUIZ]: [2, 0], [LIVE_QUIZ]: [1] },
            completedQuestionnaires: [LIVE_QUIZ],
            answers: { [SCORED_SINGLE]: 'yes', [SCORED_MULTIPLE]: ['a', 'b'], [LIVE_SINGLE]: 'yes' }
          }
        }
      }),
      setScore
    }

    render(mixedPackage)

    // Pending: only the completed questionnaire counts, in both point counts;
    // the pending quiz's two questions stay out of the aggregate.
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 1 })

    // Completing the pending result adopts the best recorded attempt, never
    // the worse latest one.
    act(() => session?.completeQuestionnaire(PAGE_ID, RETRY_QUIZ))
    expect(lastScore(setScore)).toEqual({ earned: 3, possible: 3 })
  })
})
