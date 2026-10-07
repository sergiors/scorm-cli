import type {
  Course,
  CourseStructureNode,
  ItemNode,
  SectionNode,
} from '../types';

/**
 * Re-exported from `@scorm-cli/core` so completion semantics stay canonical
 * across the CLI and the renderer. In particular, an empty course is never
 * considered complete.
 */
export { isCourseComplete } from '@scorm-cli/core';

/**
 * Flattens every item in the course in document order (depth-first).
 *
 * This mirrors the `getCourseItems` helper exported by `@scorm-cli/core`;
 * the renderer app ships its own pure implementation so the browser bundle
 * stays independent from the Node-side core package.
 */
export function getCourseItems(course: Course): ItemNode[] {
  const items: ItemNode[] = [];

  const visit = (nodes: CourseStructureNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'item') {
        items.push(node);
      } else {
        visit(node.children);
      }
    }
  };

  visit(course.children);
  return items;
}

export interface AdjacentItems {
  /** Index of `currentId` within `items`, or -1 when it is unknown. */
  index: number;
  previous: ItemNode | undefined;
  next: ItemNode | undefined;
}

export function getAdjacentItems(
  items: ItemNode[],
  currentId: string | undefined,
): AdjacentItems {
  const index = currentId
    ? items.findIndex((item) => item.id === currentId)
    : -1;

  return {
    index,
    previous: index > 0 ? items[index - 1] : undefined,
    next: index >= 0 && index < items.length - 1 ? items[index + 1] : undefined,
  };
}

/**
 * Returns a new visited set with `id` added. Keeps referential identity when
 * the id is already present so React state updates can be skipped.
 */
export function addVisited(visited: Set<string>, id: string): Set<string> {
  if (visited.has(id)) {
    return visited;
  }
  const next = new Set(visited);
  next.add(id);
  return next;
}

export function getCourseSections(course: Course): SectionNode[] {
  return course.children.filter(
    (node): node is SectionNode => node.type === 'section',
  );
}
