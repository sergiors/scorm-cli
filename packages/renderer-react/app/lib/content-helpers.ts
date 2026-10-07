import type {
  ContentPackage,
  ItemNode,
  SectionNode,
  StructureNode,
} from '../types';

/**
 * Re-exported from `@scorm-cli/core` so completion semantics stay canonical
 * across the CLI and the renderer. In particular, an empty package is never
 * considered complete.
 */
export { isPackageComplete } from '@scorm-cli/core';

/**
 * Flattens every item in the package in document order (depth-first).
 *
 * This mirrors the helper exported by `@scorm-cli/core`; the renderer app ships
 * its own pure implementation so the browser bundle stays independent from the
 * Node-side core package.
 */
export function getPackageItems(contentPackage: ContentPackage): ItemNode[] {
  const items: ItemNode[] = [];

  const visit = (nodes: StructureNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'item') {
        items.push(node);
      } else {
        visit(node.children);
      }
    }
  };

  visit(contentPackage.children);
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

export function findItem(
  items: ItemNode[],
  itemId: string | undefined,
): ItemNode | undefined {
  if (!itemId) {
    return undefined;
  }
  return items.find((item) => item.id === itemId);
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

export function getPackageSections(
  contentPackage: ContentPackage,
): SectionNode[] {
  return contentPackage.children.filter(
    (node): node is SectionNode => node.type === 'section',
  );
}
