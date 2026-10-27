import type {
  ContentNode,
  ContentPackage,
  PlayerPageState,
  PlayerState,
  QuestionnaireNode
} from '../types'
import { collectQuestionnaires, getPresentationNodes } from './content-helpers'

/** The effective attempt cap, falling back to one for older ASTs. */
export function questionnaireAttemptLimit(questionnaire: QuestionnaireNode): number {
  const value = questionnaire.maxAttempts
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
}

/**
 * Whether this questionnaire's authored cap requires an explicit finalization
 * decision. Only an explicit cap above one has a pending phase; omitted caps and
 * an explicit single attempt retain the immediate-final behavior.
 */
export function questionnaireRequiresFinalization(questionnaire: QuestionnaireNode): boolean {
  const value = questionnaire.maxAttempts
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1
}

/** Whether the questionnaire's submitted result has been finalized. */
export function isQuestionnaireFinalized(
  pageState: PlayerPageState | undefined,
  questionnaireId: string
): boolean {
  return pageState?.finalizedQuestionnaires?.includes(questionnaireId) ?? false
}

/**
 * Whether one authored questionnaire satisfies the page-completion gate. A
 * retry-enabled questionnaire is complete only once its submitted result is
 * finalized; every other questionnaire completes on submission exactly as
 * before.
 */
export function isQuestionnairePageComplete(
  questionnaire: QuestionnaireNode,
  pageState: PlayerPageState | undefined
): boolean {
  if (!(pageState?.submittedQuestionnaires?.includes(questionnaire.id) ?? false)) {
    return false
  }
  return (
    !questionnaireRequiresFinalization(questionnaire) ||
    isQuestionnaireFinalized(pageState, questionnaire.id)
  )
}

/** Whether every questionnaire authored in a page/item satisfies its gate. */
export function arePageQuestionnairesComplete(
  nodes: ContentNode[],
  pageState: PlayerPageState | undefined
): boolean {
  return collectQuestionnaires(nodes).every((questionnaire) =>
    isQuestionnairePageComplete(questionnaire, pageState)
  )
}

/**
 * Whether every authored explicitly retry-enabled questionnaire across the whole
 * package has been finalized. Package completion can otherwise be reached from
 * Tiles' visited-based done state while a retry assessment is still pending.
 */
export function areRetryQuestionnairesFinalized(
  contentPackage: ContentPackage,
  playerState: PlayerState
): boolean {
  return getPresentationNodes(contentPackage).every((node) =>
    collectQuestionnaires(node.content).every(
      (questionnaire) =>
        !questionnaireRequiresFinalization(questionnaire) ||
        isQuestionnaireFinalized(playerState.pages[node.id], questionnaire.id)
    )
  )
}

/** The best recorded correct count, or the live result when no attempt exists. */
export function bestQuestionnaireAttemptCount(
  attempts: readonly number[],
  fallback: number
): number {
  return attempts.length > 0 ? Math.max(...attempts) : fallback
}

/** Finds the authored questionnaire that owns a page-state transition. */
export function findAuthoredQuestionnaire(
  contentPackage: ContentPackage,
  pageId: string,
  questionnaireId: string
): QuestionnaireNode | undefined {
  const page = getPresentationNodes(contentPackage).find((node) => node.id === pageId)
  if (!page) {
    return undefined
  }
  return collectQuestionnaires(page.content).find(
    (questionnaire) => questionnaire.id === questionnaireId
  )
}
