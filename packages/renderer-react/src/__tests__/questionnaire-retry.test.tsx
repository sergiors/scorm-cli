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

function finalizeButtonIn(scope: ParentNode): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>('[data-slot="questionnaire-use-score"]')
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
    // An omitted cap keeps the immediate-final behavior without ever recording
    // a finalization decision.
    expect(lastPageState()?.finalizedQuestionnaires).toBeUndefined()
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

  it('offers Try Again and Use This Score for a pending below-full result', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'second', 'beta')
    const summary = summaryIn(quiz)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    // Both decisions are children inside the summary card, not separate
    // actions beside it.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summary)
    expect(finalizeButtonIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summary)
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)

    // The submission stays pending: one recorded attempt, no final decision
    // yet, and no active retry until one is requested.
    const pending = lastPageState()
    expect(pending?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })
    expect(pending?.finalizedQuestionnaires).toBeUndefined()
    expect(pending?.activeQuestionnaireRetries).toBeUndefined()

    // Use This Score finalizes the decision without recording another attempt.
    act(() => finalizeButtonIn(quiz)!.click())
    const finalized = lastPageState()
    expect(finalized?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0] })
    expect(finalized?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(finalized?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])

    // The finalized review keeps its summary and loses both decisions.
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)).toBeNull()
  })

  it('shows the best pending attempt after a worse retry', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    // Attempt 1 scores one point and stays pending with attempts left.
    submitStepperRound(quiz, 'first', 'beta')
    act(() => retryIn(quiz)!.click())

    // Attempt 2 scores lower; the pending summary keeps reporting the best
    // recorded attempt while the decision stays open.
    submitStepperRound(quiz, 'second', 'beta')
    expect(summaryTextIn(quiz)).toContain('1 of 2 correct answers')
    expect(retryIn(quiz)).not.toBeNull()
    expect(finalizeButtonIn(quiz)).not.toBeNull()
    expect(lastPageState()?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [1, 0] })
  })

  it('auto-finalizes a perfect submission without offering decisions', () => {
    render(makePackage('scroll', [retryQuestionnaire]), [retryQuestionnaire])
    const quiz = region('retryable')

    submitStepperRound(quiz, 'first', 'alpha')

    // A perfect first attempt is final on its own: the summary shows without
    // either decision and the submission is marked finalized immediately.
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)).toBeNull()
    expect(visibleButtonIn(quiz, 'Submit questionnaire').disabled).toBe(true)
    const finalized = lastPageState()
    expect(finalized?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [2] })
    expect(finalized?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
  })

  it('auto-finalizes at the exhausted cap after imperfect attempts', () => {
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
    expect(finalizeButtonIn(quiz)).toBeNull()
    const finalized = lastPageState()
    expect(finalized?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 0, 0] })
    expect(finalized?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
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
    // The pending expanded result offers both decisions as children inside the
    // summary card rather than as separate sibling actions.
    expect(retryIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(summaryIn(quiz))
    expect(finalizeButtonIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(
      summaryIn(quiz)
    )
    expect(lastPageState()?.finalizedQuestionnaires).toBeUndefined()

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

    // The perfect retried result auto-finalizes: the summary shows without
    // either decision.
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)).toBeNull()
    const finalized = lastPageState()
    expect(finalized?.questionnaireAttempts).toEqual({
      [expandedRetryQuestionnaire.id]: [0, 2]
    })
    expect(finalized?.finalizedQuestionnaires).toEqual([expandedRetryQuestionnaire.id])
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
      // appends the second attempt. The perfect result finalizes itself, and
      // the stale persisted completion flag stays dropped: page completion is
      // re-derived by the presentation only after the decision is closed.
      submitStepperRound(quiz, 'first', 'alpha')
      expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
      expect(retryIn(quiz)).toBeNull()
      expect(finalizeButtonIn(quiz)).toBeNull()
      const afterFinalize = lastPageState()
      expect(afterFinalize?.completed).toBeUndefined()
      expect(afterFinalize?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 2] })
      expect(afterFinalize?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
      // Finishing the retry adds the questionnaire back to the submitted list
      // while the other questionnaire's submission was never disturbed.
      expect(afterFinalize?.submittedQuestionnaires).toEqual([
        otherQuestionnaire.id,
        retryQuestionnaire.id
      ])
      expect(afterFinalize?.activeQuestionnaireRetries).toBeUndefined()
      expect(afterFinalize?.answers).toEqual({
        [otherQuestion.id]: 'good',
        [singleChoiceQuestion.id]: 'first',
        [multipleChoiceQuestion.id]: ['alpha']
      })
    }
  )

  it('restores an exhausted pending questionnaire with Use This Score only', () => {
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

    // The restored submission is pending: every saved answer is read-only
    // feedback, the exhausted cap leaves no Try Again, and only the final
    // decision remains.
    expect(inputIn(quiz, 'second').checked).toBe(true)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(quiz)).toContain('0 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)?.closest('[data-slot="questionnaire-summary"]')).toBe(
      summaryIn(quiz)
    )

    // The other questionnaire keeps its submission from the restored state.
    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')

    // Finalizing records the decision without adding an attempt; the dropped
    // stale completion flag is only re-derived by the presentation.
    act(() => finalizeButtonIn(quiz)!.click())
    const finalizedRestore = lastPageState()
    expect(finalizedRestore?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0, 0, 0]
    })
    expect(finalizedRestore?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(finalizedRestore?.submittedQuestionnaires).toEqual([
      retryQuestionnaire.id,
      otherQuestionnaire.id
    ])
    expect(finalizedRestore?.completed).toBeUndefined()
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)).toBeNull()
  })

  it('restores a finalized decision as read-only review without decisions', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          visited: true,
          completed: true,
          finalizedQuestionnaires: [retryQuestionnaire.id],
          submittedQuestionnaires: [otherQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 2] },
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

    // After the refresh a finalized result is read-only review: no pending
    // decision, no retry eligibility, and the persisted completion is valid.
    expect(inputIn(quiz, 'first').checked).toBe(true)
    expect(inputIn(quiz, 'alpha').checked).toBe(true)
    expect(inputIn(quiz, 'second').checked).toBe(false)
    expect(itemsIn(quiz).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
    expect(summaryTextIn(quiz)).toContain('2 of 2 correct answers')
    expect(retryIn(quiz)).toBeNull()
    expect(finalizeButtonIn(quiz)).toBeNull()

    const otherInput = inputIn(other, 'good')
    expect(otherInput.checked).toBe(true)
    expect(summaryTextIn(other)).toContain('1 of 1 correct answers')
    expect(inputIn(other, 'good').disabled).toBe(false)
    expect(itemsIn(other).every((item) => item.getAttribute('aria-readonly') === 'true')).toBe(true)
  })
})

describe('usePlayerSession attempt transitions', () => {
  it('never records a submission past the authored attempt cap and finalizes it', () => {
    const quizPage = makePackage('scroll', [retryQuestionnaire])
    act(() => root.render(<SessionHarness contentPackage={quizPage} />))

    // Three submission rounds exhaust the cap; each round is followed by a
    // retry while an attempt remains, else the retry is refused.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() =>
        session?.markQuestionnaireSubmitted(
          PAGE_ID,
          retryQuestionnaire.id,
          0,
          retryQuestionnaire.maxAttempts
        )
      )
      act(() =>
        session?.retryQuestionnaire(
          PAGE_ID,
          retryQuestionnaire.id,
          [singleChoiceQuestion.id, multipleChoiceQuestion.id],
          retryQuestionnaire.maxAttempts
        )
      )
    }

    const page = session?.state.pages[PAGE_ID]
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The history stops exactly at the cap instead of growing beyond it, and
    // the exhausted submission finalizes on its own without a decision.
    expect(page?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [0, 0, 0] })
    expect(page?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.activeQuestionnaireRetries).toBeUndefined()

    // A further report on the submitted questionnaire writes nothing at all.
    const writes = saveState.mock.calls.length
    act(() =>
      session?.markQuestionnaireSubmitted(
        PAGE_ID,
        retryQuestionnaire.id,
        2,
        retryQuestionnaire.maxAttempts
      )
    )
    expect(saveState.mock.calls.length).toBe(writes)
    expect(session?.state.pages[PAGE_ID]?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0, 0, 0]
    })
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
    // persist write happened. The persisted completion stayed dropped for the
    // pending page.
    expect(session?.state).toBe(afterFirstRetry)
    expect(saveState.mock.calls.length).toBe(writes)
    expect(session?.state.pages[PAGE_ID]?.completed).toBeUndefined()
  })

  it('finalizes a pending result idempotently without adding an attempt', () => {
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

    act(() => session?.finalizeQuestionnaire(PAGE_ID, retryQuestionnaire.id))

    const afterFinalize = session?.state
    expect(afterFinalize?.pages[PAGE_ID]?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
    // The recorded attempt is kept exactly as it was.
    expect(afterFinalize?.pages[PAGE_ID]?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [1]
    })

    const writes = saveState.mock.calls.length
    act(() => session?.finalizeQuestionnaire(PAGE_ID, retryQuestionnaire.id))

    // A second finalization changes nothing and writes nothing.
    expect(session?.state).toBe(afterFinalize)
    expect(saveState.mock.calls.length).toBe(writes)
  })

  it('never allows a retry of a finalized questionnaire', () => {
    restoredState = {
      pages: {
        [PAGE_ID]: {
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] },
          finalizedQuestionnaires: [retryQuestionnaire.id],
          answers: { [singleChoiceQuestion.id]: 'first' }
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

    // The retry is refused: no active marker appears, the saved answers and
    // the finalized decision survive untouched.
    const page = session?.state.pages[PAGE_ID]
    expect(page?.activeQuestionnaireRetries).toBeUndefined()
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.finalizedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.answers).toEqual({ [singleChoiceQuestion.id]: 'first' })
  })

  it('gates page completion on the pending decision and reports it after finalize', () => {
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

    act(() => session?.finalizeQuestionnaire(PAGE_ID, retryQuestionnaire.id))
    act(() => session?.markCompleted(PAGE_ID))

    // With the decision closed, the page completes again and the package
    // completion reaches the bridge.
    expect(session?.state.pages[PAGE_ID]?.completed).toBe(true)
    expect(completionBridge.mock.calls.length).toBe(1)
  })

  it('delays a Tiles package completion report until its pending decision finalizes', () => {
    const QUIZ_ITEM_ID = 'item:quiz.mdx'
    const PLAIN_ITEM_ID = 'item:plain.mdx'
    const tilesPackage: ContentPackage = {
      metadata: { title: 'Tiles finalization' },
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
    // submitted-but-pending retry assessment.
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

    act(() => session?.finalizeQuestionnaire(QUIZ_ITEM_ID, retryQuestionnaire.id))

    // With the pending decision closed, the fully-visited package reports
    // completion.
    expect(completionBridge).toHaveBeenCalledTimes(1)
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
      // Only a perfect reported count finalizes the submission on its own.
      expect(lastPageState()?.finalizedQuestionnaires).toEqual(
        validCount === 2 ? [retryQuestionnaire.id] : undefined
      )
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
      // inside the countable range instead; the clamped perfect count (99 → 2)
      // even auto-finalizes the submission like any perfect result.
      expect(lastPageState()?.questionnaireAttempts).toEqual({
        [retryQuestionnaire.id]: [recorded]
      })
      expect(lastPageState()?.finalizedQuestionnaires).toEqual(
        reported === 99 ? [retryQuestionnaire.id] : undefined
      )
    }
  })
})
