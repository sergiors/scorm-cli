import type {
  ContentNode,
  ContentPackage,
  ItemNode,
  PageNode,
  QuestionnaireNode,
} from '../types';

/**
 * Re-exported from `@scorm-cli/core` so completion semantics stay canonical
 * across the CLI and the renderer. In particular, an empty package is never
 * considered complete.
 */
export { getPackageProgress, isPackageComplete } from '@scorm-cli/core';

/**
 * Flattens the authored presentation into the ordered list of leaf nodes it
 * contains: the pages of a scroll presentation, or the items of a grid
 * presentation. The two share the same shape (`id`, `source`, `metadata`,
 * `content`), so callers can treat them uniformly for completion tracking.
 */
export function getPresentationNodes(
  contentPackage: ContentPackage,
): Array<PageNode | ItemNode> {
  const { presentation } = contentPackage;
  return presentation.type === 'scroll'
    ? presentation.pages
    : presentation.items;
}

/**
 * Collects every questionnaire reachable from a set of block nodes, in document
 * order. Block nesting (lists, quotes, and a question's own prompt or option
 * content) is traversed the same way {@link ContentRenderer} renders it, so
 * callers can reason about exactly the questionnaires the learner can reach.
 */
export function collectQuestionnaires(
  nodes: ContentNode[],
): QuestionnaireNode[] {
  const found: QuestionnaireNode[] = [];
  const visit = (list: ContentNode[]) => {
    for (const node of list) {
      switch (node.type) {
        case 'list':
          for (const item of node.items) visit(item.children);
          break;
        case 'quote':
          visit(node.children);
          break;
        case 'questionnaire':
          found.push(node);
          for (const question of node.questions) {
            visit(question.prompt);
            for (const option of question.options) visit(option.content);
          }
          break;
        default:
          break;
      }
    }
  };
  visit(nodes);
  return found;
}

/**
 * Collects the ids of every questionnaire reachable from a set of block nodes,
 * in document order. Scroll completion waits on exactly these wrapper ids.
 */
export function collectQuestionnaireIds(nodes: ContentNode[]): string[] {
  return collectQuestionnaires(nodes).map((node) => node.id);
}
