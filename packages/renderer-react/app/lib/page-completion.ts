import type {
  ContentNode,
  ContentPackage,
  ItemNode,
  PageNode,
  PlayerPageState,
  PlayerState
} from '../types'
import {
  arePageQuestionnairesComplete,
  arePackageQuestionnairesComplete
} from './questionnaire-completion'
import { arePackageVideoRequirementsMet, arePageVideoRequirementsMet } from './video-requirements'

/**
 * The single completion rule for a Scroll/Slides page: every authored
 * questionnaire has a completed result and every required video has reached its
 * verified minimum watch time. The page's own boundary rule (its end sentinel
 * for Scroll, being displayed for Slides) is applied by the presentation.
 */
export function isPageRequirementsComplete(
  nodes: ContentNode[],
  pageState: PlayerPageState | undefined
): boolean {
  return (
    arePageQuestionnairesComplete(nodes, pageState) && arePageVideoRequirementsMet(nodes, pageState)
  )
}

/**
 * The completion requirement for one presentation node, matching its
 * presentation. Tiles items keep their existing questionnaire gate only, so a
 * video requirement can never change a tile's opened-based semantics.
 */
export function areNodeRequirementsComplete(
  contentPackage: ContentPackage,
  node: PageNode | ItemNode,
  pageState: PlayerPageState | undefined
): boolean {
  return contentPackage.presentation.type === 'tiles'
    ? arePageQuestionnairesComplete(node.content, pageState)
    : isPageRequirementsComplete(node.content, pageState)
}

/**
 * Whether every page-level requirement across the package is met. Tiles items
 * deliberately keep their existing opened-based semantics, so video
 * requirements never gate a tile or package completion for a Tiles package.
 */
export function arePackageRequirementsComplete(
  contentPackage: ContentPackage,
  playerState: PlayerState
): boolean {
  if (!arePackageQuestionnairesComplete(contentPackage, playerState)) {
    return false
  }
  return (
    contentPackage.presentation.type === 'tiles' ||
    arePackageVideoRequirementsMet(contentPackage, playerState)
  )
}
