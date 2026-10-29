// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionnaireView } from '../../app/components/views/QuestionnaireView'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import { usePlayerSession, type PlayerSession } from '../../app/lib/use-player-session'
import type {
  ContentPackage,
  PageNode,
  PlayerPageState,
  PlayerState,
  QuestionnaireNode,
  QuestionNode
} from '../../app/types'
import { multipleChoiceQuestion, questionnaireNode, singleChoiceQuestion } from './fixtures'

const PAGE_ID = 'page:retry-test.mdx'

/**
 * The shared two-question fixture with an authored cap of three attempts: the
 * wizard round-trips single- and multiple-choice answers through both
 * presentations.
 */
const retryQuestionnaire: QuestionnaireNode = { ...questionnaireNode, maxAttempts: 3 }
const expandedRetryQuestionnaire: QuestionnaireNode = {
  ...retryQuestionnaire,
  expanded: true
}

/** The default single-attempt cap the parser normalizes omitted props to. */
const defaultSingleQuestionnaire: QuestionnaireNode = { ...questionnaireNode }

/** An authored cap of -1: every imperfect result stays open indefinitely. */
const unlimitedQuestionnaire: QuestionnaireNode = { ...retryQuestionnaire, maxAttempts: -1 }

/** An explicitly single-attempt questionnaire so both caps render the same. */
const explicitSingleQuestionnaire: QuestionnaireNode = {
  ...questionnaireNode,
  maxAttempts: 1
}

/** A second, single-attempt questionnaire so a retry cannot leak across nodes. */
const otherQuestion: QuestionNode = {
  type: 'question',
  id: 'question:other.mdx:1:1',
  questionType: 'single-choice',
  prompt: 'Pick the best outcome',
  options: [
    { value: 'good', correct: true, content: 'Good' },
    { value: 'bad', correct: false, content: 'Bad' }
  ]
}
const otherQuestionnaire: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:other.mdx:1:1',
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts: 1,
  shuffleOptions: false,
  questions: [otherQuestion]
}

/** A second two-question stepper to verify questionnaire-local saved positions. */
const secondPositionQuestionnaire: QuestionnaireNode = {
  ...retryQuestionnaire,
  id: 'questionnaire:second-position.mdx:1:1',
  questions: retryQuestionnaire.questions.map((question, index) => ({
    ...question,
    id: `${question.id}:second-position`,
    prompt: `Second questionnaire question ${index + 1}`
  }))
}

function pageWith(nodes: QuestionnaireNode[]): PageNode {
  return {
    type: 'page',
    id: PAGE_ID,
    source: 'retry-test.mdx',
    metadata: { title: 'Retries' },
    content: nodes
  }
}

function makePackage(
  presentation: 'scroll' | 'slides',
  nodes: QuestionnaireNode[]
): ContentPackage {
  const page = pageWith(nodes)
  return presentation === 'slides'
    ? { metadata: { title: 'Retries' }, presentation: { type: 'slides', pages: [page] } }
    : { metadata: { title: 'Retries' }, presentation: { type: 'scroll', pages: [page] } }
}

let restoredState: PlayerState
let saveState: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root
let session: PlayerSession | undefined

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoredState = { pages: {} }
  saveState = vi.fn()
  window.scormBridge = { restoreState: () => restoredState, saveState }
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

/**
 * Renders questionnaire views inside one player session. Every view is wrapped
 * in a test id so assertions can scope a questionnaire's DOM when several
 * questionnaires share the page.
 */
function PlayerViews({
  contentPackage,
  views
}: {
  contentPackage: ContentPackage
  views: Array<{ key: string; node: QuestionnaireNode }>
}) {
  return (
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={contentPackage}>
        <PageProvider pageId={PAGE_ID}>
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

/** Renders the session hook directly, without any presentation chrome. */
function SessionHarness({ contentPackage }: { contentPackage: ContentPackage }) {
  session = usePlayerSession(contentPackage)
  return null
}

function render(contentPackage: ContentPackage, nodes: QuestionnaireNode[]): void {
  act(() =>
    root.render(
      <PlayerViews
        contentPackage={contentPackage}
        views={nodes.map((node, index) => ({ key: index === 0 ? 'retryable' : 'other', node }))}
      />
    )
  )
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

function visibleButtonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const element = Array.from(scope.querySelectorAll('button')).find(
    (candidate) => !candidate.hasAttribute('hidden') && candidate.textContent?.trim() === label
  )
  if (!element) throw new Error(`Button not found: ${label}`)
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

function summaryIn(scope: ParentNode): HTMLElement | null {
  return scope.querySelector<HTMLElement>('[data-slot="questionnaire-summary"]')
}

function summaryTextIn(scope: ParentNode): string {
  const text = summaryIn(scope)?.textContent ?? ''
  if (!text) throw new Error('Summary not found')
  return text
}

/** The visible percent text of the summary's progress circle. */
function summaryPercentIn(scope: ParentNode): string {
  const element = scope.querySelector<HTMLElement>(
    '[data-slot="questionnaire-summary"] [aria-hidden="true"]'
  )
  if (!element) throw new Error('Summary percentage not found')
  return element.textContent ?? ''
}

function retryIn(scope: ParentNode): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>('[data-slot="questionnaire-retry"]')
}

function completeButtonIn(scope: ParentNode): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>('[data-slot="questionnaire-complete"]')
}

function activeItemIn(scope: ParentNode): HTMLElement {
  const element = scope.querySelector<HTMLElement>('[data-slot="questionnaire-item"]:not([hidden])')
  if (!element) throw new Error('No active questionnaire item')
  return element
}

function itemsIn(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-slot="questionnaire-item"]'))
}

function lastPageState(): PlayerPageState | undefined {
  const [lastState] = saveState.mock.calls.at(-1) ?? []
  return (lastState as PlayerState | undefined)?.pages[PAGE_ID]
}

/** The score forwarded to the most recent `setScore` bridge call. */
function lastReportedScore(setScore: { mock: { calls: unknown[][] } }): unknown {
  return setScore.mock.calls.at(-1)?.[0]
}

/**
 * Answers both wizard questions and submits. Each retry round remounts the
 * wizard at its first question, so the same click sequence works every round.
 */
function submitStepperRound(scope: ParentNode, singleValue: string, multipleValue: string): void {
  act(() => inputIn(scope, singleValue).click())
  act(() => clickableButtonIn(scope, 'Next question').click())
  act(() => inputIn(scope, multipleValue).click())
  act(() => clickableButtonIn(scope, 'Submit questionnaire').click())
}

describe('questionnaire submission caps (stepper)', () => {
  it('completes the parser-normalized single attempt immediately', () => {
    render(makePackage('scroll', [defaultSingleQuestionnaire]), [defaultSingleQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    // With the normalized single-attempt cap the summary is the end of the
    // flow: no retry or Complete action, read-only review items, and a
    // disabled Submit — exactly like before retries existed.
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
    // The attempt is recorded and the resulting state completes it in the same
    // write, because submitting an explicit cap consumes the last attempt.
    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [defaultSingleQuestionnaire.id]: [2]
    })
    expect(lastPageState()?.completedQuestionnaires).toEqual([defaultSingleQuestionnaire.id])
    expect(lastPageState()?.submittedQuestionnaires).toEqual([defaultSingleQuestionnaire.id])
    expect(lastPageState()?.activeQuestionnaireRetries).toBeUndefined()
  })

  it('completes an explicitly single-attempt questionnaire the same way', () => {
    render(makePackage('scroll', [explicitSingleQuestionnaire]), [explicitSingleQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')

    // The explicit single attempt is recorded and completed immediately: no
    // decision appears, and the review stays read-only. It renders exactly
    // like the omitted-cap default above.
    const page = lastPageState()
    expect(page?.questionnaireAttempts).toEqual({ [explicitSingleQuestionnaire.id]: [2] })
    expect(page?.completedQuestionnaires).toEqual([explicitSingleQuestionnaire.id])
    expect(page?.submittedQuestionnaires).toEqual([explicitSingleQuestionnaire.id])
    expect(page?.activeQuestionnaireRetries).toBeUndefined()
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
  })
})

describe('questionnaire retry flow (stepper)', () => {
  it('clears only the retried answers and restarts the wizard on retry', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryIn(quiz)).not.toBeNull()
    expect(retryIn(quiz)).not.toBeNull()

    act(() => retryIn(quiz)!.click())

    // The submission result is gone, the wizard starts at its first question
    // again, and every choice is editable instead of read-only feedback.
    expect(summaryIn(quiz)).toBeNull()
    expect(activeItemIn(quiz).textContent).toContain(singleChoiceQuestion.prompt)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === null)).toBe(true)
    for (const value of ['first', 'second']) {
      expect(inputIn(quiz, value).disabled).toBe(false)
      expect(inputIn(quiz, value).checked).toBe(false)
    }
    const retrying = lastPageState()
    expect(retrying?.activeQuestionnaireRetries).toEqual([retryQuestionnaire.id])
    expect(retrying?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })
    expect(retrying?.submittedQuestionnaires).toBeUndefined()
    // The wrong answers from the previous attempt were cleared with everything
    // else that belonged to this questionnaire.
    expect(retrying?.answers).toBeUndefined()

    // A fresh interaction is accepted: the cleared choice can be reselected.
    act(() => inputIn(quiz, 'first').click())
    expect(inputIn(quiz, 'first').checked).toBe(true)
  })

  it('offers Try Again and Complete for a pending below-full result', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    const summary = summaryIn(quiz)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    // Both decisions are children inside the summary card, not separate
    // actions beside it.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summary)
    expect(completeButtonIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summary)
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)

    // The submission stays pending: one recorded attempt, no completed
    // decision yet, and no active retry until one is requested.
    const pending = lastPageState()
    expect(pending?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })
    expect(pending?.completedQuestionnaires).toBeUndefined()
    expect(pending?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(pending?.activeQuestionnaireRetries).toBeUndefined()
    // A pending result also reports no aggregate score at all.
    expect(lastReportedScore(setScore)).toBeUndefined()

    // Complete closes the decision without recording another attempt.
    act(() => completeButtonIn(quiz)!.click())
    const completed = lastPageState()
    expect(completed?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })
    expect(completed?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(completed?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])

    // The completed review keeps its summary and loses both decisions.
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    // The completed result finally counts toward the aggregate score: the
    // best — and here the only — recorded attempt.
    expect(lastReportedScore(setScore)).toEqual({ earned: 0, possible: 2 })
  })

  it('shows the latest pending attempt in the summary, keeping the best score separate', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    // Attempt 1 scores one point and stays pending with attempts left.
    submitStepperRound(quiz, 'first', 'beta')
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(retryIn(quiz)).not.toBeNull()
    act(() => retryIn(quiz)!.click())

    // Attempt 2 scores lower; the open summary keeps reporting the LATEST
    // recorded attempt while the decision stays open.
    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [1, 0] })

    // Completing keeps that summary text but starts reporting the aggregate
    // score, which is the best recorded attempt — never the displayed one.
    expect(lastReportedScore(setScore)).toBeUndefined()
    act(() => completeButtonIn(quiz)!.click())
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(lastReportedScore(setScore)).toEqual({ earned: 1, possible: 2 })
  })

  it('shows the latest pending attempt after an improving retry', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    // Attempt 1 is wrong; the retry stays open with attempts left.
    submitStepperRound(quiz, 'second', 'beta')
    act(() => retryIn(quiz)!.click())

    // Attempt 2 scores higher; the open summary reports that latest attempt.
    submitStepperRound(quiz, 'first', 'beta')
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('50%')
    expect(retryIn(quiz)).not.toBeNull()
    expect(completeButtonIn(quiz)).not.toBeNull()
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 1] })
  })

  it('completes a perfect submission automatically without offering decisions', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')

    // A perfect first attempt closes the result on its own: the summary shows
    // without either decision and the result is marked completed immediately.
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('100%')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
    const completed = lastPageState()
    expect(completed?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [2] })
    expect(completed?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The perfect best attempt is reported to the bridge in the same flow.
    expect(lastReportedScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('completes automatically at the exhausted cap after imperfect attempts', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'second', 'beta')
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'second', 'beta')

    // The exhausted cap consumes the last attempt, so the third summary needs
    // no decision and hides both actions.
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    const completed = lastPageState()
    expect(completed?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 0, 0] })
    expect(completed?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
  })

  it('stops offering Try Again after the last attempt is consumed', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'first', 'beta')

    // One attempt remains, so both decisions are offered. The history records
    // both submissions: the wrong one first, this better one second.
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 1] })
    expect(retryIn(quiz)).not.toBeNull()
    expect(completeButtonIn(quiz)).not.toBeNull()
    act(() => retryIn(quiz)!.click())

    // The final submission exhausts the cap and completes automatically: no
    // decision is offered anymore.
    submitStepperRound(quiz, 'first', 'beta')
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(lastPageState()?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
  })

  it('shows the remaining count on the finite retry label', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')

    // A finite cap keeps its localized remaining-count label: two submissions
    // of the authored three are still possible.
    expect(retryIn(quiz)!.textContent).toBe('Try again (2 remaining)')
  })
})

describe('questionnaire retry flow with hidden results (stepper)', () => {
  const hiddenRetryQuestionnaire: QuestionnaireNode = {
    ...retryQuestionnaire,
    revealCorrectAnswers: false
  }

  const optionValues = ['first', 'second', 'alpha', 'beta']

  function choiceClassIn(scope: ParentNode, value: string): string {
    const choice = inputIn(scope, value).closest<HTMLElement>('[data-slot="questionnaire-choice"]')
    if (!choice) throw new Error(`Choice not found for value: ${value}`)
    return choice.className
  }

  /**
   * The submitted result palette never paints any choice: no emerald green for
   * correct options and no submitted destructive tint for a selected wrong one.
   * The stepper conveys results only through styling, and the interactive
   * validation border is inert for answered items, so only the submitted
   * opacity-modified destructive tints would count as feedback here.
   */
  function expectUndisclosedChoices(scope: ParentNode): void {
    for (const value of optionValues) {
      const className = choiceClassIn(scope, value)
      expect(className).not.toContain('emerald')
      expect(className).not.toContain('bg-destructive')
      expect(className).not.toContain('border-destructive/')
    }
  }

  it('keeps retry and the summary score unchanged while answers stay undisclosed', () => {
    render(makePackage('scroll', [hiddenRetryQuestionnaire]), [hiddenRetryQuestionnaire])
    const quiz = region('retryable')

    // A wrong attempt stays fully reviewable but undisclosed: the submitted
    // review is read-only and its saved selections render as ordinary primary
    // picks, never wearing the result palette.
    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(choiceClassIn(quiz, 'second')).toContain('data-checked:border-primary/40')
    expect(choiceClassIn(quiz, 'beta')).toContain('data-checked:border-primary/40')
    expectUndisclosedChoices(quiz)

    // The retry works exactly as it does with results revealed: the summary
    // disappears and every choice returns editable with no saved selection.
    act(() => retryIn(quiz)!.click())
    expect(summaryIn(quiz)).toBeNull()
    expect(activeItemIn(quiz).textContent).toContain(singleChoiceQuestion.prompt)
    for (const value of ['first', 'second']) {
      expect(inputIn(quiz, value).disabled).toBe(false)
      expect(inputIn(quiz, value).checked).toBe(false)
    }

    // The better retried attempt records its own score, which the summary
    // reports while no correctness is disclosed once again.
    submitStepperRound(quiz, 'first', 'beta')
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('50%')
    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [hiddenRetryQuestionnaire.id]: [0, 1]
    })
    expectUndisclosedChoices(quiz)

    // Completing closes the decision: the completed review keeps its summary
    // score and its read-only, undisclosed choices.
    act(() => completeButtonIn(quiz)!.click())
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expectUndisclosedChoices(quiz)
  })
})

describe('questionnaire retry flow (expanded)', () => {
  it('completes a single submission immediately when no higher cap is authored', () => {
    const singleAttempt: QuestionnaireNode = { ...questionnaireNode, expanded: true }
    render(makePackage('scroll', [singleAttempt]), [singleAttempt])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    expect(lastPageState()?.completedQuestionnaires).toEqual([singleAttempt.id])
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
  })

  it('makes every question editable again on retry, completes early, and records the new attempt', () => {
    render(makePackage('scroll', [expandedRetryQuestionnaire]), [expandedRetryQuestionnaire])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())
    expect(summaryIn(quiz)).not.toBeNull()
    expect(retryIn(quiz)).not.toBeNull()
    // The open expanded result offers both decisions as children inside the
    // summary card rather than as separate sibling actions.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summaryIn(quiz))
    expect(completeButtonIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(
      summaryIn(quiz)
    )
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()

    act(() => retryIn(quiz)!.click())

    // The expanded form stays expanded: all questions at once, all editable.
    for (const value of ['first', 'second', 'alpha', 'beta']) {
      expect(inputIn(quiz, value).disabled).toBe(false)
      expect(inputIn(quiz, value).checked).toBe(false)
    }
    // The submit action is gated again until the retried answers are complete.
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)

    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    // The perfect retried result completes automatically: the summary shows
    // without either decision.
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('100%')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
    const completed = lastPageState()
    expect(completed?.questionnaireAttempts).toEqual({
      [expandedRetryQuestionnaire.id]: [0, 2]
    })
    expect(completed?.completedQuestionnaires).toEqual([expandedRetryQuestionnaire.id])
  })

  it('lets the learner complete an imperfect expanded result while attempts remain', () => {
    render(makePackage('scroll', [expandedRetryQuestionnaire]), [expandedRetryQuestionnaire])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    // One correct answer with two attempts left: the open summary offers both
    // decisions around the latest attempt's score.
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('50%')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [expandedRetryQuestionnaire.id]: [1] })

    act(() => completeButtonIn(quiz)!.click())

    // Completing keeps the submitted attempt and the displayed latest score;
    // only the completed decision flips, closing both actions.
    const completed = lastPageState()
    expect(completed?.completedQuestionnaires).toEqual([expandedRetryQuestionnaire.id])
    expect(completed?.questionnaireAttempts).toEqual({ [expandedRetryQuestionnaire.id]: [1] })
    expect(completed?.submittedQuestionnaires).toEqual([expandedRetryQuestionnaire.id])
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })
})

describe('unlimited attempts (stepper)', () => {
  it('grows the attempt history below 100% and never auto-completes it', () => {
    render(makePackage('scroll', [unlimitedQuestionnaire]), [unlimitedQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')

    // An imperfect attempt records itself and stays pending; the unlimited
    // allowance renders the plain localized label with no count, no -1, and
    // no Infinity leaking into the button.
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [unlimitedQuestionnaire.id]: [0] })
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()
    expect(retryIn(quiz)).not.toBeNull()
    expect(completeButtonIn(quiz)).not.toBeNull()
    expect(retryIn(quiz)!.textContent).toBe('Try again')

    // Two more imperfect submissions keep appending one attempt each. No cap
    // ever exhausts, so nothing completes automatically at any point.
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'second', 'beta')
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'first', 'beta')

    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [unlimitedQuestionnaire.id]: [0, 0, 1]
    })
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()
    expect(retryIn(quiz)).not.toBeNull()
    expect(completeButtonIn(quiz)).not.toBeNull()
    // The label keeps its plain form no matter how many attempts were used.
    expect(retryIn(quiz)!.textContent).toBe('Try again')
  })

  it('completes a perfect submission automatically and offers no retry after completion', () => {
    render(makePackage('scroll', [unlimitedQuestionnaire]), [unlimitedQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')

    // Even with an unlimited remaining allowance, a perfect attempt closes the
    // result on its own and both decisions disappear for good.
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('100%')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [unlimitedQuestionnaire.id]: [2] })
    expect(lastPageState()?.completedQuestionnaires).toEqual([unlimitedQuestionnaire.id])
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })

  it('completes manually and reports the best submitted attempt as the score', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [unlimitedQuestionnaire]), [unlimitedQuestionnaire])
    const quiz = region('retryable')

    // The first attempt scores one point and stays pending.
    submitStepperRound(quiz, 'first', 'beta')
    act(() => retryIn(quiz)!.click())
    // A worse second attempt keeps the summary pinned to the latest attempt.
    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [unlimitedQuestionnaire.id]: [1, 0] })
    // While the decision stays open, nothing is reported to the bridge yet.
    expect(lastReportedScore(setScore)).toBeUndefined()

    // Completing the decision reports the BEST recorded attempt to the bridge,
    // never the displayed latest one.
    act(() => completeButtonIn(quiz)!.click())
    expect(lastPageState()?.completedQuestionnaires).toEqual([unlimitedQuestionnaire.id])
    expect(lastReportedScore(setScore)).toEqual({ earned: 1, possible: 2 })
    // A completed unlimited result closes both decisions permanently.
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })
})

describe('unlimited attempts (expanded)', () => {
  /** The expanded questionnaire with an authored cap of -1. */
  const unlimitedExpanded: QuestionnaireNode = { ...unlimitedQuestionnaire, expanded: true }

  it('grows the attempt history below 100% and never auto-completes it', () => {
    render(makePackage('scroll', [unlimitedExpanded]), [unlimitedExpanded])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [unlimitedExpanded.id]: [0] })
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()
    expect(retryIn(quiz)).not.toBeNull()
    expect(completeButtonIn(quiz)).not.toBeNull()
    // The expanded presentation shows the same plain localized retry label.
    expect(retryIn(quiz)!.textContent).toBe('Try again')

    act(() => retryIn(quiz)!.click())
    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(lastPageState()?.questionnaireAttempts).toEqual({ [unlimitedExpanded.id]: [0, 1] })
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()
    expect(retryIn(quiz)!.textContent).toBe('Try again')
  })

  it('completes a perfect submission automatically and offers no retry after completion', () => {
    render(makePackage('scroll', [unlimitedExpanded]), [unlimitedExpanded])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('100%')
    expect(lastPageState()?.completedQuestionnaires).toEqual([unlimitedExpanded.id])
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })

  it('completes manually and reports the best submitted attempt as the score', () => {
    const setScore = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [unlimitedExpanded]), [unlimitedExpanded])
    const quiz = region('retryable')

    // The first attempt scores one point; a worse retry follows it.
    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())
    act(() => retryIn(quiz)!.click())
    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')

    // Completing reports the best recorded attempt, not the displayed latest.
    act(() => completeButtonIn(quiz)!.click())
    expect(lastPageState()?.completedQuestionnaires).toEqual([unlimitedExpanded.id])
    expect(lastReportedScore(setScore)).toEqual({ earned: 1, possible: 2 })
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })
})

describe('retry clears only its own answers', () => {
  it('keeps the other questionnaire submitted, answered, and read-only', () => {
    const twoQuestionnaires = makePackage('scroll', [retryQuestionnaire, otherQuestionnaire])
    render(twoQuestionnaires, [retryQuestionnaire, otherQuestionnaire])
    const quiz = region('retryable')
    const other = region('other')

    // Submit both: the retryable one wrong, the single-attempt one correct.
    submitStepperRound(quiz, 'second', 'beta')
    act(() => inputIn(other, 'good').click())
    act(() => clickableButtonIn(other, 'Submit questionnaire').click())
    // The submitted stepper exposes its review as read-only items while its
    // checked answer stays intact.
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)

    act(() => retryIn(quiz)!.click())

    // Only the retried questionnaire is cleared back to editable inputs.
    expect(inputIn(quiz, 'second').disabled).toBe(false)
    expect(inputIn(quiz, 'second').checked).toBe(false)
    // The other questionnaire keeps its answer, its submission, and its summary.
    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')
    expect(retryIn(other)).toBeNull()
    expect(completeButtonIn(other)).toBeNull()

    const retrying = lastPageState()
    expect(retrying?.answers).toEqual({ [otherQuestion.id]: 'good' })
    expect(retrying?.submittedQuestionnaires).toEqual([otherQuestionnaire.id])
    expect(retrying?.activeQuestionnaireRetries).toEqual([retryQuestionnaire.id])
    // Each questionnaire keeps its own attempt history: the retried round and
    // the other questionnaire's successful submission.
    expect(retrying?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0],
      [otherQuestionnaire.id]: [1]
    })
    // The single-attempt questionnaire auto-completed with its submission.
    expect(retrying?.completedQuestionnaires).toEqual([otherQuestionnaire.id])
  })
})

describe('stepper active-question persistence', () => {
  it('saves the active question on Next and Previous and restores it with saved answers', () => {
    const savedAnswers = {
      [singleChoiceQuestion.id]: 'first',
      [multipleChoiceQuestion.id]: ['beta']
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'first').click())
    act(() => clickableButtonIn(quiz, 'Next question').click())
    expect(activeItemIn(quiz).textContent).toContain(multipleChoiceQuestion.prompt)
    expect(lastPageState()?.activeQuestionnaireItems).toEqual({
      [retryQuestionnaire.id]: multipleChoiceQuestion.id
    })

    act(() => clickableButtonIn(quiz, 'Previous question').click())
    expect(activeItemIn(quiz).textContent).toContain(singleChoiceQuestion.prompt)
    expect(lastPageState()?.activeQuestionnaireItems).toEqual({
      [retryQuestionnaire.id]: singleChoiceQuestion.id
    })

    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          answers: savedAnswers,
          activeQuestionnaireItems: { [retryQuestionnaire.id]: multipleChoiceQuestion.id }
        }
      }
    }
    act(() => root.unmount())
    root = createRoot(container)
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])

    const restoredQuiz = region('retryable')
    expect(activeItemIn(restoredQuiz).textContent).toContain(multipleChoiceQuestion.prompt)
    expect(inputIn(restoredQuiz, 'first').checked).toBe(true)
    expect(inputIn(restoredQuiz, 'beta').checked).toBe(true)
  })

  it('keeps independent active positions for two questionnaires on one page', () => {
    const questionnaires = [retryQuestionnaire, secondPositionQuestionnaire]
    render(makePackage('scroll', questionnaires), questionnaires)
    const firstQuiz = region('retryable')
    const secondQuiz = region('other')

    act(() => inputIn(firstQuiz, 'first').click())
    act(() => clickableButtonIn(firstQuiz, 'Next question').click())
    act(() => inputIn(secondQuiz, 'first').click())
    act(() => clickableButtonIn(secondQuiz, 'Next question').click())
    act(() => clickableButtonIn(firstQuiz, 'Previous question').click())

    expect(activeItemIn(firstQuiz).textContent).toContain(singleChoiceQuestion.prompt)
    expect(activeItemIn(secondQuiz).textContent).toContain('Second questionnaire question 2')
    expect(lastPageState()?.activeQuestionnaireItems).toEqual({
      [retryQuestionnaire.id]: singleChoiceQuestion.id,
      [secondPositionQuestionnaire.id]: secondPositionQuestionnaire.questions[1].id
    })
  })

  it('returns to the first question after retry and restores a submitted review position', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    expect(lastPageState()?.activeQuestionnaireItems).toEqual({
      [retryQuestionnaire.id]: multipleChoiceQuestion.id
    })
    act(() => retryIn(quiz)!.click())
    expect(activeItemIn(quiz).textContent).toContain(singleChoiceQuestion.prompt)
    expect(lastPageState()?.activeQuestionnaireItems).toBeUndefined()

    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
          answers: {
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['beta']
          },
          activeQuestionnaireItems: { [retryQuestionnaire.id]: multipleChoiceQuestion.id }
        }
      }
    }
    act(() => root.unmount())
    root = createRoot(container)
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])

    const review = region('retryable')
    expect(activeItemIn(review).textContent).toContain(multipleChoiceQuestion.prompt)
    expect(activeItemIn(review).getAttribute('aria-readonly')).toBe('true')
    expect(inputIn(review, 'second').checked).toBe(true)
    expect(inputIn(review, 'beta').checked).toBe(true)
    expect(summaryTextIn(review)).toContain('0 of 2 correct answers')
  })

  it('falls back to the first question when the saved id is not authored', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          activeQuestionnaireItems: { [retryQuestionnaire.id]: 'question:removed' }
        }
      }
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])

    expect(activeItemIn(region('retryable')).textContent).toContain(singleChoiceQuestion.prompt)
  })
})

describe('pending decisions across a refresh', () => {
  const refreshPackage = makePackage('scroll', [retryQuestionnaire, otherQuestionnaire])

  it.each(['scroll', 'slides'] as const)(
    'keeps an unfinished %s retry editable and finishes it after the refresh',
    (presentation) => {
      restoredState = {
        pages: {
          [PAGE_ID]: {
            visited: true,
            completed: true,
            questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
            activeQuestionnaireRetries: [retryQuestionnaire.id],
            submittedQuestionnaires: [otherQuestionnaire.id],
            answers: { [otherQuestion.id]: 'good' }
          }
        }
      }
      render(makePackage(presentation, [retryQuestionnaire, otherQuestionnaire]), [
        retryQuestionnaire,
        otherQuestionnaire
      ])
      const quiz = region('retryable')
      const other = region('other')

      // The retried questionnaire resumes mid-retry: editable, no summary, and
      // the completed page is not inferred back to read-only for it — even
      // though page completion normally covers every submitted questionnaire.
      expect(activeItemIn(quiz).textContent).toContain(singleChoiceQuestion.prompt)
      expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === null)).toBe(true)
      expect(inputIn(quiz, 'second').checked).toBe(false)
      expect(summaryIn(quiz)).toBeNull()

      // The other questionnaire stays exactly as saved: submitted and answered.
      const otherInput = inputIn(other, 'good')
      expect(otherInput.checked).toBe(true)
      expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(
        true
      )
      expect(summaryTextIn(other)).toContain('1 of 1 correct answers')

      // The restored attempt history is kept, so finishing the retry round
      // appends the second attempt. The perfect result completes itself, and
      // the stale persisted completion flag stays dropped: page completion is
      // re-derived by the presentation only after the decision is closed.
      submitStepperRound(quiz, 'first', 'alpha')
      expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
      expect(retryIn(quiz)).toBeNull()
      expect(completeButtonIn(quiz)).toBeNull()
      const afterComplete = lastPageState()
      expect(afterComplete?.completed).toBeUndefined()
      expect(afterComplete?.questionnaireAttempts).toEqual({
        [retryQuestionnaire.id]: [0, 2],
        [otherQuestionnaire.id]: [1]
      })
      expect(afterComplete?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
      // Finishing the retry adds the questionnaire back to the submitted list
      // while the other questionnaire's submission was never disturbed.
      expect(afterComplete?.submittedQuestionnaires).toEqual([
        otherQuestionnaire.id,
        retryQuestionnaire.id
      ])
      expect(afterComplete?.activeQuestionnaireRetries).toBeUndefined()
      expect(afterComplete?.answers).toEqual({
        [otherQuestion.id]: 'good',
        [singleChoiceQuestion.id]: 'first',
        [multipleChoiceQuestion.id]: ['alpha']
      })
    }
  )

  it('restores an exhausted pending result without any decision actions', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completed: true,
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 0, 0] },
          // A stale retry marker must not resurrect an exhausted questionnaire.
          activeQuestionnaireRetries: [retryQuestionnaire.id],
          submittedQuestionnaires: [otherQuestionnaire.id],
          answers: {
            [otherQuestion.id]: 'good',
            [singleChoiceQuestion.id]: 'second'
          }
        }
      }
    }
    render(refreshPackage, [retryQuestionnaire, otherQuestionnaire])
    const quiz = region('retryable')
    const other = region('other')

    // The restored submission stays open: every saved answer is read-only
    // feedback, and neither decision is offered — the cap is exhausted so a
    // retry is impossible, and a live submission would have completed this
    // result itself, so no recorded write can carry this shape.
    expect(inputIn(quiz, 'second').checked).toBe(true)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()

    // The other questionnaire keeps its submission from the restored state.
    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')
  })

  it('restores a completed decision as read-only review without decisions', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completed: true,
          completedQuestionnaires: [retryQuestionnaire.id, otherQuestionnaire.id],
          submittedQuestionnaires: [otherQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 2], [otherQuestionnaire.id]: [1] },
          answers: {
            [otherQuestion.id]: 'good',
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha']
          }
        }
      }
    }
    render(refreshPackage, [retryQuestionnaire, otherQuestionnaire])
    const quiz = region('retryable')
    const other = region('other')

    // After the refresh a completed result is read-only review: no pending
    // decision, no retry eligibility, and the persisted page completion is
    // valid because every authored questionnaire completed its result.
    expect(inputIn(quiz, 'first').checked).toBe(true)
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(inputIn(quiz, 'second').checked).toBe(false)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()

    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')
    expect(inputIn(other, 'good').disabled).toBe(false)
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
  })

  it('restores the latest attempt into the summary while the best score stays separate', () => {
    const setScore = vi.fn()
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completedQuestionnaires: [retryQuestionnaire.id],
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1, 2, 0] },
          answers: {
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['beta']
          }
        }
      }
    }
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      setScore
    }
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    // The restored result completed its third attempt, so the review is
    // read-only and shows the LATEST attempt (0) rather than the best (2).
    expect(inputIn(quiz, 'second').checked).toBe(true)
    expect(inputIn(quiz, 'beta').checked).toBe(true)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()

    // The reported SCORM score is the best recorded attempt, kept separate
    // from the displayed latest one.
    expect(lastReportedScore(setScore)).toEqual({ earned: 2, possible: 2 })
  })

  it('resumes an unlimited pending result with its full history after a refresh', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completed: true,
          // Six attempts exceed any finite cap, yet the unlimited cap restores
          // the whole record and keeps the decision open.
          questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1, 0] },
          answers: {
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['beta']
          }
        }
      }
    }
    render(makePackage('scroll', [unlimitedQuestionnaire]), [unlimitedQuestionnaire])
    const quiz = region('retryable')

    // The resumed review shows the latest attempt and the plain localized
    // retry label: no count, no -1, no Infinity, and no auto-completion after
    // a restore.
    expect(inputIn(quiz, 'second').checked).toBe(true)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('0%')
    expect(retryIn(quiz)!.textContent).toBe('Try again')
    expect(completeButtonIn(quiz)).not.toBeNull()
    // The stale persisted page completion never leaks back into the session.
    expect(lastPageState()?.completed).toBeUndefined()

    // Another imperfect submission appends one more attempt and stays open.
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'second', 'beta')
    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1, 0, 0]
    })
    expect(lastPageState()?.completedQuestionnaires).toBeUndefined()
    expect(retryIn(quiz)!.textContent).toBe('Try again')
  })

  it('resumes a completed unlimited result as read-only review after a refresh', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completed: true,
          completedQuestionnaires: [unlimitedQuestionnaire.id],
          questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 2] },
          answers: {
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha']
          }
        }
      }
    }
    render(makePackage('scroll', [unlimitedQuestionnaire]), [unlimitedQuestionnaire])
    const quiz = region('retryable')

    // A completed result keeps every restored attempt, closes its decision,
    // and stays read-only: no retry and no Complete action ever reappears.
    expect(inputIn(quiz, 'first').checked).toBe(true)
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(summaryPercentIn(quiz)).toBe('100%')
    expect(retryIn(quiz)).toBeNull()
    expect(completeButtonIn(quiz)).toBeNull()
  })
})

describe('usePlayerSession attempt transitions', () => {
  it('never records a submission past the authored attempt cap and completes it', () => {
    const quizPage = makePackage('scroll', [retryQuestionnaire])
    act(() => root.render(<SessionHarness contentPackage={quizPage} />))

    // Three submission rounds exhaust the cap; each round is followed by a
    // retry while an attempt remains, else the retry is refused.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() => session?.markQuestionnaireSubmitted(PAGE_ID, retryQuestionnaire.id))
      act(() =>
        session?.retryQuestionnaire(PAGE_ID, retryQuestionnaire.id, [
          singleChoiceQuestion.id,
          multipleChoiceQuestion.id
        ])
      )
    }

    const page = session?.state.pages[PAGE_ID]
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The history stops exactly at the cap instead of growing beyond it, and
    // the exhausted submission completes on its own without a decision.
    expect(page?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 0, 0] })
    expect(page?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.activeQuestionnaireRetries).toBeUndefined()

    // A further report on the submitted questionnaire writes nothing at all.
    const writes = saveState.mock.calls.length
    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, retryQuestionnaire.id))
    expect(saveState.mock.calls.length).toBe(writes)
    expect(session?.state.pages[PAGE_ID]?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0, 0, 0]
    })
  })

  it('grows a restored unlimited history and keeps the retry always available', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [unlimitedQuestionnaire.id],
          // Five attempts exceed any finite cap, yet an unlimited cap restores
          // the whole pending submission exactly as recorded.
          questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1] }
        }
      }
    }
    act(() =>
      root.render(
        <SessionHarness contentPackage={makePackage('scroll', [unlimitedQuestionnaire])} />
      )
    )
    const page = session?.state.pages[PAGE_ID]
    expect(page?.questionnaireAttempts).toEqual({ [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1] })

    // The retry is available again even after five recorded attempts; it
    // clears the submission without touching the recorded history.
    act(() =>
      session?.retryQuestionnaire(PAGE_ID, unlimitedQuestionnaire.id, [
        singleChoiceQuestion.id,
        multipleChoiceQuestion.id
      ])
    )
    expect(session?.state.pages[PAGE_ID]?.activeQuestionnaireRetries).toEqual([
      unlimitedQuestionnaire.id
    ])

    // The next submission appends exactly one imperfect attempt: no cap ever
    // refuses or auto-completes it for an unlimited questionnaire.
    act(() => session?.markQuestionnaireSubmitted(PAGE_ID, unlimitedQuestionnaire.id))
    const afterSubmit = session?.state.pages[PAGE_ID]
    expect(afterSubmit?.questionnaireAttempts).toEqual({
      [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1, 0]
    })
    expect(afterSubmit?.completedQuestionnaires).toBeUndefined()
    expect(afterSubmit?.submittedQuestionnaires).toEqual([unlimitedQuestionnaire.id])
    expect(afterSubmit?.activeQuestionnaireRetries).toBeUndefined()
  })

  it('derives the canonical result inside the submission write, never a stale count', () => {
    const setScore = vi.fn()
    window.scormBridge = { setScore }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    // One synchronous batch answers every question and reports the submission
    // — and a duplicate report — without an intervening render, so any
    // render-time count would still have seen an answerless questionnaire.
    act(() => {
      session?.setAnswer(PAGE_ID, singleChoiceQuestion.id, 'first')
      session?.setAnswer(PAGE_ID, multipleChoiceQuestion.id, ['alpha'])
      session?.markQuestionnaireSubmitted(PAGE_ID, retryQuestionnaire.id)
      session?.markQuestionnaireSubmitted(PAGE_ID, retryQuestionnaire.id)
    })

    const page = session?.state.pages[PAGE_ID]
    // The recorded attempt comes from the saved answers inside the write: a
    // full two correct answers, exactly once.
    expect(page?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [2] })
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The perfect result completes automatically in the same write.
    expect(page?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.activeQuestionnaireRetries).toBeUndefined()

    // The SCORM report path carries the completed 100% best score.
    const reported = setScore.mock.calls.at(-1)?.[0]
    expect(reported).toEqual({ earned: 2, possible: 2 })
  })

  it('ignores a repeated retry while one is already active', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          completed: true,
          questionnaireAttempts: { [retryQuestionnaire.id]: [0] }
        }
      }
    }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    act(() =>
      session?.retryQuestionnaire(PAGE_ID, retryQuestionnaire.id, [
        singleChoiceQuestion.id,
        multipleChoiceQuestion.id
      ])
    )
    const afterFirstRetry = session?.state
    const writes = saveState.mock.calls.length

    act(() =>
      session?.retryQuestionnaire(PAGE_ID, retryQuestionnaire.id, [
        singleChoiceQuestion.id,
        multipleChoiceQuestion.id
      ])
    )

    // The second retry is a no-op: the state object is unchanged and no extra
    // persist write happened. The persisted completion stayed dropped for the
    // pending page.
    expect(session?.state).toBe(afterFirstRetry)
    expect(saveState.mock.calls.length).toBe(writes)
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()
  })

  it('completes a pending result idempotently without adding an attempt', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] }
        }
      }
    }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    act(() => session?.completeQuestionnaire(PAGE_ID, retryQuestionnaire.id))

    const afterComplete = session?.state
    expect(afterComplete?.pages[PAGE_ID]?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The recorded attempt is kept exactly as it was.
    expect(afterComplete?.pages[PAGE_ID]?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [1]
    })

    const writes = saveState.mock.calls.length
    act(() => session?.completeQuestionnaire(PAGE_ID, retryQuestionnaire.id))

    // A second completion changes nothing and writes nothing.
    expect(session?.state).toBe(afterComplete)
    expect(saveState.mock.calls.length).toBe(writes)
  })

  it('never allows a retry of a completed questionnaire', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] },
          completedQuestionnaires: [retryQuestionnaire.id],
          answers: { [singleChoiceQuestion.id]: 'first' }
        }
      }
    }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    act(() =>
      session?.retryQuestionnaire(PAGE_ID, retryQuestionnaire.id, [
        singleChoiceQuestion.id,
        multipleChoiceQuestion.id
      ])
    )

    // The retry is refused: no active marker appears, the saved answers and
    // the completed decision survive untouched.
    const page = session?.state.pages[PAGE_ID]
    expect(page?.activeQuestionnaireRetries).toBeUndefined()
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.answers).toEqual({ [singleChoiceQuestion.id]: 'first' })
  })

  it('gates page completion on the completed decision and reports it after completing', () => {
    const completionBridge = vi.fn()
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      markCompleted: completionBridge
    }
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] }
        }
      }
    }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    // While the decision is pending, marking the page complete is refused and
    // the package is not reported complete to the bridge.
    act(() => session?.markCompleted(PAGE_ID))
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()
    expect(completionBridge.mock.calls.length).toBe(0)

    act(() => session?.completeQuestionnaire(PAGE_ID, retryQuestionnaire.id))
    act(() => session?.markCompleted(PAGE_ID))

    // With the decision closed, the page completes again and the package
    // completion reaches the bridge.
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
    expect(completionBridge.mock.calls.length).toBe(1)
  })

  it('delays a Tiles package completion report until its pending decision completes', () => {
    const QUIZ_ITEM_ID = 'item:quiz.mdx'
    const PLAIN_ITEM_ID = 'item:plain.mdx'
    const tilesPackage: ContentPackage = {
      metadata: { title: 'Tiles completion' },
      presentation: {
        type: 'tiles',
        columns: 2,
        items: [
          {
            type: 'item',
            id: QUIZ_ITEM_ID,
            source: 'quiz.mdx',
            metadata: { title: 'Quiz' },
            content: [retryQuestionnaire]
          },
          {
            type: 'item',
            id: PLAIN_ITEM_ID,
            source: 'plain.mdx',
            metadata: { title: 'Plain' },
            content: []
          }
        ]
      }
    }
    const completionBridge = vi.fn()
    // Valid session state: both items were opened, and the quiz item holds a
    // submitted-but-open assessment.
    restoredState = {
      pages: {
        [QUIZ_ITEM_ID]: {
          visited: true,
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] }
        },
        [PLAIN_ITEM_ID]: { visited: true }
      }
    }
    window.scormBridge = {
      restoreState: () => restoredState,
      saveState,
      markCompleted: completionBridge
    }
    act(() => root.render(<SessionHarness contentPackage={tilesPackage} />))

    // Every item counts as done for Tiles, but the open decision must keep the
    // package from reporting completion to the bridge.
    expect(completionBridge).not.toHaveBeenCalled()

    act(() => session?.completeQuestionnaire(QUIZ_ITEM_ID, retryQuestionnaire.id))

    // With the pending decision closed, the fully-visited package reports
    // completion.
    expect(completionBridge).toHaveBeenCalledTimes(1)
  })
})
