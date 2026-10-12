import type {
  ContentNode,
  ContentPackage,
  InlineContentNode,
  ItemNode,
  PageNode,
  QuestionnaireNode
} from '../types'

/**
 * Re-exported from `@scorm-cli/core` so completion semantics stay canonical
 * across the CLI and the renderer. In particular, an empty package is never
 * considered complete.
 */
export { getPackageProgress, isPackageComplete } from '@scorm-cli/core'

/**
 * Flattens the authored presentation into the ordered list of leaf nodes it
 * contains: the pages of a scroll presentation, or the items of a grid
 * presentation. The two share the same shape (`id`, `source`, `metadata`,
 * `content`), so callers can treat them uniformly for completion tracking.
 */
export function getPresentationNodes(contentPackage: ContentPackage): Array<PageNode | ItemNode> {
  const { presentation } = contentPackage
  return presentation.type === 'scroll' ? presentation.pages : presentation.items
}

/**
 * Collects every questionnaire reachable from a set of block nodes, in document
 * order. Block nesting (lists, quotes, and a question's own prompt or option
 * content) is traversed the same way {@link ContentRenderer} renders it, so
 * callers can reason about exactly the questionnaires the learner can reach.
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
          for (const question of node.questions) {
            visit(question.prompt)
            for (const option of question.options) visit(option.content)
          }
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
 * in document order. Scroll completion waits on exactly these wrapper ids.
 */
export function collectQuestionnaireIds(nodes: ContentNode[]): string[] {
  return collectQuestionnaires(nodes).map((node) => node.id)
}

/**
 * Whether every questionnaire in `questionnaireIds` has been submitted, ignoring
 * any submitted ids that no longer name a reachable questionnaire. This is the
 * completion gate a scroll page applies once its end boundary is reached, kept
 * pure and shared so the decision never depends on viewport state.
 */
export function areQuestionnairesSubmitted(
  questionnaireIds: readonly string[],
  submittedQuestionnaires: readonly string[]
): boolean {
  const submitted = new Set(submittedQuestionnaires)
  return questionnaireIds.every((id) => submitted.has(id))
}
