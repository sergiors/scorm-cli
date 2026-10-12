import type { AnswerValue, QuestionNode, QuestionOption } from '../types'

/**
 * Whether a learner's saved answer selects a given option. Multiple-choice
 * answers are string arrays, so an option is selected when it is a member;
 * single-choice and true-false answers are a single string, so the option is
 * selected only when it matches. Correctness is never consulted, so selection
 * can never leak a result before submission.
 */
export function isOptionSelected(
  question: QuestionNode,
  value: AnswerValue | undefined,
  optionValue: string
): boolean {
  if (question.questionType === 'multiple-choice') {
    return Array.isArray(value) && value.includes(optionValue)
  }
  return value === optionValue
}

/**
 * Derives the saved answer a choice interaction should produce. Single-choice
 * and true-false keep the chosen option value as a string (radios never report
 * an uncheck). Multiple-choice toggles the option while keeping the array in
 * authored option order, so the persisted value is deterministic regardless of
 * the order the learner toggled the options.
 */
export function answerAfterChange(
  question: QuestionNode,
  value: AnswerValue | undefined,
  optionValue: string,
  checked: boolean
): AnswerValue {
  if (question.questionType !== 'multiple-choice') {
    return optionValue
  }
  const current = Array.isArray(value) ? value : []
  return question.options
    .map((option) => option.value)
    .filter((candidate) => (candidate === optionValue ? checked : current.includes(candidate)))
}

/**
 * How a submitted option's result should read: a correct option is `correct`
 * whether or not the learner selected it, a selected wrong option is
 * `incorrect`, and a wrong option left unselected stays `neutral`. Only the
 * submitted view classifies options, so correctness is never revealed before
 * results.
 */
export type SubmittedOptionResult = 'correct' | 'incorrect' | 'neutral'

export function submittedOptionResult(
  option: QuestionOption,
  selected: boolean
): SubmittedOptionResult {
  if (option.correct) {
    return 'correct'
  }
  return selected ? 'incorrect' : 'neutral'
}
