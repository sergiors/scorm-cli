// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuestionnaireSession } from '../../app/components/QuestionnaireShared'
import { QuestionnaireView } from '../../app/components/QuestionnaireView'
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
  questions: [otherQuestion]
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
let probeSession: ReturnType<typeof useQuestionnaireSession> | undefined

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
  probeSession = undefined
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

/**
 * Reads the questionnaire session for one node so a test can drive the shared
 * reporting boundary directly. Reinitialized on every render, which lets a
 * loop report one count per fresh session.
 */
function QuestionnaireSessionProbe({ node }: { node: QuestionnaireNode }) {
  probeSession = useQuestionnaireSession(node)
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

function retryIn(scope: ParentNode): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>('[data-slot="questionnaire-retry"]')
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

describe('questionnaire retry flow (stepper)', () => {
  it('keeps a single submission final when no higher attempt cap is authored', () => {
    render(makePackage('scroll', [questionnaireNode]), [questionnaireNode])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    // Without maxAttempts the summary is the end of the flow: no retry action,
    // read-only review items, and a disabled Submit — exactly like before
    // retries existed.
    expect(retryIn(quiz)).toBeNull()
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [questionnaireNode.id]: [2] })
    expect(lastPageState()?.activeQuestionnaireRetries).toBeUndefined()
  })

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

  it('records every attempt and hides Try Again once the cap is exhausted', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    // Attempt 1: wrong.
    submitStepperRound(quiz, 'second', 'beta')
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })

    // Attempt 2: a better retry keeps Try Again while attempts remain.
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'first', 'alpha')
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).not.toBeNull()
    // While a retry remains, Try Again is rendered as a child inside the
    // summary card rather than as a separate sibling action.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summaryIn(quiz))
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 2] })
    expect(lastPageState()?.activeQuestionnaireRetries).toBeUndefined()

    // Attempt 3 exhausts the cap: the last summary has no retry action.
    act(() => retryIn(quiz)!.click())
    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 2, 0] })
  })
})

describe('questionnaire retry flow (expanded)', () => {
  it('keeps a single submission final when no higher attempt cap is authored', () => {
    const singleAttempt: QuestionnaireNode = { ...questionnaireNode, expanded: true }
    render(makePackage('scroll', [singleAttempt]), [singleAttempt])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'first').click())
    act(() => inputIn(quiz, 'alpha').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())

    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
  })

  it('makes every question editable again on retry and records the new attempt', () => {
    render(makePackage('scroll', [expandedRetryQuestionnaire]), [expandedRetryQuestionnaire])
    const quiz = region('retryable')

    act(() => inputIn(quiz, 'second').click())
    act(() => inputIn(quiz, 'beta').click())
    act(() => clickableButtonIn(quiz, 'Submit questionnaire').click())
    expect(summaryIn(quiz)).not.toBeNull()
    expect(retryIn(quiz)).not.toBeNull()
    // While a retry remains, Try Again is rendered as a child inside the
    // summary card rather than as a separate sibling action.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summaryIn(quiz))

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

    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(lastPageState()?.questionnaireAttempts).toEqual({
      [expandedRetryQuestionnaire.id]: [0, 2]
    })
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
  })
})

describe('an unfinished retry across a refresh', () => {
  const refreshPackage = makePackage('scroll', [retryQuestionnaire, otherQuestionnaire])

  it.each(['scroll', 'slides'] as const)(
    'keeps a completed %s page editable for the retried questionnaire',
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
      // though page completion normally implies every questionnaire submitted.
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
      // appends the second attempt and clears the active retry again.
      submitStepperRound(quiz, 'first', 'alpha')
      expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
      expect(retryIn(quiz)).not.toBeNull()
      const afterRetry = lastPageState()
      expect(afterRetry?.completed).toBe(true)
      expect(afterRetry?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 2] })
      // Finishing the retry adds the questionnaire back to the submitted list
      // while the other questionnaire's submission was never disturbed.
      expect(afterRetry?.submittedQuestionnaires).toEqual([
        otherQuestionnaire.id,
        retryQuestionnaire.id
      ])
      expect(afterRetry?.activeQuestionnaireRetries).toBeUndefined()
      expect(afterRetry?.answers).toEqual({
        [otherQuestion.id]: 'good',
        [singleChoiceQuestion.id]: 'first',
        [multipleChoiceQuestion.id]: ['alpha']
      })
    }
  )

  it('restores a questionnaire at its attempt cap as read-only without a retry', () => {
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

    // Every saved answer is read-only feedback and the cap leaves no Try Again.
    expect(inputIn(quiz, 'second').checked).toBe(true)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryIn(quiz)).not.toBeNull()
    expect(retryIn(quiz)).toBeNull()

    // The other questionnaire keeps its submission from the restored state.
    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')
  })
})

describe('usePlayerSession attempt transitions', () => {
  it('never records a submission past the authored attempt cap', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 0, 0] }
        }
      }
    }
    act(() =>
      root.render(<SessionHarness contentPackage={makePackage('scroll', [retryQuestionnaire])} />)
    )

    act(() =>
      session?.markQuestionnaireSubmitted(
        PAGE_ID,
        retryQuestionnaire.id,
        2,
        retryQuestionnaire.maxAttempts
      )
    )

    const page = session?.state.pages[PAGE_ID]
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The history stays exactly at the cap instead of growing beyond it.
    expect(page?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 0, 0] })
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
      session?.retryQuestionnaire(
        PAGE_ID,
        retryQuestionnaire.id,
        [singleChoiceQuestion.id, multipleChoiceQuestion.id],
        retryQuestionnaire.maxAttempts
      )
    )
    const afterFirstRetry = session?.state
    const writes = saveState.mock.calls.length

    act(() =>
      session?.retryQuestionnaire(
        PAGE_ID,
        retryQuestionnaire.id,
        [singleChoiceQuestion.id, multipleChoiceQuestion.id],
        retryQuestionnaire.maxAttempts
      )
    )

    // The second retry is a no-op: the state object is unchanged and no extra
    // persist write happened.
    expect(session?.state).toBe(afterFirstRetry)
    expect(saveState.mock.calls.length).toBe(writes)
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
  })
})

describe('reported correct counts are clamped before they reach history', () => {
  const reportPackage = makePackage('scroll', [retryQuestionnaire])
  let probeKey = 0

  /**
   * Exposes one questionnaire session so a test can report counts directly the
   * way a composed presentation does, covering malformed public calls that the
   * regular submission flow can never produce. A fresh provider key remounts
   * the whole session, so each case starts from an untouched questionnaire.
   */
  function renderProbe(): void {
    probeKey += 1
    act(() =>
      root.render(
        <PlayerProvider key={`session-${probeKey}`} contentPackage={reportPackage}>
          <PageProvider pageId={PAGE_ID}>
            <QuestionnaireSessionProbe node={retryQuestionnaire} />
          </PageProvider>
        </PlayerProvider>
      )
    )
  }

  it('keeps in-range reported counts unchanged', () => {
    // Every valid count lands in the history exactly as reported, one attempt
    // per fresh session.
    for (const validCount of [0, 1, 2]) {
      renderProbe()
      act(() => probeSession?.onSubmitted?.(retryQuestionnaire.id, validCount))
      expect(lastPageState()?.questionnaireAttempts).toEqual({
        [retryQuestionnaire.id]: [validCount]
      })
    }
  })

  it('clamps oversized counts and falls back to zero for malformed ones', () => {
    for (const [reported, recorded] of [
      [99, 2], // Above the authored question count.
      [1.5, 0], // Not an integer point count.
      [-4, 0], // Negative.
      [Number.NaN, 0] // Not a number.
    ] as const) {
      renderProbe()
      act(() => probeSession?.onSubmitted?.(retryQuestionnaire.id, reported))
      // An out-of-bounds count would poison the history beyond the authored
      // question count, so the compact codec could no longer persist the
      // questionnaire's attempts after a refresh. The clamp keeps [recorded]
      // inside the countable range instead.
      expect(lastPageState()?.questionnaireAttempts).toEqual({
        [retryQuestionnaire.id]: [recorded]
      })
    }
  })
})
