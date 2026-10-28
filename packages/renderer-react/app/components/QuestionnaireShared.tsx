import { useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import type { AnswerValue, QuestionnaireNode, QuestionNode } from '../types'
import { allQuestionsAnswered, type SubmittedOptionResult } from '../lib/questionnaire'
import {
  isQuestionnaireCompleted,
  questionnaireAttemptsRemaining
} from '../lib/questionnaire-completion'
import { usePageId, usePlayerActions, usePlayerState } from '../lib/player-context'
import { QuestionnaireSummary } from './QuestionnaireSummary'
import { Button } from './ui/button'

/** Reads persisted questionnaire state/actions for the page or item that owns the node. */
export function useQuestionnaireSession(node: QuestionnaireNode) {
  const pageId = usePageId()
  const state = usePlayerState()
  const actions = usePlayerActions()
  const pageState = pageId ? state.pages[pageId] : undefined
  const attempts = pageState?.questionnaireAttempts?.[node.id] ?? []
  const submitted = pageState?.submittedQuestionnaires?.includes(node.id) ?? false
  const retrying = pageState?.activeQuestionnaireRetries?.includes(node.id) ?? false
  // Option shuffling is scoped to this questionnaire's own attempt history:
  // reviewing uses the latest submitted attempt, while answering or retrying
  // uses the attempt about to be submitted.
  const attemptIndex = submitted && !retrying ? Math.max(0, attempts.length - 1) : attempts.length

  return {
    answers: pageState?.answers,
    submitted,
    completed: isQuestionnaireCompleted(pageState, node.id),
    attempts,
    attemptsRemaining: questionnaireAttemptsRemaining(node, attempts),
    retrying,
    shuffleSeed: state.shuffleSeed,
    attemptIndex,
    onAnswer: pageId
      ? (questionId: string, value: AnswerValue) => actions.setAnswer(pageId, questionId, value)
      : undefined,
    onSubmitted: pageId
      ? (questionnaireId: string) => actions.markQuestionnaireSubmitted(pageId, questionnaireId)
      : undefined,
    onRetry: pageId
      ? () =>
          actions.retryQuestionnaire(
            pageId,
            node.id,
            node.questions.map((question) => question.id)
          )
      : undefined,
    onComplete: pageId ? () => actions.completeQuestionnaire(pageId, node.id) : undefined
  }
}

/**
 * Answer state shared by both presentations. Supplying `answers` or `onAnswer`
 * makes the questionnaire controlled: `answers` drives the rendered selection
 * and `onAnswer` reports interactions. Supplying neither lets the questionnaire
 * keep its own selection locally, so the standalone default still works.
 */
export function useQuestionnaireAnswers({
  questions,
  answers,
  onAnswer
}: {
  questions: readonly QuestionNode[]
  answers?: Record<string, AnswerValue>
  onAnswer?: (questionId: string, value: AnswerValue) => void
}) {
  const [localAnswers, setLocalAnswers] = useState<Record<string, AnswerValue>>({})
  const controlled = answers !== undefined || onAnswer !== undefined
  const currentAnswers = controlled ? (answers ?? {}) : localAnswers

  const answerQuestion = (questionId: string, value: AnswerValue) => {
    if (!controlled) {
      setLocalAnswers((previous) => ({ ...previous, [questionId]: value }))
    }
    onAnswer?.(questionId, value)
  }

  return {
    answers: currentAnswers,
    answerQuestion,
    allAnswered: allQuestionsAnswered(questions, currentAnswers)
  }
}

/**
 * Returns a submit callback that reports this questionnaire at most once. The
 * guard covers repeated clicks, keyboard submissions, owner-controlled
 * `submitted` updates, and restored submissions that are already complete.
 *
 * The guard is forgotten whenever the owner clears the submitted status. That is
 * exactly what happens when a retry starts, so the retry's next valid submission
 * is reported while repeated clicks within one submission still are not.
 *
 * The callback carries no render-time score: the state transition derives the
 * canonical result from the latest saved answers, so an older render closure
 * cannot record or complete a stale count.
 */
export function useQuestionnaireSubmission(
  id: string,
  submitted: boolean,
  onSubmitted: ((id: string) => void) | undefined
): () => void {
  const submittedIdRef = useRef<string | null>(submitted ? id : null)

  if (!submitted) {
    submittedIdRef.current = null
  }

  return () => {
    if (submitted || submittedIdRef.current === id) {
      return
    }
    submittedIdRef.current = id
    onSubmitted?.(id)
  }
}

/**
 * Result styling for a single submitted option: every correct option is tinted
 * green, a wrong option is tinted red only when the learner selected it, and a
 * wrong option left unselected stays neutral. The `data-checked` variants
 * override the primary "selected" tint, so the result color also wins for a
 * checked option. Only the submitted view applies this, so correctness is never
 * revealed before results.
 */
export function submittedChoiceClassName(result: SubmittedOptionResult): string | undefined {
  if (result === 'correct') {
    return 'pointer-events-none border-emerald-600/60 bg-emerald-500/10 data-checked:border-emerald-600 data-checked:bg-emerald-500/15 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:data-checked:border-emerald-500 dark:data-checked:bg-emerald-500/20'
  }

  if (result === 'incorrect') {
    return 'pointer-events-none border-destructive/60 bg-destructive/10 data-checked:border-destructive data-checked:bg-destructive/15 dark:border-destructive/60 dark:bg-destructive/15 dark:data-checked:border-destructive dark:data-checked:bg-destructive/20'
  }

  return 'pointer-events-none'
}

/**
 * The submitted summary shared by both presentations. Without a pending result
 * this renders the read-only latest result. While a submitted result is
 * still open, Try Again and Complete sit adjacent inside the summary card.
 */
export function QuestionnaireSubmissionResult({
  correct,
  total,
  attemptsRemaining,
  onRetry,
  onComplete
}: {
  correct: number
  total: number
  attemptsRemaining: number
  onRetry?: () => void
  onComplete?: () => void
}) {
  if (!onRetry && !onComplete) {
    return <QuestionnaireSummary correct={correct} total={total} />
  }

  return (
    <div className="grid gap-3">
      <QuestionnaireSummary correct={correct} total={total}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              data-slot="questionnaire-retry"
              onClick={onRetry}
            >
              <FormattedMessage id="questionnaire.tryAgain" values={{ count: attemptsRemaining }} />
            </Button>
          ) : null}
          {onComplete ? (
            <Button type="button" data-slot="questionnaire-complete" onClick={onComplete}>
              <FormattedMessage id="questionnaire.useThisScore" />
            </Button>
          ) : null}
        </div>
      </QuestionnaireSummary>
    </div>
  )
}
