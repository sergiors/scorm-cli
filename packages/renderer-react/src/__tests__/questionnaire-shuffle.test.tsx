// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionnaireView } from '../../app/components/views/QuestionnaireView'
import { PageProvider, PlayerProvider, usePlayerState } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type {
  ContentPackage,
  PageNode,
  PlayerPageState,
  PlayerState,
  QuestionnaireNode,
  QuestionNode,
  QuestionOption
} from '../../app/types'
import { questionnaireNode } from './fixtures'

const PAGE_ID = 'page:shuffle-test.mdx'
const OTHER_PAGE_ID = 'page:after.mdx'

/**
 * The restored global seed every shuffle display below is pinned to. With this
 * seed each multi-option question receives an order that differs from the
 * authored one, and the retry attempt (attempt index 1) redraws both again.
 */
const SEED = 1

/** The three questions of the shuffle questionnaire in authored order. */
const singleQuestion: QuestionNode = {
  type: 'question',
  id: 'question:shuffle.mdx:1:1',
  questionType: 'single-choice',
  prompt: 'Which option is the single choice?',
  options: optionSet(['first', 'second', 'third', 'fourth'], ['first'])
}
const multipleQuestion: QuestionNode = {
  type: 'question',
  id: 'question:shuffle.mdx:1:2',
  questionType: 'multiple-choice',
  prompt: 'Which options are the multiple choice?',
  options: optionSet(['alpha', 'beta', 'gamma'], ['alpha', 'beta'])
}
const trueFalseQuestion: QuestionNode = {
  type: 'question',
  id: 'question:shuffle.mdx:1:3',
  questionType: 'true-false',
  prompt: 'Is this the true-false question?',
  options: optionSet(['true', 'false'], ['true'])
}

function optionSet(values: string[], correct: string[]): QuestionOption[] {
  return values.map((value) => ({
    value,
    correct: correct.includes(value),
    content: value
  }))
}

/** The stepper questionnaire under test, capped at three attempts. */
const shuffleQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:shuffle.mdx:1:1',
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts: 3,
  shuffleOptions: true,
  questions: [singleQuestion, multipleQuestion, trueFalseQuestion]
}

/** The exact display orders the pinned seed produces, per attempt index. */
const singleAttemptOrders: string[][] = [
  ['second', 'fourth', 'third', 'first'],
  ['first', 'third', 'second', 'fourth']
]
const multipleAttemptOrders: string[][] = [
  ['alpha', 'gamma', 'beta'],
  ['beta', 'gamma', 'alpha']
]

/** Authored (unshuffled) twin for comparison rendering. */
const authoredQuestionnaire: QuestionnaireNode = {
  ...shuffleQuestionnaire,
  shuffleOptions: false
}

const expandedShuffleQuestionnaire: QuestionnaireNode = {
  ...shuffleQuestionnaire,
  expanded: true
}

/** A second questionnaire on the same page with its own shuffle scope. */
const otherQuestion: QuestionNode = {
  type: 'question',
  id: 'question:other.mdx:1:1',
  questionType: 'single-choice',
  prompt: 'Which choice is the good one?',
  options: optionSet(['good', 'bad', 'ugly'], ['good'])
}
/** Its pinned seed-1 order is ['ugly','bad','good'] on every attempt below. */
const otherShuffleQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:other.mdx:1:1',
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts: 3,
  shuffleOptions: true,
  questions: [otherQuestion]
}

/** Full displayed option order of one questionnaire across all of its questions. */
function fullDisplayOrder(singleOrder: string[], multipleOrder: string[]): string[] {
  return [...singleOrder, ...multipleOrder, 'true', 'false']
}

function pageWith(nodes: QuestionnaireNode[]): PageNode {
  return {
    type: 'page',
    id: PAGE_ID,
    source: 'shuffle-test.mdx',
    metadata: { title: 'Shuffle' },
    content: nodes
  }
}

function makePackage(nodes: QuestionnaireNode[]): ContentPackage {
  return {
    metadata: { title: 'Shuffle test' },
    presentation: {
      type: 'scroll',
      pages: [
        pageWith(nodes),
        {
          type: 'page',
          id: OTHER_PAGE_ID,
          source: 'after.mdx',
          metadata: { title: 'After' },
          content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Nothing here.' }] }]
        }
      ]
    }
  }
}

let restoredState: PlayerState
let saveState: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoredState = { pages: {}, shuffleSeed: SEED }
  saveState = vi.fn()
  window.scormBridge = { restoreState: () => restoredState, saveState }
  sessionState = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormBridge
})

/**
 * Renders questionnaire views inside one player session. Every view is wrapped
 * in a test id so assertions can scope a questionnaire's DOM when several
 * questionnaires share the page.
 */
function PlayerViews({
  contentPackage,
  pageId = PAGE_ID
}: {
  contentPackage: ContentPackage
  pageId?: string
  views: Array<{ key: string; node: QuestionnaireNode }>
}) {
  return (
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={contentPackage}>
        <PageProvider pageId={pageId}>
          {views.map(({ key, node }) => (
            <div key={key} data-testid={key}>
              <QuestionnaireView node={node} />
            </div>
          ))}
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

/** Renders the session state the player owns, so seed assertions read it directly. */
let sessionState: PlayerState | undefined
function StateProbe() {
  sessionState = usePlayerState()
  return null
}

function renderSession(
  contentPackage: ContentPackage,
  {
    strict = false,
    pageId = PAGE_ID,
    views = []
  }: Parameters<typeof PlayerViews>[0] & { strict?: boolean } = {}
): void {
  const session = (
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={contentPackage}>
        <StateProbe />
        <PageProvider pageId={pageId}>
          {views.map(({ key, node }) => (
            <div key={key} data-testid={key}>
              <QuestionnaireView node={node} />
            </div>
          ))}
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
  // StrictMode exercises the doubled mount effects of the seed generation.
  act(() => root.render(strict ? <StrictMode>{session}</StrictMode> : session))
}

function render(
  contentPackage: ContentPackage,
  views: Array<{ key: string; node: QuestionnaireNode }>
): void {
  renderSession(contentPackage, { views })
}

function region(name: string): ParentNode {
  const element = container.querySelector(`[data-testid="${name}"]`)
  if (!element) throw new Error(`Missing region: ${name}`)
  return element
}

function inputIn(scope: ParentNode, value: string): HTMLInputElement {
  const element = scope.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) throw new Error(`Input not found for value: ${value}`)
  return element
}

/** The option values of one scope's inputs in DOM order. */
function inputValuesIn(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[value]')).map(
    (input) => input.value
  )
}

function activeItemIn(scope: ParentNode): HTMLElement {
  const element = scope.querySelector<HTMLElement>('[data-slot="questionnaire-item"]:not([hidden])')
  if (!element) throw new Error('No active questionnaire item')
  return element
}

function clickableButtonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const element = Array.from(scope.querySelectorAll('button')).find(
    (candidate) =>
      !candidate.hasAttribute('hidden') &&
      !candidate.hasAttribute('disabled') &&
      candidate.textContent?.trim() === label
  )
  if (!element) throw new Error(`Clickable button not found: ${label}`)
  return element
}

function summaryTextIn(scope: ParentNode): string {
  const text = scope.querySelector<HTMLElement>('[data-slot="questionnaire-summary"]')?.textContent
  if (!text) throw new Error('Summary not found')
  return text
}

function retryIn(scope: ParentNode): HTMLButtonElement {
  const element = scope.querySelector<HTMLButtonElement>('[data-slot="questionnaire-retry"]')
  if (!element) throw new Error('Retry button not found')
  return element
}

/** A visible question-scoped wizard button, for review navigation. */
function visibleButtonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const element = Array.from(scope.querySelectorAll('button')).find(
    (candidate) => !candidate.hasAttribute('hidden') && candidate.textContent?.trim() === label
  )
  if (!element) throw new Error(`Button not found: ${label}`)
  return element
}

function lastPageState(): PlayerPageState | undefined {
  const [lastState] = saveState.mock.calls.at(-1) ?? []
  return (lastState as PlayerState | undefined)?.pages[PAGE_ID]
}

/**
 * Answers all three wizard questions for one attempt. The multiple-choice value
 * list may arrive in shuffled display order; the stored answer still ends up in
 * authored option order.
 */
function submitStepperRound(
  scope: ParentNode,
  singleValue: string,
  multipleValues: readonly string[],
  trueFalseValue: string
): void {
  act(() => inputIn(scope, singleValue).click())
  act(() => clickableButtonIn(scope, 'Next question').click())
  for (const value of multipleValues) {
    act(() => inputIn(scope, value).click())
  }
  act(() => clickableButtonIn(scope, 'Next question').click())
  act(() => inputIn(scope, trueFalseValue).click())
  act(() => clickableButtonIn(scope, 'Submit questionnaire').click())
}

describe('questionnaire shuffle display (stepper)', () => {
  const shufflePackage = makePackage([shuffleQuestionnaire])
  const views = [{ key: shuffleQuestionnaire.id, node: shuffleQuestionnaire }]

  it('renders the deterministic shuffled option order instead of authored order', () => {
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    expect(inputValuesIn(quiz)).toEqual([
      ...singleAttemptOrders[0],
      ...multipleAttemptOrders[0],
      'true',
      'false'
    ])
    // The wizard still opens on the first question of the shuffled sequence.
    expect(activeItemIn(quiz).textContent).toContain(singleQuestion.prompt)
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(singleAttemptOrders[0])
  })

  it('answers with option values and stores multiple-choice answers in authored order', () => {
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    act(() => inputIn(quiz, 'first').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())

    // On attempt 0 gamma displays before beta, yet both land ahead of gamma in
    // the stored answer, which always follows the authored option order.
    act(() => inputIn(quiz, 'gamma').click())
    act(() => inputIn(quiz, 'beta').click())
    expect(lastPageState()?.answers?.[multipleQuestion.id]).toEqual(['beta', 'gamma'])

    act(() => inputIn(quiz, 'alpha').click())
    expect(lastPageState()?.answers?.[multipleQuestion.id]).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('keeps one visible order through rerenders, navigation, submission, and review', () => {
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    submitStepperRound(quiz, 'first', ['alpha', 'beta'], 'true')
    expect(summaryTextIn(quiz)).toContain('3 of 3 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [shuffleQuestionnaire.id]: [3] })
    expect(lastPageState()?.completedQuestionnaires).toEqual([shuffleQuestionnaire.id])

    // Review: the attempt-0 order survives the submission. Every item stays in
    // the layout, so full DOM order can be compared at any active step.
    expect(inputValuesIn(quiz)).toEqual(
      fullDisplayOrder(singleAttemptOrders[0], multipleAttemptOrders[0])
    )
    act(() => visibleButtonIn(quiz, 'Previous question').click())
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(multipleAttemptOrders[0])

    // Walking away to another page and back redraws the exact same order.
    renderSession(shufflePackage, { pageId: OTHER_PAGE_ID })
    renderSession(shufflePackage, { views })
    expect(inputValuesIn(quiz)).toEqual(
      fullDisplayOrder(singleAttemptOrders[0], multipleAttemptOrders[0])
    )

    // The generated session writes persist the restored seed alongside answers.
    const [persisted] = saveState.mock.calls.at(-1) ?? []
    expect((persisted as PlayerState | undefined)?.shuffleSeed).toBe(SEED)
  })

  it('draws a fresh attempt-scoped order on retry and keeps the recorded history', () => {
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    // A wrong first attempt records 0 of 3 and stays pending for a retry.
    submitStepperRound(quiz, 'second', ['gamma'], 'false')
    expect(summaryTextIn(quiz)).toContain('0 of 3 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [shuffleQuestionnaire.id]: [0] })
    expect(lastPageState()?.submittedQuestionnaires).toEqual([shuffleQuestionnaire.id])
    expect(lastPageState()?.activeQuestionnaireRetries).toBeUndefined()

    act(() => retryIn(quiz).click())

    // Starting the retry marks the questionnaire actively retrying.
    expect(lastPageState()?.activeQuestionnaireRetries).toEqual([shuffleQuestionnaire.id])

    // Retrying redraws both multi-option questions in their attempt-1 order.
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(singleAttemptOrders[1])
    act(() => inputIn(quiz, 'first').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(multipleAttemptOrders[1])

    // The corrected attempt is scored on the same shuffled order.
    act(() => inputIn(quiz, 'alpha').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())
    act(() => inputIn(quiz, 'true').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('3 of 3 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [shuffleQuestionnaire.id]: [0, 3] })
    expect(lastPageState()?.completedQuestionnaires).toEqual([shuffleQuestionnaire.id])
    expect(lastPageState()?.activeQuestionnaireRetries).toBeUndefined()
  })

  it('keeps every questionnaire on the page scoped to its own order', () => {
    const bothQuestionnaires = [shuffleQuestionnaire, otherShuffleQuestionnaire]
    const packageWithBoth = makePackage(bothQuestionnaires)
    render(
      packageWithBoth,
      bothQuestionnaires.map((node) => ({ key: node.id, node }))
    )
    const quiz = region(shuffleQuestionnaire.id)
    const otherQuiz = region(otherShuffleQuestionnaire.id)

    expect(inputValuesIn(activeItemIn(otherQuiz))).toEqual(['ugly', 'bad', 'good'])

    // Submit and retry the first questionnaire; the sibling never moves.
    submitStepperRound(quiz, 'second', ['gamma'], 'false')
    act(() => retryIn(quiz).click())
    expect(inputValuesIn(activeItemIn(otherQuiz))).toEqual(['ugly', 'bad', 'good'])

    // Neither a full-rerender nor the retry remount reshuffles the sibling.
    render(
      packageWithBoth,
      bothQuestionnaires.map((node) => ({ key: node.id, node }))
    )
    expect(inputValuesIn(activeItemIn(otherQuiz))).toEqual(['ugly', 'bad', 'good'])
  })

  it('renders authored order when shuffling is disabled', () => {
    render(makePackage([authoredQuestionnaire]), [
      { key: authoredQuestionnaire.id, node: authoredQuestionnaire }
    ])
    const quiz = region(authoredQuestionnaire.id)

    expect(inputValuesIn(activeItemIn(quiz))).toEqual(['first', 'second', 'third', 'fourth'])
    // The wizard only advances from an answered question.
    act(() => inputIn(quiz, 'first').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(['alpha', 'beta', 'gamma'])
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(['true', 'false'])
  })

  it('restores the submitted review in the shuffled attempt order from suspend state', () => {
    restoredState = {
      shuffleSeed: SEED,
      pages: {
        [PAGE_ID]: {
          answers: {
            [singleQuestion.id]: 'first',
            [multipleQuestion.id]: ['alpha', 'beta'],
            [trueFalseQuestion.id]: 'true'
          },
          questionnaireAttempts: { [shuffleQuestionnaire.id]: [3] },
          submittedQuestionnaires: [shuffleQuestionnaire.id],
          completedQuestionnaires: [shuffleQuestionnaire.id]
        }
      }
    }
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    // The restored completed review is read-only and reopens on the first
    // question when nothing was saved, drawing the same attempt-0 display
    // order with the persisted selections checked.
    expect(summaryTextIn(quiz)).toContain('3 of 3 correct answers')
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(singleAttemptOrders[0])
    expect(inputIn(quiz, 'first').checked).toBe(true)
    act(() => visibleButtonIn(quiz, 'Next question').click())
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(multipleAttemptOrders[0])
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(inputIn(quiz, 'beta').checked).toBe(true)
    expect(inputIn(quiz, 'gamma').checked).toBe(false)
  })

  it('restores a saved active question with the attempt option order from suspend state', () => {
    restoredState = {
      shuffleSeed: SEED,
      pages: {
        [PAGE_ID]: {
          answers: { [singleQuestion.id]: 'first', [multipleQuestion.id]: ['alpha'] },
          activeQuestionnaireItems: { [shuffleQuestionnaire.id]: multipleQuestion.id }
        }
      }
    }
    render(shufflePackage, views)
    const quiz = region(shuffleQuestionnaire.id)

    // The resumed round reopens on the question the learner reached, drawing
    // the same attempt-0 shuffled order with the saved selection rendered as
    // checked before any new interaction.
    expect(quiz.querySelector('[data-slot="questionnaire-summary"]')).toBeNull()
    expect(activeItemIn(quiz).textContent).toContain(multipleQuestion.prompt)
    expect(inputValuesIn(activeItemIn(quiz))).toEqual(multipleAttemptOrders[0])
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(inputIn(quiz, 'beta').checked).toBe(false)
  })
})

describe('questionnaire shuffle display (expanded)', () => {
  const expandedPackage = makePackage([expandedShuffleQuestionnaire])
  const expandedViews = [
    { key: expandedShuffleQuestionnaire.id, node: expandedShuffleQuestionnaire }
  ]

  it('renders every question in its shuffled order and keeps it through submission', () => {
    render(expandedPackage, expandedViews)
    const quiz = region(expandedShuffleQuestionnaire.id)

    // All three questions are expanded at once, in authored question order,
    // each with its seed-pinned attempt-0 option order.
    expect(inputValuesIn(quiz)).toEqual(
      fullDisplayOrder(singleAttemptOrders[0], multipleAttemptOrders[0])
    )

    submitExpandedRound(quiz)
    expect(summaryTextIn(quiz)).toContain('3 of 3 correct answers')

    // The review redraws the exact same order with the selection kept checked.
    expect(inputValuesIn(quiz)).toEqual(
      fullDisplayOrder(singleAttemptOrders[0], multipleAttemptOrders[0])
    )
    expect(inputIn(quiz, 'first').checked).toBe(true)
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(inputIn(quiz, 'beta').checked).toBe(true)

    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [expandedShuffleQuestionnaire.id]: [3]
    })
    expect(lastPageState()?.completedQuestionnaires).toEqual([expandedShuffleQuestionnaire.id])
  })

  it('hides correctness feedback when revealCorrectAnswers is false', () => {
    const unrevealed: QuestionnaireNode = {
      ...expandedShuffleQuestionnaire,
      revealCorrectAnswers: false
    }
    render(makePackage([unrevealed]), [{ key: unrevealed.id, node: unrevealed }])
    const quiz = region(unrevealed.id)

    // A deliberately wrong selection still submits and shows no result colors.
    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'gamma').click())
    act(() => inputIn(quiz, 'false').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('0 of 3 correct answers')
    // The shuffled order remains, but no option carries the feedback palette.
    expect(inputValuesIn(quiz)).toEqual(
      fullDisplayOrder(singleAttemptOrders[0], multipleAttemptOrders[0])
    )
    for (const choice of quiz.querySelectorAll('[data-slot="questionnaire-choice"]')) {
      const tokens = choice.className.split(/\s+/)
      expect(tokens.some((token) => token.includes('emerald'))).toBe(false)
      expect(
        tokens.some(
          (token) =>
            (token.includes('bg-destructive') || token.includes('border-destructive/')) &&
            !token.includes('data-invalid:')
        )
      ).toBe(false)
    }
  })
})

function submitExpandedRound(scope: ParentNode): void {
  act(() => inputIn(scope, 'first').click())
  act(() => inputIn(scope, 'alpha').click())
  act(() => inputIn(scope, 'beta').click())
  act(() => inputIn(scope, 'true').click())
  act(() => clickableButtonIn(scope, 'Submit questionnaire').click())
}

describe('shuffle seed lifecycle', () => {
  const shufflePackage = makePackage([shuffleQuestionnaire])
  const plainPackage: ContentPackage = {
    metadata: { title: 'Plain test' },
    presentation: {
      type: 'scroll',
      pages: [pageWith([questionnaireNode])]
    }
  }

  it('generates exactly one persisted seed for a shuffling package, even under StrictMode', () => {
    restoredState = { pages: {} }
    renderSession(shufflePackage, { strict: true })

    const seed = sessionState?.shuffleSeed
    expect(seed).toBeTypeOf('number')
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(4294967295)
    expect(Number.isSafeInteger(seed)).toBe(true)

    // StrictMode's doubled mount effect still writes the seed exactly once.
    expect(saveState).toHaveBeenCalledTimes(1)
    expect((saveState.mock.calls[0]?.[0] as PlayerState).shuffleSeed).toBe(seed)

    // The generated seed keeps its stable value across a rerender of the session.
    renderSession(shufflePackage, { strict: true })
    expect(sessionState?.shuffleSeed).toBe(seed)
  })

  it('keeps a restored valid seed without generating or rewriting one', () => {
    restoredState = { pages: {}, shuffleSeed: 12345 }
    renderSession(shufflePackage)

    expect(sessionState?.shuffleSeed).toBe(12345)
    // A restored seed needs no write: nothing about the mount changed state.
    expect(saveState).not.toHaveBeenCalled()
  })

  it('regenerates the seed when the restored seed is invalid', () => {
    for (const invalidSeed of [-5, 1.5, 2 ** 53, 'x'] as const) {
      // Reset the session for each invalid seed the bridge might return.
      act(() => root.unmount())
      container.remove()
      sessionState = undefined
      restoredState = { pages: {}, shuffleSeed: invalidSeed as PlayerState['shuffleSeed'] }
      saveState = vi.fn()
      window.scormBridge = { restoreState: () => restoredState, saveState }
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)

      renderSession(shufflePackage)

      const seed = sessionState?.shuffleSeed
      expect(seed).toBeTypeOf('number')
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(Number.isSafeInteger(seed)).toBe(true)
      expect(seed).not.toEqual(invalidSeed)
      // The fresh seed is persisted once for the resumed session.
      expect(saveState).toHaveBeenCalledTimes(1)
      expect((saveState.mock.calls[0]?.[0] as PlayerState).shuffleSeed).toBe(seed)
    }
  })

  it('keeps no seed for packages that never shuffle', () => {
    restoredState = { pages: {} }
    renderSession(plainPackage)

    expect(sessionState?.shuffleSeed).toBeUndefined()
    // Mounting an unshuffled package writes nothing on its own.
    expect(saveState).not.toHaveBeenCalled()
  })
})
