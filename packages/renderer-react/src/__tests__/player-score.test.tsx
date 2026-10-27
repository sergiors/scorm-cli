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

/** A scored page mixing the retry-enabled quiz with a live-scored one. */
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
  it('reports the score restored from saved answers on mount', () => {
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

    // Both scored questions are correct; the multiple-choice answer is
    // all-or-nothing and the opted-out questionnaire is ignored.
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('derives the score from the current answers and reports each change', () => {
    const setScore = vi.fn()
    window.scormBridge = { setScore }

    render(scoredPackage)

    // Nothing is answered yet, but both scored questions stay in the denominator.
    expect(lastScore(setScore)).toEqual({ earned: 0, possible: 2 })

    answer(SCORED_SINGLE, 'yes')
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 2 })

    // A partial multiple-choice selection earns nothing.
    answer(SCORED_MULTIPLE, ['a'])
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 2 })

    answer(SCORED_MULTIPLE, ['a', 'b'])
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('excludes opted-out answers but keeps unanswered scored questions', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: { [PAGE_ID]: { answers: { [SCORED_SINGLE]: 'yes', [OPT_OUT]: 'yes' } } }
      }),
      setScore
    }

    render(scoredPackage)

    // The opted-out answer earns nothing and adds no possible point, while the
    // unanswered multiple-choice question still counts.
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
    window.scormBridge = { setScore }

    render(scoredPackage)
    const reportsAfterMount = setScore.mock.calls.length

    // A wrong answer keeps earned/possible identical, so nothing is re-reported.
    answer(SCORED_SINGLE, 'no')

    expect(setScore.mock.calls.length).toBe(reportsAfterMount)
  })

  it('does not throw and stays silent without a score bridge', () => {
    window.scormBridge = { saveState: () => true }

    expect(() => {
      render(scoredPackage)
      answer(SCORED_SINGLE, 'yes')
    }).not.toThrow()
  })

  it('leaves a pending retry assessment unreported', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            submittedQuestionnaires: [RETRY_QUIZ],
            questionnaireAttempts: { [RETRY_QUIZ]: [1, 0] },
            answers: { [SCORED_SINGLE]: 'yes', [SCORED_MULTIPLE]: ['a', 'b'] }
          }
        }
      }),
      setScore
    }

    render(retryablePackage)

    // Until the learner confirms Use This Score, the pending assessment is
    // excluded from the reported score entirely — neither earned nor possible.
    expect(lastScore(setScore)).toBeUndefined()
  })

  it('reports the finalized best attempt and never a worse later one', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            finalizedQuestionnaires: [RETRY_QUIZ],
            questionnaireAttempts: { [RETRY_QUIZ]: [2, 0] }
          }
        }
      }),
      setScore
    }

    render(retryablePackage)

    // The finalized result is the best recorded attempt; the worse latest
    // attempt does not decrease it and cleared answers do not reset it.
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })

    const reportsAfterMount = setScore.mock.calls.length
    answer(SCORED_SINGLE, 'no')
    answer(SCORED_MULTIPLE, ['a'])
    // Live answers stay irrelevant for a finalized retry-enabled quiz, so the
    // point counts do not change and nothing is re-reported.
    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
    expect(setScore.mock.calls.length).toBe(reportsAfterMount)
  })

  it('excludes a pending questionnaire beside a live-scored one until finalized', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            submittedQuestionnaires: [RETRY_QUIZ],
            questionnaireAttempts: { [RETRY_QUIZ]: [2, 0] },
            answers: { [SCORED_SINGLE]: 'yes', [SCORED_MULTIPLE]: ['a', 'b'], [LIVE_SINGLE]: 'yes' }
          }
        }
      }),
      setScore
    }

    render(mixedPackage)

    // Pending: only the single-attempt questionnaire counts, in both point
    // counts; the pending quiz's two questions stay out of the aggregate.
    expect(lastScore(setScore)).toEqual({ earned: 1, possible: 1 })

    // Confirming Use This Score adopts the best recorded attempt.
    act(() => session?.finalizeQuestionnaire(PAGE_ID, RETRY_QUIZ))
    expect(lastScore(setScore)).toEqual({ earned: 3, possible: 3 })
  })

  it('scores saved answers instead of history for a single-attempt questionnaire', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      // The scored questionnaire has no maxAttempts, so its recorded history
      // must never override the learner's saved answers.
      restoreState: () => ({
        pages: {
          [PAGE_ID]: {
            answers: { [SCORED_SINGLE]: 'yes', [SCORED_MULTIPLE]: ['a', 'b'] },
            questionnaireAttempts: { [RETRY_QUIZ]: [0] }
          }
        }
      }),
      setScore
    }

    render(scoredPackage)

    expect(lastScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })
})
