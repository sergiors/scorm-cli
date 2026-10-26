import { useRef, useState } from 'react'
import type { AnswerValue, QuestionnaireNode, QuestionNode } from '../types'
import { allQuestionsAnswered, type SubmittedOptionResult } from '../lib/questionnaire'

export interface QuestionnaireViewProps {
  node: QuestionnaireNode
  /**
   * Saved answers for the owning page/item, keyed by `QuestionNode.id`.
   * Supplying this controls the rendered selection, so restored answers display
   * as checked. It does not report interactions on its own; supply
   * {@link onAnswer} as well for a fully controlled questionnaire.
   */
  answers?: Record<string, AnswerValue>
  /**
   * Whether this questionnaire's wrapper id is already in the owning page's
   * `submittedQuestionnaires`. Submitted questionnaires render read-only while
   * keeping their authored stepper or expanded presentation for review. The
   * owner supplies the saved `answers` used to restore selections and feedback.
   */
  submitted?: boolean
  /**
   * Reports a single question interaction for the owning page/item so the owner
   * can persist it. Multiple-choice answers are string arrays; single-choice and
   * true-false are strings. Supplying this reports changes but does not by
   * itself drive the selection; supply {@link answers} as well for fully
   * controlled updates. When neither is supplied, the questionnaire keeps its
   * own selection.
   */
  onAnswer?: (questionId: string, value: AnswerValue) => void
  /**
   * Invoked exactly once, with the questionnaire id, after every question has
   * been answered and the learner submits. Submission is never graded, but the
   * read-only result view does reveal correctness: correct options are marked
   * green and a wrong option the learner selected is marked red.
   */
  onSubmitted?: (id: string) => void
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
 */
export function useQuestionnaireSubmission(
  id: string,
  submitted: boolean,
  onSubmitted: ((id: string) => void) | undefined
): () => void {
  const submittedIdRef = useRef<string | null>(submitted ? id : null)

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
