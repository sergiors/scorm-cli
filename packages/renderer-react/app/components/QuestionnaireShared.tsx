import { useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import type { AnswerValue, QuestionnaireNode, QuestionNode } from '../types'
import { allQuestionsAnswered, type SubmittedOptionResult } from '../lib/questionnaire'
import {
  isQuestionnaireFinalized,
  questionnaireAttemptLimit,
  questionnaireRequiresFinalization
} from '../lib/questionnaire-finalization'
import { usePageId, usePlayerActions, usePlayerState } from '../lib/player-context'
import { QuestionnaireSummary } from './QuestionnaireSummary'
import { Button } from './ui/button'

/** Reads persisted questionnaire state/actions for the page or item that owns the node. */
export function useQuestionnaireSession(node: QuestionnaireNode) {
  const pageId = usePageId()
  const state = usePlayerState()
  const actions = usePlayerActions()
  const pageState = pageId ? state.pages[pageId] : undefined

  return {
    answers: pageState?.answers,
    submitted: pageState?.submittedQuestionnaires?.includes(node.id) ?? false,
    finalized: isQuestionnaireFinalized(pageState, node.id),
    attempts: pageState?.questionnaireAttempts?.[node.id] ?? [],
    attemptLimit: questionnaireAttemptLimit(node),
    requiresFinalization: questionnaireRequiresFinalization(node),
    retrying: pageState?.activeQuestionnaireRetries?.includes(node.id) ?? false,
    onAnswer: pageId
      ? (questionId: string, value: AnswerValue) => actions.setAnswer(pageId, questionId, value)
      : undefined,
    onSubmitted: pageId
      ? (questionnaireId: string, correctCount: number) =>
          actions.markQuestionnaireSubmitted(
            pageId,
            questionnaireId,
            // Keep the recorded count within the authored question count. A
            // non-integer or negative count falls back to zero exactly as the
            // action did before, while an oversized count is clamped here so
            // the codec can still persist the attempt history.
            Number.isSafeInteger(correctCount)
              ? Math.min(Math.max(correctCount, 0), node.questions.length)
              : 0,
            node.maxAttempts,
            node.questions.length
          )
      : undefined,
    onRetry: pageId
      ? () =>
          actions.retryQuestionnaire(
            pageId,
            node.id,
            node.questions.map((question) => question.id),
            node.maxAttempts
          )
      : undefined,
    onFinalize: pageId ? () => actions.finalizeQuestionnaire(pageId, node.id) : undefined
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
 */
export function useQuestionnaireSubmission(
  id: string,
  submitted: boolean,
  correctCount: number,
  onSubmitted: ((id: string, correctCount: number) => void) | undefined
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
    onSubmitted?.(id, correctCount)
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
 * The submitted summary shared by both presentations. Without a pending
 * decision this renders exactly the summary used before retries existed. While
 * a retry-enabled result is pending, Try Again and Use This Score sit adjacent
 * inside the summary card.
 */
export function QuestionnaireSubmissionResult({
  correct,
  total,
  onRetry,
  onFinalize
}: {
  correct: number
  total: number
  onRetry?: () => void
  onFinalize?: () => void
}) {
  if (!onRetry && !onFinalize) {
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
              <FormattedMessage id="questionnaire.tryAgain" />
            </Button>
          ) : null}
          {onFinalize ? (
            <Button type="button" data-slot="questionnaire-use-score" onClick={onFinalize}>
              <FormattedMessage id="questionnaire.useThisScore" />
            </Button>
          ) : null}
        </div>
      </QuestionnaireSummary>
    </div>
  )
}
