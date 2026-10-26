import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon } from 'lucide-react'
import type { AnswerValue, QuestionnaireNode, QuestionNode } from '../types'
import {
  allQuestionsAnswered,
  answerAfterChange,
  isOptionSelected,
  submittedOptionResult,
  type SubmittedOptionResult
} from '../lib/questionnaire'
import { cn } from '../lib/utils'

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
 * Whether a keyboard event belongs to a questionnaire nested inside this one,
 * such as one authored in nested page content. The nested questionnaire owns
 * its own keyboard behavior, so the surrounding presentation must not intercept it.
 */
export function isEventFromNestedQuestionnaire(event: KeyboardEvent<Element>): boolean {
  const target = event.target
  const currentTarget = event.currentTarget
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false
  }
  const owner = target.closest('[data-slot="questionnaire"]')
  const scope = currentTarget.closest('[data-slot="questionnaire"]')
  return owner !== null && owner !== scope
}

/**
 * Whether an Enter press activates the questionnaire's primary action. The
 * shortcut applies to Ctrl/Meta+Enter from anywhere and to Enter from an answer
 * control. Expanded mode uses this to keep implicit submission behind the same
 * gate as its bottom Submit.
 */
export function activatesQuestionnaireAction(event: KeyboardEvent<HTMLFormElement>): boolean {
  if (event.key !== 'Enter') {
    return false
  }
  if (event.metaKey || event.ctrlKey) {
    return !event.altKey && !event.shiftKey
  }
  return (
    event.target instanceof HTMLInputElement &&
    (event.target.type === 'radio' || event.target.type === 'checkbox')
  )
}

/**
 * Shared visual language for a questionnaire question. The interactive
 * stepper uses the Questionnaire compound parts, and the native question below
 * mirrors those classes for expanded and submitted read-only presentations.
 */
export const questionnaireItemClassName =
  'not-prose flex min-w-0 flex-col gap-5 border-0 p-0 outline-none'

export const questionnaireTitleClassName =
  'text-base font-semibold text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-5'

export const questionnaireChoicesClassName = 'group/questionnaire-choices grid min-w-0 gap-3'

export const questionnaireChoiceClassName =
  'group/questionnaire-choice relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-3xl border border-input px-4 py-3 text-start text-sm transition-colors outline-none select-none hover:bg-input/40 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring/50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-primary/40 data-checked:bg-primary/10'

export const questionnaireChoiceIndicatorClassName =
  'pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[5px] border border-transparent bg-input/90 group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:group-data-checked/questionnaire-choice:bg-primary'

export const questionnaireChoiceLabelClassName = 'flex min-w-0 flex-1 flex-col gap-1 leading-snug'

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
    return 'border-emerald-600/60 bg-emerald-500/10 data-checked:border-emerald-600 data-checked:bg-emerald-500/15 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:data-checked:border-emerald-500 dark:data-checked:bg-emerald-500/20'
  }
  if (result === 'incorrect') {
    return 'border-destructive/60 bg-destructive/10 data-checked:border-destructive data-checked:bg-destructive/15 dark:border-destructive/60 dark:bg-destructive/15 dark:data-checked:border-destructive dark:data-checked:bg-destructive/20'
  }
  return undefined
}

interface QuestionnaireQuestionProps {
  node: QuestionNode
  value: AnswerValue | undefined
  submitted: boolean
  onAnswer: (questionId: string, value: AnswerValue) => void
  hidden?: boolean
  inert?: boolean
}

/**
 * One authored question rendered as a native fieldset. The expanded
 * presentation uses it for every question, and the submitted stepper uses it
 * one visible question at a time for read-only review. Expanded mode stays
 * outside the wizard by design, and submitted choices are disabled, which the
 * wizard excludes from its answer status; neither can use the compound Root's
 * validation or navigation.
 *
 * Both callers share the prompt and option strings, answer derivation, and result
 * styling, so presentation differences stay limited to visibility and navigation.
 */
export function QuestionnaireQuestion({
  node,
  value,
  submitted,
  onAnswer,
  hidden = false,
  inert = false
}: QuestionnaireQuestionProps) {
  const titleId = useId()
  const multiple = node.questionType === 'multiple-choice'

  return (
    <fieldset
      data-slot="questionnaire-item"
      aria-labelledby={titleId}
      tabIndex={-1}
      hidden={hidden}
      inert={inert}
      className={questionnaireItemClassName}
    >
      <legend id={titleId} data-slot="questionnaire-title" className={questionnaireTitleClassName}>
        {node.prompt}
      </legend>
      <div data-slot="questionnaire-choices" className={questionnaireChoicesClassName}>
        {node.options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          const result = submitted ? submittedOptionResult(option, selected) : undefined
          return (
            <label
              key={option.value}
              data-slot="questionnaire-choice"
              data-type={multiple ? 'checkbox' : 'radio'}
              data-checked={selected ? '' : undefined}
              data-unchecked={selected ? undefined : ''}
              data-disabled={submitted ? '' : undefined}
              data-result={result}
              className={cn(
                questionnaireChoiceClassName,
                result ? submittedChoiceClassName(result) : undefined
              )}
            >
              <input
                data-slot="questionnaire-choice-input"
                type={multiple ? 'checkbox' : 'radio'}
                name={node.id}
                value={option.value}
                checked={selected}
                disabled={submitted}
                required={!submitted && !multiple}
                onChange={(event) => {
                  if (submitted) {
                    return
                  }
                  onAnswer(
                    node.id,
                    answerAfterChange(node, value, option.value, event.target.checked)
                  )
                }}
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
              />

              <span
                aria-hidden="true"
                data-slot="questionnaire-choice-indicator"
                className={questionnaireChoiceIndicatorClassName}
              >
                <span
                  data-slot="questionnaire-choice-indicator-dot"
                  className="hidden size-2 rounded-full bg-primary-foreground group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block dark:size-2.5"
                />
                <CheckIcon
                  data-slot="questionnaire-choice-indicator-check"
                  className="hidden size-3.5 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
                />
              </span>

              <span
                data-slot="questionnaire-choice-label"
                className={questionnaireChoiceLabelClassName}
              >
                {option.content}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
