import type { ContentNode, InlineContentNode, QuestionnaireNode } from '../types'

/**
 * Re-exported from `@scorm-cli/core` so completion, access and score semantics
 * stay canonical across the CLI and the renderer. In particular, an empty
 * package is never complete, the done-node rule — a Scroll/Slides page counts
 * once `completed`, a Tiles item once `visited` — the shared sequential access
 * policy, and the ordered presentation nodes all live in one place, and the
 * aggregate questionnaire score is derived from the authored AST and the owned
 * resume state rather than tracked separately.
 */
export {
  collectVideoNodes,
  getAccessibleNodeIds,
  getAggregateQuestionnaireScore,
  getDoneNodeIds,
  getPackageProgress,
  getPresentationNodes,
  getSequentialAccess,
  isNodeAccessible,
  isPackageComplete,
  isPresentationNodeDone
} from '@scorm-cli/core'

export type { PresentationNode, SequentialAccess } from '../types'

/**
 * Collects every questionnaire reachable from a set of block nodes, in document
 * order. Block nesting (lists and quotes) is traversed the same way
 * {@link ContentRenderer} renders it, so callers can reason about exactly the
 * questionnaires the learner can reach.
 *
 * The switch below names every block discriminant explicitly and ends in
 * {@link assertNever}, so adding a new nested block container to `ContentNode`
 * is a compile-time error here: a new container can never silently omit its
 * questionnaires from completion or resume traversal.
 */
export function collectQuestionnaires(nodes: ContentNode[]): QuestionnaireNode[] {
  const found: QuestionnaireNode[] = []
  const visit = (list: Array<ContentNode | InlineContentNode>) => {
    for (const node of list) {
      switch (node.type) {
        case 'list':
          for (const item of node.items) visit(item.children)
          break
        case 'quote':
          visit(node.children)
          break
        case 'questionnaire':
          found.push(node)
          break
        // Leaf blocks hold no nested block content, and an `inlineContent` run
        // holds inline nodes only, so neither can contain a questionnaire.
        case 'heading':
        case 'paragraph':
        case 'thematicBreak':
        case 'code':
        case 'image':
        case 'video':
        case 'path':
        case 'inlineContent':
          break
        default:
          assertNever(node)
      }
    }
  }
  visit(nodes)
  return found
}

/**
 * Exhaustiveness guard for {@link collectQuestionnaires}. It is unreachable for
 * well-typed content, so the throw only fires for malformed runtime input that
 * carries an unknown discriminant — a loud failure instead of a silently
 * dropped subtree.
 */
function assertNever(node: never): never {
  throw new Error(`Unhandled content node: ${JSON.stringify(node)}`)
}

/**
 * Collects the ids of every questionnaire reachable from a set of block nodes,
 * in document order. Page completion waits on exactly these wrapper ids.
 */
export function collectQuestionnaireIds(nodes: ContentNode[]): string[] {
  return collectQuestionnaires(nodes).map((node) => node.id)
}

/**
 * Whether every questionnaire in `questionnaireIds` has been submitted, ignoring
 * any submitted ids that no longer name a reachable questionnaire. Page
 * completion additionally requires each questionnaire's result to be completed;
 * that higher-level gate lives in `questionnaire-completion`.
 */
export function areQuestionnairesSubmitted(
  questionnaireIds: readonly string[],
  submittedQuestionnaires: readonly string[]
): boolean {
  const submitted = new Set(submittedQuestionnaires)
  return questionnaireIds.every((id) => submitted.has(id))
}
