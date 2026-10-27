import type {
  ContentNode,
  ContentPackage,
  PlayerPageState,
  PlayerState,
  QuestionnaireNode
} from '../types'
import { collectQuestionnaires, getPresentationNodes } from './content-helpers'

/**
 * How many successful submissions the learner can still make. The authored cap
 * is always present, so the remaining count is derived from the recorded
 * history alone.
 */
export function questionnaireAttemptsRemaining(
  questionnaire: QuestionnaireNode,
  attempts: readonly number[]
): number {
  return Math.max(0, questionnaire.maxAttempts - attempts.length)
}

/** Whether the questionnaire's submitted result has been completed. */
export function isQuestionnaireCompleted(
  pageState: PlayerPageState | undefined,
  questionnaireId: string
): boolean {
  return pageState?.completedQuestionnaires?.includes(questionnaireId) ?? false
}

/**
 * Whether one authored questionnaire satisfies the page-completion gate. A
 * questionnaire is complete once it has been submitted and its result has been
 * completed, either automatically or by the learner.
 */
export function isQuestionnairePageComplete(
  questionnaire: QuestionnaireNode,
  pageState: PlayerPageState | undefined
): boolean {
  const submitted = pageState?.submittedQuestionnaires?.includes(questionnaire.id) ?? false
  return submitted && isQuestionnaireCompleted(pageState, questionnaire.id)
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
 * Whether every authored questionnaire across the whole package has completed
 * its submission. Package completion can otherwise be reached from Tiles'
 * visited-based done state while an assessment is still pending.
 */
export function arePackageQuestionnairesComplete(
  contentPackage: ContentPackage,
  playerState: PlayerState
): boolean {
  return getPresentationNodes(contentPackage).every((node) =>
    arePageQuestionnairesComplete(node.content, playerState.pages[node.id])
  )
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
