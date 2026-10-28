import type { QuestionOption } from '../types'

/** Inputs that scope one question's deterministic option order. */
export interface OptionShuffleScope {
  /** The global non-negative seed persisted with the learner's state. */
  seed: number
  questionnaireId: string
  questionId: string
  /**
   * The questionnaire-scoped attempt index: the latest submitted attempt while
   * reviewing, or the attempt about to be submitted while answering/retrying.
   */
  attemptIndex: number
}

/** FNV-1a hash of the scoping key, so each attempt/question gets its own order. */
function hashShuffleKey(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Advances the xorshift32 state so each swap draws a deterministic value. */
function nextShuffleState(state: number): number {
  let next = state
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0
}

/**
 * Returns a shuffled copy of a question's options in a deterministic order
 * derived from the global seed and the questionnaire/question/attempt scope.
 * The authored options are never mutated, and the same scope always produces
 * the same order, so re-renders and resumed sessions stay stable.
 */
export function shuffleQuestionOptions(
  options: readonly QuestionOption[],
  scope: OptionShuffleScope
): QuestionOption[] {
  const shuffled = [...options]
  let state = hashShuffleKey(
    JSON.stringify([scope.seed, scope.questionnaireId, scope.questionId, scope.attemptIndex])
  )
  if (state === 0) {
    state = 0x9e3779b9
  }
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = nextShuffleState(state)
    const swapIndex = state % (index + 1)
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}
