import type { AstNode } from './ast';

/**
 * Canonical component name for every parsed JSX node, resolved from
 * `scorm-cli/authoring` imports.
 *
 * The resolution lives in a module-level `WeakMap` keyed by node identity so the
 * traversal helpers can read the resolved name without threading resolver state
 * through every call. Keeping it in its own module lets the parser
 * implementations (`path`, `question`, ...) read names without importing the MDX
 * reader, which would otherwise create an import cycle through the component
 * registry.
 */
const resolvedComponentNames = new WeakMap<AstNode, string>();

export function setComponentName(node: AstNode, name: string): void {
  resolvedComponentNames.set(node, name);
}

export function componentName(node: AstNode): string {
  return resolvedComponentNames.get(node) ?? node.name ?? '';
}
